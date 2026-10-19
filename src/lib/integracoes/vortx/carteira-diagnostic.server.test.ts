import { beforeEach, describe, expect, it, vi } from 'vitest'
const { login } = vi.hoisted(() => ({ login: vi.fn() }))
vi.mock('./vortx-vrs-client.server', () => ({ autenticarVortxVrs: login }))
import { consultarCarteiraComTokenVrs } from './carteira-diagnostic.server'
import type { VortxVrsConfig } from './credenciais.server'
const config: VortxVrsConfig = { fundoId: 'fundo', ambiente: 'producao', baseUrl: 'https://api.vortx.com.br', key: 'key-secreta', secret: 'secret-real', credential: { certificadoPem: 'cert-pem', chavePrivadaPem: 'priv-pem' } }
const input = { config, cnpjFundo: '68522785000104', dataCarteira: '2026-10-16' }
beforeEach(() => { vi.resetAllMocks(); login.mockResolvedValue({ accessToken: 'token-real', refreshToken: 'refresh-real' }) })
describe('GET unico da Carteira com token VRS', () => {
  it('usa host/path fixos, GET, Bearer VRS e CNPJ/data do contexto; nao envia key/secret/certificado', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([{ carteiras: [{ cnpjFundo: input.cnpjFundo }], ativos: [], passivos: [] }])))
    const result = await consultarCarteiraComTokenVrs(input, request)
    expect(login).toHaveBeenCalledExactlyOnceWith(config)
    expect(request).toHaveBeenCalledTimes(1)
    const [url, init] = request.mock.calls[0]
    expect(String(url)).toBe('https://apis.vortx.com.br/carteira-liberada/buscarCarteiraJSON?cnpjFundos%5B%5D=68522785000104&dataCarteira=2026-10-16')
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer token-real', Accept: 'application/json' } })
    expect(JSON.stringify(init)).not.toContain(config.secret)
    expect(result.statusHttp).toBe(200)
    expect(result.resposta).toContain(input.cnpjFundo)
  })
  it.each([401, 403, 429, 500])('preserva HTTP %s sem retry ou troca de credencial', async status => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"message":"unauthorized"}', { status }))
    expect((await consultarCarteiraComTokenVrs(input, request)).statusHttp).toBe(status)
    expect(request).toHaveBeenCalledTimes(1); expect(login).toHaveBeenCalledTimes(1)
  })
  it('nao segue redirect nem retorna Location', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://outro.test' } }))
    const result = await consultarCarteiraComTokenVrs(input, request)
    expect(result.statusHttp).toBe(302); expect(request).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toContain('outro.test')
  })
  it('remove tokens, key/secret, PEM, nomes sensiveis e ecos em mensagem', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ access_token: 'desconhecido', nested: { senha: 'privada' }, message: 'token-real refresh-real key-secreta secret-real cert-pem priv-pem' }), { status: 401 }))
    const result = await consultarCarteiraComTokenVrs(input, request)
    for (const secret of ['desconhecido', 'privada', 'token-real', 'refresh-real', config.key, config.secret, 'cert-pem', 'priv-pem']) expect(result.resposta).not.toContain(secret)
    expect(result.respostaRedigida).toBe(true)
  })
  it('omite HTML inesperado', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>token-desconhecido</html>', { status: 401 }))
    const result = await consultarCarteiraComTokenVrs(input, request)
    expect(result.statusHttp).toBe(401); expect(result.resposta).not.toContain('token-desconhecido')
  })
  it('redige API keys desconhecidas e links pre-assinados', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ api_key: 'key-desconhecida', credentials: 'credencial-desconhecida', message: 'https://s3.example/file?X-Amz-Signature=assinatura' }), { status: 403 }))
    const result = await consultarCarteiraComTokenVrs(input, request)
    expect(result.resposta).not.toMatch(/key-desconhecida|credencial-desconhecida|assinatura/)
  })
  it('nao revela resposta de outro Fundo', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([{ carteiras: [{ cnpjFundo: '11111111111111' }], ativos: ['dado-real'] }])))
    await expect(consultarCarteiraComTokenVrs(input, request)).rejects.toThrow('UNEXPECTED_FUND_RESPONSE_SCOPE')
  })
  it('nao aceita 200 em formato desconhecido', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"foo":"bar"}'))
    await expect(consultarCarteiraComTokenVrs(input, request)).rejects.toThrow('UNEXPECTED_FUND_RESPONSE_SCOPE')
  })
  it('preserva array vazio sem inventar carteira', async () => {
    expect((await consultarCarteiraComTokenVrs(input, vi.fn<typeof fetch>().mockResolvedValue(new Response('[]')))).resposta).toBe('[]')
  })
  it('limita resposta recebida', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(256 * 1024 + 1), { status: 401 }))
    await expect(consultarCarteiraComTokenVrs(input, request)).rejects.toThrow('RESPONSE_TOO_LARGE')
  })
  it('limita resposta exibida com aviso', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ message: 'x'.repeat(70000) }), { status: 400 }))
    expect((await consultarCarteiraComTokenVrs(input, request)).resposta).toContain('RESPOSTA TRUNCADA')
  })
  it('nao repete erro de rede nem falha do login', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('network'))
    await expect(consultarCarteiraComTokenVrs(input, request)).rejects.toThrow('network')
    expect(request).toHaveBeenCalledTimes(1)
    request.mockClear(); login.mockRejectedValue(new Error('login'))
    await expect(consultarCarteiraComTokenVrs(input, request)).rejects.toThrow('login')
    expect(request).not.toHaveBeenCalled()
  })
  it.each([{ ...config, ambiente: 'homologacao' as const }, { ...config, baseUrl: 'https://outro.test' }])('nega configuracao fora do escopo antes do login', async configInvalida => {
    const request = vi.fn<typeof fetch>()
    await expect(consultarCarteiraComTokenVrs({ ...input, config: configInvalida }, request)).rejects.toThrow('DIAGNOSTIC_CONTEXT_INVALID')
    expect(login).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled()
  })
})
