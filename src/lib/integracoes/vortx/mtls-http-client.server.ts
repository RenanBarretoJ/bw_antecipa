import 'server-only'

import { request as httpsRequest, type RequestOptions } from 'node:https'
import type { ClientRequest, IncomingMessage } from 'node:http'

export type MtlsCredential = {
  certificadoPem: string
  chavePrivadaPem: string
}

export type MtlsJsonRequestResult = {
  statusCode: number
  body: unknown
}

export type MtlsErrorCategoria = 'timeout' | 'conexao' | 'resposta_invalida'

export class MtlsRequestError extends Error {
  readonly categoria: MtlsErrorCategoria
  readonly httpStatus: number | null
  readonly codigo: string | null

  constructor(message: string, categoria: MtlsErrorCategoria, httpStatus: number | null = null, codigo: string | null = null) {
    super(message)
    this.name = 'MtlsRequestError'
    this.categoria = categoria
    this.httpStatus = httpStatus
    this.codigo = codigo
  }
}

type RequestFn = typeof httpsRequest

/**
 * Cliente HTTP mTLS centralizado. Qualquer provider que exija certificado
 * cliente deve passar por aqui -- nunca reimplementar https.request com
 * cert/key espalhado pelo projeto.
 *
 * Sem redirects ou retry. Erros externos nunca sao interpolados; apenas
 * codigos allowlisted podem compor o diagnostico, sem headers/certificados.
 */
export function postJsonMtls(
  input: {
    baseUrl: string
    path: string
    body: Record<string, unknown>
    credential: MtlsCredential
    timeoutMs?: number
    bearerToken?: string
    maxResponseBytes?: number
    totalTimeoutMs?: number
    discardNonSuccessBody?: boolean
  },
  requestFn: RequestFn = httpsRequest,
): Promise<MtlsJsonRequestResult> {
  let url: URL
  try {
    url = new URL(input.path, input.baseUrl)
  } catch {
    throw new MtlsRequestError('URL base ou caminho da requisicao mTLS invalidos.', 'conexao')
  }
  if (url.protocol !== 'https:') {
    throw new MtlsRequestError('O endpoint informado deve ser HTTPS.', 'conexao')
  }
  if (!input.credential.certificadoPem || !input.credential.chavePrivadaPem) {
    throw new MtlsRequestError('Certificado ou chave privada mTLS ausentes.', 'conexao')
  }
  if (input.bearerToken !== undefined && (!/^[\x21-\x7e]+$/.test(input.bearerToken) || input.bearerToken.length > 16384)) {
    throw new MtlsRequestError('Bearer invalido para transporte mTLS.', 'conexao')
  }
  for (const limit of [input.maxResponseBytes, input.totalTimeoutMs]) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) throw new MtlsRequestError('Limite mTLS invalido.', 'conexao')
  }

  const payload = Buffer.from(JSON.stringify(input.body), 'utf8')
  const options: RequestOptions = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || 443,
    path: `${url.pathname}${url.search}`,
    cert: input.credential.certificadoPem,
    key: input.credential.chavePrivadaPem,
    rejectUnauthorized: true,
    agent: false,
    headers: {
      'content-type': 'application/json',
      'content-length': payload.length,
      ...(input.bearerToken ? { authorization: `Bearer ${input.bearerToken}`, accept: 'application/json' } : {}),
    },
    timeout: input.timeoutMs ?? 15_000,
  }

  return new Promise((resolve, reject) => {
    let settled = false, http: number | null = null
    let req: ClientRequest | undefined, response: IncomingMessage | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    const fail = (error: MtlsRequestError) => {
      if (settled) return
      settled = true; clearTimeout(deadline)
      reject(error)
      response?.destroy(); req?.destroy()
    }
    const done = (body: unknown) => {
      if (settled) return
      settled = true; clearTimeout(deadline)
      resolve({ statusCode: http ?? 0, body })
    }
    const connectionFailure = (error: unknown) => {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null
      const allowed = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT',
        'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID',
        'ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED', 'ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE']
      fail(new MtlsRequestError('Falha de conexao mTLS.', 'conexao', http, typeof code === 'string' && allowed.includes(code) ? code : null))
    }
    try {
      req = requestFn(options, (res) => {
        response = res
        http = res.statusCode || null
        res.on('error', connectionFailure)
        if (settled) { res.destroy(); return }
        if (input.discardNonSuccessBody && (http === null || http < 200 || http >= 300)) {
          done(null); res.destroy(); req?.destroy(); return
        }
        const chunks: Buffer[] = []
        let bytes = 0
        res.on('aborted', () => fail(new MtlsRequestError('Resposta mTLS interrompida.', 'resposta_invalida', http, 'RESPONSE_ABORTED')))
        res.on('close', () => {
          if (!settled && res.complete === false) fail(new MtlsRequestError('Resposta mTLS incompleta.', 'resposta_invalida', http, 'RESPONSE_ABORTED'))
        })
        res.on('data', (chunk: Buffer) => {
          if (settled) return
          bytes += chunk.length
          if (input.maxResponseBytes !== undefined && bytes > input.maxResponseBytes) {
            fail(new MtlsRequestError('Resposta mTLS excede o limite.', 'resposta_invalida', http, 'RESPONSE_TOO_LARGE')); return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          if (settled) return
          if (res.complete === false) { fail(new MtlsRequestError('Resposta mTLS incompleta.', 'resposta_invalida', http, 'RESPONSE_ABORTED')); return }
          const raw = Buffer.concat(chunks).toString('utf8')
          if (!raw) { done(null); return }
          try { done(JSON.parse(raw)) }
          catch { fail(new MtlsRequestError('Resposta do servidor nao e um JSON valido.', 'resposta_invalida', http, 'INVALID_JSON')) }
        })
      })
    } catch (error) { connectionFailure(error); return }
    req.on('timeout', () => {
      fail(new MtlsRequestError('Tempo limite excedido na requisicao mTLS.', 'timeout', http, 'ETIMEDOUT'))
    })
    req.on('error', connectionFailure)
    if (input.totalTimeoutMs !== undefined) deadline = setTimeout(() => {
      fail(new MtlsRequestError('Tempo total excedido na requisicao mTLS.', 'timeout', http, 'ETIMEDOUT'))
    }, input.totalTimeoutMs)
    try { req.write(payload); req.end() } catch (error) { connectionFailure(error) }
  })
}
