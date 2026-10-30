import { timingSafeEqual } from 'node:crypto'
import { readSerproNfeRuntimeConfig } from '@/lib/serpro-nfe/provider.server'
import { runSerproNfeRecoveryBatch, type SerproRecoveryResult } from '@/lib/serpro-nfe/recovery.server'
import { readSerproNfeQueueMetrics } from '@/lib/serpro-nfe/monitoring.server'

export const maxDuration = 180
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  if (!readSerproNfeRuntimeConfig().ready) return new Response(null, { status: 404, headers })
  const expected = process.env.CRON_SECRET
  const supplied = request.headers.get('authorization')
  if (!expected || !supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(`Bearer ${expected}`)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(`Bearer ${expected}`))) {
    return new Response(null, { status: 401, headers })
  }
  if (new URL(request.url).search || request.body) return new Response(null, { status: 400, headers })
  let result: SerproRecoveryResult | undefined
  try {
    const before = await readSerproNfeQueueMetrics()
    console.info('serpro_queue', before)
    if (before.state === 'OBSERVED' && before.agingAlert) console.warn('serpro_queue_aging', before)
    result = await runSerproNfeRecoveryBatch()
    if (result.stopReason === 'INFRASTRUCTURE_ERROR' || result.stopReason === 'EXECUTION_FAILED') {
      console.error('serpro_recovery', result)
      return Response.json(result, { status: 503, headers })
    }
    const after = await readSerproNfeQueueMetrics()
    console.info('serpro_queue', after)
    if (after.state === 'OBSERVED' && after.agingAlert) console.warn('serpro_queue_aging', after)
    console.info('serpro_recovery', result)
    return Response.json(result, { headers })
  } catch {
    if (result) {
      const partial = { ...result, stopReason: 'INFRASTRUCTURE_ERROR' }
      console.error('serpro_recovery', partial)
      return Response.json(partial, { status: 503, headers })
    }
    console.error('serpro_recovery', { stopReason: 'INFRASTRUCTURE_ERROR' })
    return new Response(null, { status: 503, headers })
  }
}
