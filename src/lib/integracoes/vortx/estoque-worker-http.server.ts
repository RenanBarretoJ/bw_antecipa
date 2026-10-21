import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { readBoundedBody } from '@/lib/email-intake/providers/graph-http.server'
import { processarProximoEstoqueVortx, processamentoEstoquePreviewPermitido } from './estoque-processamento.server'
import { processarProximaInclusaoVortx, processamentoInclusaoPreviewPermitido } from './inclusao-processamento.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
const reply = (status: number) => new Response(null, { status, headers })

/** Machine-only wakeup/recovery, never a user-facing action or a substitute for MFA. */
export async function executarWorkerEstoque(request: Request, env: Readonly<Record<string, string | undefined>> = process.env,
  processar = processarProximoEstoqueVortx, processarInclusao = processarProximaInclusaoVortx): Promise<Response> {
  if (!processamentoEstoquePreviewPermitido(env) && !processamentoInclusaoPreviewPermitido(env)) return reply(404)
  const expected = env.VORTX_REPORT_STOCK_WORKER_HASH ?? '', auth = request.headers.get('authorization') ?? ''
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^Bearer [a-f0-9]{64}$/.test(auth)
    || !timingSafeEqual(createHash('sha256').update(auth.slice(7)).digest(), Buffer.from(expected, 'hex'))) return reply(401)
  if (request.method !== 'POST') return reply(405)
  if (new URL(request.url).search) return reply(400)
  try { if (request.body) await readBoundedBody(new Response(request.body, { headers: request.headers }), 0) }
  catch { return reply(400) }
  try {
    const result = await processar(env)
    if (processamentoInclusaoPreviewPermitido(env)) {
      const inclusao = await processarInclusao(env)
      return Response.json({ ...result, inclusao }, { status: inclusao.estado === 'FALHA' || result.estado === 'FALHA' ? 422 : 200, headers })
    }
    const status = result.estado === 'AGUARDANDO_PAR' ? 202 : result.estado === 'FALHA' ? 422 : 200
    return Response.json(result, { status, headers })
  } catch { return reply(503) } // No URL, headers, SQL, ciphertext or external exception is returned/logged.
}
