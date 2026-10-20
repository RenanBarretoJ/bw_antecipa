import 'server-only'
import { z } from 'zod'
import { readBoundedBody } from '@/lib/email-intake/providers/graph-http.server'
import { CALLBACK_MAX_BODY, hashSegredoCallback, interpretarCallbackRelatorio, type CallbackBinding, type EventoRelatorioVortx } from './relatorios-callback'
import type { CallbackRejection } from './relatorios-callback-diagnostic'

export type CallbackRepository = {
  autorizar(id: string, hash: string): Promise<{ status: 'UNAUTHORIZED' | 'RATE_LIMITED' } | ({ status: 'AUTHORIZED' } & CallbackBinding)>
  persistir(binding: CallbackBinding, segredoHash: string, evento: EventoRelatorioVortx, corpoOriginal?: string): Promise<void>
  diagnosticarRejeicao?(binding: CallbackBinding, segredoHash: string, rejection: CallbackRejection, token: string): Promise<void>
}

export type CallbackReceiptDiagnostic = {
  metodo: 'POST' | 'OUTRO'
  tipoConteudo: 'JSON' | 'AUSENTE' | 'OUTRO'
  endpointQuantidade: 0 | 1 | 2 // 2 means two or more; never log parameter values.
  tokenQuantidade: 0 | 1 | 2
  endpointFormatoValido: boolean | null
  tokenFormatoValido: boolean | null
  autorizacao: 'NAO_EXECUTADA' | 'NEGADA' | 'AUTORIZADA' | 'FUNDO_DIVERGENTE' | 'LIMITE' | 'FALHA'
  etapa: 'METODO' | 'PARAMETROS' | 'AUTORIZACAO' | 'HEADERS' | 'CORPO' | 'CONTRATO' | 'CARTEIRA' | 'PERSISTENCIA'
  motivo: 'METODO_NAO_SUPORTADO' | 'ENDPOINT_AUSENTE' | 'ENDPOINT_DUPLICADO' | 'ENDPOINT_FORMATO_INVALIDO'
    | 'TOKEN_AUSENTE' | 'TOKEN_DUPLICADO' | 'TOKEN_FORMATO_INVALIDO' | 'AUTORIZACAO_NEGADA' | 'FUNDO_DIVERGENTE'
    | 'LIMITE_ATINGIDO' | 'AUTORIZACAO_INDISPONIVEL' | 'TIPO_CONTEUDO_INVALIDO' | 'CODIFICACAO_NAO_SUPORTADA'
    | 'CORPO_EXCESSIVO' | 'CORPO_INVALIDO' | 'JSON_INVALIDO' | 'CONTRATO_INVALIDO' | 'CARTEIRA_DIVERGENTE'
    | 'PERSISTENCIA_INDISPONIVEL' | 'RECEBIDO'
}

const reply = (status: number) => new Response(null, { status, headers: {
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  ...(status === 405 ? { Allow: 'POST' } : {}), ...(status === 429 ? { 'Retry-After': '60' } : {}),
} })

