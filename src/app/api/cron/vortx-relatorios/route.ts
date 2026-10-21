import { timingSafeEqual } from 'node:crypto'
import { executarRotinaRelatoriosVortx, rotinaRelatoriosPermitida } from '@/lib/integracoes/vortx/relatorios-rotina.server'

export const maxDuration = 300
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  if (!rotinaRelatoriosPermitida()) return new Response(null, { status: 404, headers })
  const expected = process.env.CRON_SECRET, supplied = request.headers.get('authorization')
  if (!expected || !supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(`Bearer ${expected}`)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(`Bearer ${expected}`))) return new Response(null, { status: 401, headers })
  if (new URL(request.url).search || request.body) return new Response(null, { status: 400, headers })
  try { return Response.json(await executarRotinaRelatoriosVortx(), { headers }) }
  catch { console.warn('vortx_daily_reports', { estado: 'INDISPONIVEL' }); return new Response(null, { status: 503, headers }) }
}
