import 'server-only'

import { request as httpsRequest, type RequestOptions } from 'node:https'

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

  constructor(message: string, categoria: MtlsErrorCategoria) {
    super(message)
    this.name = 'MtlsRequestError'
    this.categoria = categoria
  }
}

type RequestFn = typeof httpsRequest

/**
 * Cliente HTTP mTLS centralizado. Qualquer provider que exija certificado
 * cliente deve passar por aqui -- nunca reimplementar https.request com
 * cert/key espalhado pelo projeto.
 *
 * O erro de conexao do Node (ECONNREFUSED, falha de handshake TLS, etc.) nao
 * inclui o conteudo do certificado/chave privada na mensagem -- seguro para
 * propagar; ainda assim o body da requisicao (Key/Secret) nunca e incluido
 * no erro.
 */
export function postJsonMtls(
  input: {
    baseUrl: string
    path: string
    body: Record<string, unknown>
    credential: MtlsCredential
    timeoutMs?: number
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

  const payload = Buffer.from(JSON.stringify(input.body), 'utf8')
  const options: RequestOptions = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || 443,
    path: `${url.pathname}${url.search}`,
    cert: input.credential.certificadoPem,
    key: input.credential.chavePrivadaPem,
    headers: {
      'content-type': 'application/json',
      'content-length': payload.length,
    },
    timeout: input.timeoutMs ?? 15_000,
  }

  return new Promise((resolve, reject) => {
    const req = requestFn(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        if (!raw) {
          resolve({ statusCode: res.statusCode || 0, body: null })
          return
        }
        try {
          resolve({ statusCode: res.statusCode || 0, body: JSON.parse(raw) })
        } catch {
          reject(new MtlsRequestError('Resposta do servidor nao e um JSON valido.', 'resposta_invalida'))
        }
      })
    })
    req.on('timeout', () => {
      req.destroy()
      reject(new MtlsRequestError('Tempo limite excedido na requisicao mTLS.', 'timeout'))
    })
    req.on('error', (error: Error) => {
      reject(new MtlsRequestError(`Falha de conexao mTLS: ${error.message}`, 'conexao'))
    })
    req.write(payload)
    req.end()
  })
}
