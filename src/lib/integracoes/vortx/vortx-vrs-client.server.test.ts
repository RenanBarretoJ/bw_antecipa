import { beforeEach, describe, expect, it, vi } from 'vitest'

const { postJsonMtls } = vi.hoisted(() => ({ postJsonMtls: vi.fn() }))
vi.mock('./mtls-http-client.server', () => ({ postJsonMtls }))

import { limparTokenCache } from './token-cache.server'
import { autenticarVortxVrs, obterAccessTokenVortxVrs } from './vortx-vrs-client.server'
import type { VortxVrsConfig } from './credenciais.server'

const config: VortxVrsConfig = {
  fundoId: 'fundo-1',
  ambiente: 'homologacao',
  baseUrl: 'https://api-stg.vortx.com.br',
  key: 'key-123',
  secret: 'secret-456',
  credential: { certificadoPem: 'cert', chavePrivadaPem: 'key' },
}

describe('autenticarVortxVrs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    limparTokenCache()
  })

  it('faz POST /v2/auth/login com Key/Secret e retorna o login parseado', async () => {
    postJsonMtls.mockResolvedValue({
      statusCode: 200,
      body: { data: { accessToken: 'tok', refreshToken: 'ref', created: '2026-08-25T00:00:00.000Z', expiresIn: 3600 } },
    })

    const result = await autenticarVortxVrs(config)

    expect(postJsonMtls).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: config.baseUrl,
      path: '/v2/auth/login',
      body: { Key: 'key-123', Secret: 'secret-456' },
      credential: config.credential,
    }))
    expect(result).toEqual({ accessToken: 'tok', refreshToken: 'ref', created: '2026-08-25T00:00:00.000Z', expiresIn: 3600 })
  })

  it('lanca erro categoria autenticacao em HTTP 401', async () => {
    postJsonMtls.mockResolvedValue({ statusCode: 401, body: { message: 'invalid credentials' } })
    await expect(autenticarVortxVrs(config)).rejects.toMatchObject({ categoria: 'autenticacao' })
  })

  it('lanca erro categoria autenticacao em HTTP 403', async () => {
    postJsonMtls.mockResolvedValue({ statusCode: 403, body: {} })
    await expect(autenticarVortxVrs(config)).rejects.toMatchObject({ categoria: 'autenticacao' })
  })

  it('lanca erro categoria resposta_inesperada em outros status de erro', async () => {
    postJsonMtls.mockResolvedValue({ statusCode: 500, body: {} })
    await expect(autenticarVortxVrs(config)).rejects.toMatchObject({ categoria: 'resposta_inesperada' })
  })

  it('lanca erro categoria resposta_inesperada quando faltam campos no login (accessToken ausente)', async () => {
    postJsonMtls.mockResolvedValue({
      statusCode: 200,
      body: { data: { refreshToken: 'ref', created: '2026-08-25T00:00:00.000Z', expiresIn: 3600 } },
    })
    await expect(autenticarVortxVrs(config)).rejects.toMatchObject({ categoria: 'resposta_inesperada' })
  })

  it('lanca erro categoria resposta_inesperada quando expiresIn nao e numero positivo', async () => {
    postJsonMtls.mockResolvedValue({
      statusCode: 200,
      body: { data: { accessToken: 'tok', refreshToken: 'ref', created: '2026-08-25T00:00:00.000Z', expiresIn: 0 } },
    })
    await expect(autenticarVortxVrs(config)).rejects.toMatchObject({ categoria: 'resposta_inesperada' })
  })
})

describe('obterAccessTokenVortxVrs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    limparTokenCache()
  })

  it('autentica e salva em cache quando nao ha token valido', async () => {
    postJsonMtls.mockResolvedValue({
      statusCode: 200,
      body: { data: { accessToken: 'tok-1', refreshToken: 'ref', created: new Date().toISOString(), expiresIn: 3600 } },
    })

    const token = await obterAccessTokenVortxVrs(config)
    expect(token).toBe('tok-1')
    expect(postJsonMtls).toHaveBeenCalledTimes(1)
  })

  it('reutiliza o token em cache sem chamar a Vortx novamente', async () => {
    postJsonMtls.mockResolvedValue({
      statusCode: 200,
      body: { data: { accessToken: 'tok-1', refreshToken: 'ref', created: new Date().toISOString(), expiresIn: 3600 } },
    })

    await obterAccessTokenVortxVrs(config)
    const token = await obterAccessTokenVortxVrs(config)
    expect(token).toBe('tok-1')
    expect(postJsonMtls).toHaveBeenCalledTimes(1)
  })

  it('nao mistura tokens entre fundos diferentes (multifundo)', async () => {
    postJsonMtls
      .mockResolvedValueOnce({ statusCode: 200, body: { data: { accessToken: 'tok-fundo-1', refreshToken: 'r', created: new Date().toISOString(), expiresIn: 3600 } } })
      .mockResolvedValueOnce({ statusCode: 200, body: { data: { accessToken: 'tok-fundo-2', refreshToken: 'r', created: new Date().toISOString(), expiresIn: 3600 } } })

    const outroFundo: VortxVrsConfig = { ...config, fundoId: 'fundo-2', key: 'key-outro', secret: 'secret-outro' }
    const token1 = await obterAccessTokenVortxVrs(config)
    const token2 = await obterAccessTokenVortxVrs(outroFundo)

    expect(token1).toBe('tok-fundo-1')
    expect(token2).toBe('tok-fundo-2')
    expect(postJsonMtls).toHaveBeenCalledTimes(2)
  })
})
