import 'server-only'
import { interpretarProtocoloRelatorioVortx, VORTX_RELATORIO_SOLICITAR_PATH, type SolicitacaoRelatorioVortx } from './relatorios-contrato'

export type RespostaSolicitacaoVortx = { estado: 'aceita'|'recusada'|'indeterminada'; protocolo: string|null; http: number|null }
const RECUSAS_EXPLICITAS = [400,401,403,404,405,415,422,429]

/** Um POST fixo, sem redirects ou retry. Nao baixa arquivos nem recebe URLs do operador. */
export async function solicitarRelatorioVortxHttp(input: { ambiente: 'producao'|'homologacao'; token: string; pedido: SolicitacaoRelatorioVortx }, fetchFn: typeof fetch = fetch): Promise<RespostaSolicitacaoVortx> {
  if (!input.token || !['producao','homologacao'].includes(input.ambiente)) throw new Error('INVALID_VORTX_REPORT_CONTEXT')
  let http: number|null = null
  try {
    const base = input.ambiente === 'producao' ? 'https://api.vortx.com.br' : 'https://api-stg.vortx.com.br'
    const response = await fetchFn(new URL(VORTX_RELATORIO_SOLICITAR_PATH,base), {
      method: 'POST', redirect: 'manual', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(input.pedido), signal: AbortSignal.timeout(20_000),
    })
    http = response.status
    if (!response.ok) {
      await response.body?.cancel()
      return { estado: RECUSAS_EXPLICITAS.includes(http) ? 'recusada' : 'indeterminada', protocolo: null, http }
    }
    const reader = response.body?.getReader()
    if (!reader) return { estado: 'indeterminada', protocolo: null, http }
    const chunks: Uint8Array[] = []; let bytes = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        bytes += part.value.byteLength
        if (bytes > 64 * 1024) throw new Error('VORTX_PROTOCOL_TOO_LARGE')
        chunks.push(part.value)
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
    const protocolo = interpretarProtocoloRelatorioVortx(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    return { estado: 'aceita', protocolo: protocolo.id, http }
  } catch {
    // Timeout, 5xx, HTML, corpo excessivo e protocolo invalido nunca autorizam repetir o POST.
    return { estado: 'indeterminada', protocolo: null, http }
  }
}
