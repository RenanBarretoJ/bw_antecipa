import { timingSafeEqual } from 'node:crypto'
import { readSerproNfeRuntimeConfig } from '@/lib/serpro-nfe/provider.server'
import { runSerproNfeWorkerOnce } from '@/lib/serpro-nfe/worker.server'

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
  try {
    const result = await runSerproNfeWorkerOnce()
    return Response.json(result, { headers })
  } catch {
    return new Response(null, { status: 503, headers })
  }
}
