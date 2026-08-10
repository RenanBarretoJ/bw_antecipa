import { timingSafeEqual } from 'node:crypto'
import { executarMotorComunicacoes } from '@/lib/comunicacoes/motor.server'

export const maxDuration = 300

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!expected || token.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected))
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Nao autorizado.' }, { status: 401 })
  try {
    const result = await executarMotorComunicacoes()
    return Response.json({
      success: true,
      runId: result.runId,
      dataReferencia: result.dataReferencia,
      encontradas: result.encontradas,
      agrupadas: result.agrupadas,
      enviadas: result.enviadas,
      falhas: result.falhas,
      bloqueadas: result.bloqueadas,
      ignoradas: result.ignoradas,
    })
  } catch (error) {
    console.error('[cron/comunicacoes] falha controlada', { message: error instanceof Error ? error.message.slice(0, 300) : 'Falha inesperada.' })
    return Response.json({ error: 'Falha no processamento das comunicacoes.' }, { status: 500 })
  }
}