/** Receipt only. Never fetches a URL, parses a report file or publishes financial data. */
export async function receberCallbackRelatorio(request: Request, repository: CallbackRepository, fundoPermitido: string,
  diagnosticar?: (diagnostico: CallbackReceiptDiagnostic) => void): Promise<Response> {
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  const metadados: Omit<CallbackReceiptDiagnostic, 'etapa' | 'motivo'> = {
    metodo: request.method === 'POST' ? 'POST' : 'OUTRO',
    tipoConteudo: !contentType ? 'AUSENTE' : contentType === 'application/json' ? 'JSON' : 'OUTRO',
    endpointQuantidade: 0, tokenQuantidade: 0, endpointFormatoValido: null, tokenFormatoValido: null,
    autorizacao: 'NAO_EXECUTADA',
  }
  const finish = (status: number, etapa: CallbackReceiptDiagnostic['etapa'], motivo: CallbackReceiptDiagnostic['motivo']) => {
    // Observability is non-authoritative: observer failure must not change the acknowledgement.
    try { diagnosticar?.({ ...metadados, etapa, motivo }) } catch { /* Never echo an observer exception. */ }
    return reply(status)
  }
  if (request.method !== 'POST') return finish(405, 'METODO', 'METODO_NAO_SUPORTADO')
  const parameters = new URL(request.url).searchParams
  const ids = parameters.getAll('endpoint'), tokens = parameters.getAll('token')
  metadados.endpointQuantidade = ids.length === 0 ? 0 : ids.length === 1 ? 1 : 2
  metadados.tokenQuantidade = tokens.length === 0 ? 0 : tokens.length === 1 ? 1 : 2
  metadados.endpointFormatoValido = ids.length === 1 && z.uuid().safeParse(ids[0]).success
  metadados.tokenFormatoValido = tokens.length === 1 && /^[0-9a-f]{64}$/.test(tokens[0])
  if (!metadados.endpointFormatoValido || !metadados.tokenFormatoValido) {
    const motivo = ids.length === 0 ? 'ENDPOINT_AUSENTE' : ids.length > 1 ? 'ENDPOINT_DUPLICADO'
      : !metadados.endpointFormatoValido ? 'ENDPOINT_FORMATO_INVALIDO'
        : tokens.length === 0 ? 'TOKEN_AUSENTE' : tokens.length > 1 ? 'TOKEN_DUPLICADO' : 'TOKEN_FORMATO_INVALIDO'
    return finish(401, 'PARAMETROS', motivo)
  }
  const secretHash = hashSegredoCallback(tokens[0])
  let binding: CallbackBinding
  try {
    const auth = await repository.autorizar(ids[0].toLowerCase(), secretHash)
    if (auth.status === 'RATE_LIMITED') { metadados.autorizacao = 'LIMITE'; return finish(429, 'AUTORIZACAO', 'LIMITE_ATINGIDO') }
    if (auth.status !== 'AUTHORIZED') { metadados.autorizacao = 'NEGADA'; return finish(401, 'AUTORIZACAO', 'AUTORIZACAO_NEGADA') }
    if (auth.fundoId !== fundoPermitido) { metadados.autorizacao = 'FUNDO_DIVERGENTE'; return finish(401, 'AUTORIZACAO', 'FUNDO_DIVERGENTE') }
    metadados.autorizacao = 'AUTORIZADA'
    binding = auth
  } catch { metadados.autorizacao = 'FALHA'; return finish(503, 'AUTORIZACAO', 'AUTORIZACAO_INDISPONIVEL') }
  if (contentType !== 'application/json') return finish(415, 'HEADERS', 'TIPO_CONTEUDO_INVALIDO')
  if (request.headers.get('content-encoding') && request.headers.get('content-encoding') !== 'identity') return finish(415, 'HEADERS', 'CODIFICACAO_NAO_SUPORTADA')
  let bytes: Uint8Array, corpo: string
  try {
    bytes = await readBoundedBody(new Response(request.body, { headers: request.headers }), CALLBACK_MAX_BODY)
    corpo = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    const oversized = error && typeof error === 'object' && 'code' in error && error.code === 'FILE_TOO_LARGE'
    return finish(oversized ? 413 : 400, 'CORPO', oversized ? 'CORPO_EXCESSIVO' : 'CORPO_INVALIDO')
  }
  const capture = async (motivo: CallbackRejection['motivo']) => {
    try { await repository.diagnosticarRejeicao?.(binding, secretHash, { motivo, corpo, bytes: bytes.byteLength }, tokens[0]) }
    catch {
      // Diagnostics must not acknowledge an invalid event or leak the rejected payload.
      console.warn('vortx_callback_diagnostic', { estado: 'FALHA_CAPTURA' })
    }
  }
  let parsed: unknown
  try { parsed = JSON.parse(corpo) } catch { await capture('JSON_INVALIDO'); return finish(400, 'CONTRATO', 'JSON_INVALIDO') }
  let evento: EventoRelatorioVortx
  try { evento = interpretarCallbackRelatorio(parsed) } catch {
    // A known cross-wallet payload is not collected, even if another field is also invalid.
    const wallet = parsed && typeof parsed === 'object' && 'idCarteira' in parsed ? parsed.idCarteira : undefined
    if (wallet === undefined || wallet === null || wallet === binding.codigoCarteira) await capture('CONTRATO_INVALIDO')
    return finish(400, 'CONTRATO', 'CONTRATO_INVALIDO')
  }
  if (evento.idCarteira !== binding.codigoCarteira) return finish(403, 'CARTEIRA', 'CARTEIRA_DIVERGENTE')
  try {
    await repository.persistir(binding, secretHash, evento, corpo)
    return finish(200, 'PERSISTENCIA', 'RECEBIDO') // Only after durable commit.
  } catch { return finish(503, 'PERSISTENCIA', 'PERSISTENCIA_INDISPONIVEL') }
}
