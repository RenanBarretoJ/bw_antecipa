import 'server-only'
import type { request as httpsRequest } from 'node:https'
import { MtlsRequestError, postJsonMtls, type MtlsCredential } from './mtls-http-client.server'
import { interpretarProtocoloRelatorioVortx, VORTX_RELATORIO_SOLICITAR_PATH, type SolicitacaoRelatorioVortx } from './relatorios-contrato'

export type RespostaSolicitacaoVortx = { estado: 'aceita'|'recusada'|'indeterminada'; protocolo: string|null; http: number|null }
const RECUSAS_EXPLICITAS = [400,401,403,404,405,415,422,429]

/** Um POST mTLS + Bearer, sem redirects/retry. Nao baixa arquivos nem recebe URLs do operador. */
export async function solicitarRelatorioVortxHttp(input: {
  ambiente: 'producao'|'homologacao'; token: string; pedido: SolicitacaoRelatorioVortx; credential: MtlsCredential
}, requestFn?: typeof httpsRequest): Promise<RespostaSolicitacaoVortx> {
  if (!input.token || !['producao','homologacao'].includes(input.ambiente)
    || !input.credential?.certificadoPem || !input.credential.chavePrivadaPem) throw new Error('INVALID_VORTX_REPORT_CONTEXT')
  let http: number|null = null
  let etapa: 'transporte'|'protocolo' = 'transporte'
  const started = Date.now()
  try {
    const base = input.ambiente === 'producao' ? 'https://api.vortx.com.br' : 'https://api-stg.vortx.com.br'
    const response = await postJsonMtls({ baseUrl: base, path: VORTX_RELATORIO_SOLICITAR_PATH,
      body: input.pedido, credential: input.credential, bearerToken: input.token,
      timeoutMs: 20_000, totalTimeoutMs: 20_000, maxResponseBytes: 64 * 1024, discardNonSuccessBody: true,
    }, requestFn)
    http = response.statusCode || null
    if (http === null || http < 200 || http >= 300) {
      const estado = http !== null && RECUSAS_EXPLICITAS.includes(http) ? 'recusada' : 'indeterminada'
      console.info('vortx_report_transport', { estado, http, etapa, categoria: 'http', codigo: null, durationMs: Date.now() - started })
      return { estado, protocolo: null, http }
    }
    etapa = 'protocolo'
    const protocolo = interpretarProtocoloRelatorioVortx(response.body)
    console.info('vortx_report_transport', { estado: 'aceita', http, etapa, categoria: null, codigo: null, durationMs: Date.now() - started })
    return { estado: 'aceita', protocolo: protocolo.id, http }
  } catch (error) {
    if (error instanceof MtlsRequestError) http = error.httpStatus ?? http
    // No exception, message, body, URL, headers or credentials are logged or returned.
    console.info('vortx_report_transport', { estado: 'indeterminada', http, etapa,
      categoria: error instanceof MtlsRequestError ? error.categoria : etapa === 'protocolo' ? 'protocolo_invalido' : 'inesperado',
      codigo: error instanceof MtlsRequestError ? error.codigo : null, durationMs: Date.now() - started })
    return { estado: 'indeterminada', protocolo: null, http }
  }
}
