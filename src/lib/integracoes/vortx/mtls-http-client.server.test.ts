import { EventEmitter } from 'node:events'
import type { request as httpsRequest } from 'node:https'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MtlsRequestError, postJsonMtls } from './mtls-http-client.server'

type RequestFn = typeof httpsRequest

const credential = { certificadoPem: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----', chavePrivadaPem: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----' }

class FakeResponse extends EventEmitter {
  statusCode: number
  complete = true
  destroyed = false
  destroy() { this.destroyed = true }
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
  afterEach(() => vi.useRealTimers())
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
    expect(options.rejectUnauthorized).toBe(true)
    expect(options.agent).toBe(false)
    expect(options.headers).not.toHaveProperty('authorization')
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

  const input = { baseUrl: 'https://api.vortx.com.br', path: '/v1/vrs/externo/solicitar', body: {}, credential }

  function controlled() {
    const req = new FakeRequest(), res = new FakeResponse(200)
    const requestFn = vi.fn((_options: unknown, callback: (res: FakeResponse) => void) => {
      queueMicrotask(() => callback(res))
      return req
    }) as unknown as RequestFn
    return { req, res, requestFn }
  }

  it('aceita exatamente 64 KiB em varios chunks e envia Bearer sem duplicar o POST', async () => {
    const { req, res, requestFn } = controlled()
    const payload = JSON.stringify('a'.repeat(64 * 1024 - 2))
    const pending = postJsonMtls({ ...input, bearerToken: 'synthetic-token', maxResponseBytes: 64 * 1024 }, requestFn)
    await Promise.resolve()
    res.emit('data', Buffer.from(payload.slice(0, 32768)))
    res.emit('data', Buffer.from(payload.slice(32768)))
    res.emit('end')
    expect(await pending).toEqual({ statusCode: 200, body: 'a'.repeat(64 * 1024 - 2) })
    expect(requestFn).toHaveBeenCalledOnce()
    expect(requestFn).toHaveBeenCalledWith(expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer synthetic-token' }) }), expect.any(Function))
    expect(req.written).toHaveLength(1)
    expect(req.ended).toBe(true)
  })

  it('interrompe acima de 64 KiB preservando HTTP, sem parse nem retry', async () => {
    const { req, res, requestFn } = controlled()
    const pending = postJsonMtls({ ...input, maxResponseBytes: 65536 }, requestFn)
    const check = expect(pending).rejects.toMatchObject({ httpStatus: 200, codigo: 'RESPONSE_TOO_LARGE' })
    await Promise.resolve()
    res.emit('data', Buffer.alloc(65536, 32)); res.emit('data', Buffer.from('x'))
    res.emit('end')
    await check
    expect(req.destroyed && res.destroyed).toBe(true)
    expect(requestFn).toHaveBeenCalledOnce()
  })

  it.each(['aborted', 'close', 'end'])('rejeita stream incompleto (%s), ainda que contenha JSON valido', async (event) => {
    const { req, res, requestFn } = controlled()
    const pending = postJsonMtls(input, requestFn)
    const check = expect(pending).rejects.toMatchObject({ categoria: 'resposta_invalida', httpStatus: 200, codigo: 'RESPONSE_ABORTED' })
    await Promise.resolve()
    res.emit('data', Buffer.from('{}')); res.complete = false; res.emit(event)
    await check
    expect(req.destroyed && res.destroyed).toBe(true)
  })

  it('prazo total abrange resposta que nunca termina e libera o timer ao falhar', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { req, res, requestFn } = controlled()
    const pending = postJsonMtls({ ...input, totalTimeoutMs: 20000 }, requestFn)
    const check = expect(pending).rejects.toMatchObject({ categoria: 'timeout', httpStatus: 200, codigo: 'ETIMEDOUT' })
    await Promise.resolve()
    for (let i = 0; i < 4; i++) { res.emit('data', Buffer.from(' ')); await vi.advanceTimersByTimeAsync(5000) }
    await check
    expect(req.destroyed && res.destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(requestFn).toHaveBeenCalledOnce()
  })

  it('prazo total tambem limita conexao sem headers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const req = new FakeRequest()
    const pending = postJsonMtls({ ...input, totalTimeoutMs: 20000 }, (() => req) as unknown as RequestFn)
    const check = expect(pending).rejects.toMatchObject({ categoria: 'timeout', httpStatus: null })
    await vi.advanceTimersByTimeAsync(20000)
    await check
    expect(req.destroyed).toBe(true)
  })

  it('sucesso limpa deadline; erro tardio nao altera o resultado', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { req, res, requestFn } = controlled()
    const pending = postJsonMtls({ ...input, totalTimeoutMs: 20000 }, requestFn)
    await Promise.resolve(); res.emit('data', Buffer.from('{}')); res.emit('end')
    await expect(pending).resolves.toEqual({ statusCode: 200, body: {} })
    req.emit('error', new Error('late synthetic error'))
    expect(vi.getTimerCount()).toBe(0)
    expect(req.destroyed).toBe(false)
  })

  it.each([302, 401, 500])('descarta corpo nao JSON de HTTP %s sem seguir redirect', async (status) => {
    const { req, res, requestFn } = controlled(); res.statusCode = status
    const pending = postJsonMtls({ ...input, discardNonSuccessBody: true }, requestFn)
    expect(await pending).toEqual({ statusCode: status, body: null })
    expect(res.listenerCount('data')).toBe(0)
    expect(req.destroyed && res.destroyed).toBe(true)
    expect(requestFn).toHaveBeenCalledOnce()
  })

  it.each(['', 'token\r\nInjected: yes', 'token with spaces'])('nega Bearer invalido antes de conectar (%j)', (bearerToken) => {
    const requestFn = vi.fn()
    expect(() => postJsonMtls({ ...input, bearerToken }, requestFn)).toThrow(MtlsRequestError)
    expect(requestFn).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5, Number.NaN])('nega limites invalidos (%s)', (limit) => {
    const requestFn = vi.fn()
    expect(() => postJsonMtls({ ...input, maxResponseBytes: limit }, requestFn)).toThrow(MtlsRequestError)
    expect(() => postJsonMtls({ ...input, totalTimeoutMs: limit }, requestFn)).toThrow(MtlsRequestError)
    expect(requestFn).not.toHaveBeenCalled()
  })

  it('sanitiza erro do stream e nao propaga codigo arbitrario nem mensagem externa', async () => {
    const { res, requestFn } = controlled()
    const pending = postJsonMtls(input, requestFn)
    const check = expect(pending).rejects.toMatchObject({ message: 'Falha de conexao mTLS.', categoria: 'conexao', httpStatus: 200, codigo: null })
    await Promise.resolve()
    res.emit('error', Object.assign(new Error('synthetic-private-key-and-token'), { code: 'synthetic-private-key-and-token' }))
    await check
  })
})
