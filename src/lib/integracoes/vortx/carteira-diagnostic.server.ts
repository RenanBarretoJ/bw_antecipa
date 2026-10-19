import 'server-only'

import { z } from 'zod'
import type { VortxVrsConfig } from './credenciais.server'
import { autenticarVortxVrs } from './vortx-vrs-client.server'
import type { CarteiraDiagnosticResponse } from './carteira-diagnostic'

const ORIGIN = 'https://apis.vortx.com.br'
const MAX_BYTES = 256 * 1024
const MAX_DISPLAY = 64 * 1024
const sensitiveField = /token|authorization|secret|password|senha|certificate|certificado|private.?key|api.?key|credential|chave|cookie|^key$/i

function sanitizarResposta(raw: string, secrets: string[]): { texto: string; redigida: boolean } {
  let redigida = false
  function limparTexto(value: string): string {
    let result = value
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
      for (const variant of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) {
        if (result.includes(variant)) { result = result.split(variant).join('[REDACTED]'); redigida = true }
      }
    }
    return result.replace(/Bearer\s+[^\s"<>]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN [\s\S]*?-----END [^-]+-----|https?:\/\/[^\s"<>]*[?&](?:X-Amz-[^\s"<>]*|token=[^\s"<>]*|signature=[^\s"<>]*)/gi, () => { redigida = true; return '[REDACTED]' })
  }
  let texto: string
  try {
    const json: unknown = JSON.parse(raw)
    texto = JSON.stringify(json, (key, value: unknown) => {
      if (sensitiveField.test(key)) { redigida = true; return '[REDACTED]' }
      return typeof value === 'string' ? limparTexto(value) : value
    }, 2)
    texto = limparTexto(texto)
  } catch {
    // Texto/HTML arbitrario pode conter segredos desconhecidos. Nao o devolver ao navegador.
    texto = raw ? '[Resposta nao JSON omitida por seguranca.]' : ''
    redigida = Boolean(raw)
  }
  if (texto.length > MAX_DISPLAY) { texto = `${texto.slice(0, MAX_DISPLAY)}\n[RESPOSTA TRUNCADA]`; redigida = true }
  return { texto, redigida }
}

async function lerRespostaLimitada(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > MAX_BYTES) throw new Error('RESPONSE_TOO_LARGE')
      chunks.push(part.value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function validarEscopoResposta(raw: string, cnpj: string): void {
  const value: unknown = JSON.parse(raw)
  const schema = z.array(z.object({ carteiras: z.array(z.object({ cnpjFundo: z.union([z.string(), z.number()]) })) }))
  const parsed = schema.safeParse(value)
  if (!parsed.success || parsed.data.some(item => item.carteiras.length === 0
    || item.carteiras.some(carteira => String(carteira.cnpjFundo).replace(/\D/g, '').padStart(14, '0') !== cnpj))) {
    throw new Error('UNEXPECTED_FUND_RESPONSE_SCOPE')
  }
}

/** Um login existente e um GET fixo. Sem retry, redirect, mTLS na API Carteira ou persistencia financeira. */
export async function consultarCarteiraComTokenVrs(
  input: { config: VortxVrsConfig; cnpjFundo: string; dataCarteira: string },
  fetchFn: typeof fetch = fetch,
): Promise<CarteiraDiagnosticResponse> {
  if (input.config.ambiente !== 'producao' || input.config.baseUrl !== 'https://api.vortx.com.br'
    || !/^\d{14}$/.test(input.cnpjFundo) || !z.iso.date().safeParse(input.dataCarteira).success) {
    throw new Error('DIAGNOSTIC_CONTEXT_INVALID')
  }
  const login = await autenticarVortxVrs(input.config)
  const url = new URL('/carteira-liberada/buscarCarteiraJSON', ORIGIN)
  url.searchParams.set('cnpjFundos[]', input.cnpjFundo)
  url.searchParams.set('dataCarteira', input.dataCarteira)
  const response = await fetchFn(url, {
    method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit',
    headers: { Authorization: `Bearer ${login.accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  const raw = await lerRespostaLimitada(response)
  if (response.ok) validarEscopoResposta(raw, input.cnpjFundo)
  const sanitized = sanitizarResposta(raw, [login.accessToken, login.refreshToken, input.config.key, input.config.secret,
    input.config.credential.certificadoPem, input.config.credential.chavePrivadaPem])
  return { statusHttp: response.status, endpoint: url.toString(), dataCarteira: input.dataCarteira,
    consultadoEm: new Date().toISOString(), resposta: sanitized.texto, respostaRedigida: sanitized.redigida }
}
