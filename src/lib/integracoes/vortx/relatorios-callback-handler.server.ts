import 'server-only'
import { z } from 'zod'
import { readBoundedBody } from '@/lib/email-intake/providers/graph-http.server'
import { CALLBACK_MAX_BODY, hashSegredoCallback, interpretarCallbackRelatorio, type CallbackBinding, type EventoRelatorioVortx } from './relatorios-callback'

export type CallbackRepository = {
  autorizar(id: string, hash: string): Promise<{ status: 'UNAUTHORIZED' | 'RATE_LIMITED' } | ({ status: 'AUTHORIZED' } & CallbackBinding)>
  persistir(binding: CallbackBinding, segredoHash: string, evento: EventoRelatorioVortx): Promise<void>
}

const reply = (status: number) => new Response(null, { status, headers: {
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  ...(status === 405 ? { Allow: 'POST' } : {}), ...(status === 429 ? { 'Retry-After': '60' } : {}),
} })

/** Receipt only. Never fetches a URL, parses a report file or publishes financial data. */
export async function receberCallbackRelatorio(request: Request, repository: CallbackRepository, fundoPermitido: string): Promise<Response> {
  if (request.method !== 'POST') return reply(405)
  const parameters = new URL(request.url).searchParams
  const ids = parameters.getAll('endpoint'), tokens = parameters.getAll('token')
  if (ids.length !== 1 || tokens.length !== 1 || !z.uuid().safeParse(ids[0]).success || !/^[0-9a-f]{64}$/.test(tokens[0])) return reply(401)
  const secretHash = hashSegredoCallback(tokens[0])
  let binding: CallbackBinding
  try {
    const auth = await repository.autorizar(ids[0].toLowerCase(), secretHash)
    if (auth.status === 'RATE_LIMITED') return reply(429)
    if (auth.status !== 'AUTHORIZED' || auth.fundoId !== fundoPermitido) return reply(401)
    binding = auth
  } catch { return reply(503) }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415)
  if (request.headers.get('content-encoding') && request.headers.get('content-encoding') !== 'identity') return reply(415)
  let evento: EventoRelatorioVortx
  try {
    const bytes = await readBoundedBody(new Response(request.body, { headers: request.headers }), CALLBACK_MAX_BODY)
    evento = interpretarCallbackRelatorio(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } catch (error) {
    return reply(error && typeof error === 'object' && 'code' in error && error.code === 'FILE_TOO_LARGE' ? 413 : 400)
  }
  if (evento.idCarteira !== binding.codigoCarteira) return reply(403)
  try {
    await repository.persistir(binding, secretHash, evento)
    return reply(200) // Proposed acknowledgement; hosted delivery semantics still require confirmation.
  } catch { return reply(503) }
}
