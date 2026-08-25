import { EventEmitter } from 'node:events'
import type { request as httpsRequest } from 'node:https'
import { describe, expect, it, vi } from 'vitest'
import { MtlsRequestError, postJsonMtls } from './mtls-http-client.server'

type RequestFn = typeof httpsRequest

const credential = { certificadoPem: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----', chavePrivadaPem: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----' }

class FakeResponse extends EventEmitter {
  statusCode: number
  constructor(statusCode: number) {
    super()
    this.statusCode = statusCode
  }
}

class FakeRequest extends EventEmitter {
  written: Buffer[] = []
  ended = false
  destroyed = false
  write(chunk: Buffer) {
    this.written.push(chunk)
  }
  end() {
    this.ended = true
  }
  destroy() {
    this.destroyed = true
  }
}

function fakeRequestFn(statusCode: number, responseBody: string, capturedOptions?: { current?: unknown }) {
  return vi.fn((options: unknown, callback: (res: FakeResponse) => void) => {
    if (capturedOptions) capturedOptions.current = options
    const req = new FakeRequest()
    queueMicrotask(() => {
      const res = new FakeResponse(statusCode)
      callback(res)
      queueMicrotask(() => {
        if (responseBody) res.emit('data', Buffer.from(responseBody, 'utf8'))
        res.emit('end')
      })
    })
    return req as unknown as ReturnType<RequestFn>
  }) as unknown as RequestFn
}

describe('postJsonMtls', () => {
  it('envia cert/key/metodo/corpo corretos e retorna status + JSON parseado', async () => {
    const captured: { current?: unknown } = {}
    const requestFn = fakeRequestFn(200, JSON.stringify({ data: { accessToken: 'abc' } }), captured)

    const result = await postJsonMtls({
      baseUrl: 'https://api-stg.vortx.com.br',
      path: '/v2/auth/login',
      body: { Key: 'k', Secret: 's' },
      credential,
    }, requestFn)

    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual({ data: { accessToken: 'abc' } })
    const options = captured.current as Record<string, unknown>
    expect(options.method).toBe('POST')
    expect(options.hostname).toBe('api-stg.vortx.com.br')
    expect(options.path).toBe('/v2/auth/login')
    expect(options.cert).toBe(credential.certificadoPem)
    expect(options.key).toBe(credential.chavePrivadaPem)
  })

  it('rejeita com categoria resposta_invalida quando o corpo nao e JSON valido', async () => {
    const requestFn = fakeRequestFn(200, 'nao-e-json{{{')
    await expect(postJsonMtls({
      baseUrl: 'https://api-stg.vortx.com.br',
      path: '/v2/auth/login',
      body: {},
      credential,
    }, requestFn)).rejects.toMatchObject({ categoria: 'resposta_invalida' })
  })

  it('rejeita com categoria timeout e destroi a requisicao', async () => {
    const req = new FakeRequest()
    const requestFn = vi.fn(() => {
      queueMicrotask(() => req.emit('timeout'))
      return req as unknown as ReturnType<RequestFn>
    }) as unknown as RequestFn

    await expect(postJsonMtls({
      baseUrl: 'https://api-stg.vortx.com.br',
      path: '/v2/auth/login',
      body: {},
      credential,
    }, requestFn)).rejects.toMatchObject({ categoria: 'timeout' })
    expect(req.destroyed).toBe(true)
  })

  it('rejeita com categoria conexao e nunca inclui cert/key/secret na mensagem de erro', async () => {
    const req = new FakeRequest()
    const requestFn = vi.fn(() => {
      queueMicrotask(() => req.emit('error', new Error('ECONNREFUSED 127.0.0.1:443')))
      return req as unknown as ReturnType<RequestFn>
    }) as unknown as RequestFn

    await expect(postJsonMtls({
      baseUrl: 'https://api-stg.vortx.com.br',
      path: '/v2/auth/login',
      body: { Key: 'segredo-key', Secret: 'segredo-secret' },
      credential,
    }, requestFn)).rejects.toSatisfy((error: MtlsRequestError) => {
      expect(error.categoria).toBe('conexao')
      expect(error.message).not.toContain('segredo-key')
      expect(error.message).not.toContain('segredo-secret')
      expect(error.message).not.toContain(credential.chavePrivadaPem)
      return true
    })
  })

  it('falha fechado quando certificado ou chave privada estao ausentes (nao tenta conectar)', () => {
    const requestFn = vi.fn()
    expect(() => postJsonMtls({
      baseUrl: 'https://api-stg.vortx.com.br',
      path: '/v2/auth/login',
      body: {},
      credential: { certificadoPem: '', chavePrivadaPem: '' },
    }, requestFn)).toThrow(MtlsRequestError)
    expect(requestFn).not.toHaveBeenCalled()
  })

  it('rejeita endpoints que nao sejam HTTPS', () => {
    const requestFn = vi.fn()
    expect(() => postJsonMtls({
      baseUrl: 'http://api-stg.vortx.com.br',
      path: '/v2/auth/login',
      body: {},
      credential,
    }, requestFn)).toThrow(MtlsRequestError)
    expect(requestFn).not.toHaveBeenCalled()
  })
})
