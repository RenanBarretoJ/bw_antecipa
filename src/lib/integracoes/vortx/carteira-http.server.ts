import 'server-only'
import { z } from 'zod'
import type { VortxVrsConfig } from './credenciais.server'
import { autenticarVortxVrs } from './vortx-vrs-client.server'

export class CarteiraHttpError extends Error {
  constructor(readonly codigo: 'CONTEXTO_INVALIDO' | 'HTTP_RECUSADO' | 'RESPOSTA_INVALIDA' | 'RESPOSTA_EXCESSIVA', readonly statusHttp?: number) {
    super(codigo)
  }
}

/** Internal bounded source reader, not the redacted/truncated diagnostic DTO. No retry or redirects. */
export async function consultarOriginalCarteiraVortx(input: { config: VortxVrsConfig; cnpjFundo: string; dataReferencia: string }, fetchFn: typeof fetch = fetch) {
  if (input.config.ambiente !== 'producao' || input.config.baseUrl !== 'https://api.vortx.com.br'
    || !/^\d{14}$/.test(input.cnpjFundo) || !z.iso.date().safeParse(input.dataReferencia).success) throw new CarteiraHttpError('CONTEXTO_INVALIDO')
  const login = await autenticarVortxVrs(input.config)
  const url = new URL('https://apis.vortx.com.br/carteira-liberada/buscarCarteiraJSON')
  url.searchParams.set('cnpjFundos[]', input.cnpjFundo)
  url.searchParams.set('dataCarteira', input.dataReferencia)
  const response = await fetchFn(url, { method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit',
    headers: { Authorization: `Bearer ${login.accessToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new CarteiraHttpError('HTTP_RECUSADO', response.status)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new CarteiraHttpError('RESPOSTA_INVALIDA')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > 20 * 1024 * 1024) throw new CarteiraHttpError('RESPOSTA_EXCESSIVA')
      chunks.push(part.value)
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  const arquivo = Buffer.concat(chunks)
  let resposta: unknown
  try { resposta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(arquivo)) }
  catch { throw new CarteiraHttpError('RESPOSTA_INVALIDA') }
  return { arquivo, resposta }
}
