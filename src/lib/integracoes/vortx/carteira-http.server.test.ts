import { beforeEach, describe, expect, it, vi } from 'vitest'
const { login } = vi.hoisted(() => ({ login: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./vortx-vrs-client.server', () => ({ autenticarVortxVrs: login }))
import { consultarOriginalCarteiraVortx } from './carteira-http.server'
import type { VortxVrsConfig } from './credenciais.server'
const config: VortxVrsConfig = { fundoId: 'qa', ambiente: 'producao', baseUrl: 'https://api.vortx.com.br', key: 'qa-key', secret: 'qa-secret', credential: { certificadoPem: 'qa-cert', chavePrivadaPem: 'qa-private' } }
const input = { config, cnpjFundo: '98000000000196', dataReferencia: '2026-10-20' }
beforeEach(() => { vi.resetAllMocks(); login.mockResolvedValue({ accessToken: 'qa-token' }) })
describe('original Carteira JSON limitado e privado', () => {
  it('conserva os bytes originais sem truncar/redigir; GET unico fixo sem enviar chave/certificado', async () => {
    const text = '[ {"carteiras": [], "ativos": []} ]\n'
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(text))
    const result = await consultarOriginalCarteiraVortx(input, request)
    expect(result.arquivo.toString()).toBe(text)
    expect(result.resposta).toEqual(JSON.parse(text))
    expect(request).toHaveBeenCalledOnce()
    const [url, init] = request.mock.calls[0]
    expect(String(url)).toBe('https://apis.vortx.com.br/carteira-liberada/buscarCarteiraJSON?cnpjFundos%5B%5D=98000000000196&dataCarteira=2026-10-20')
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer qa-token', Accept: 'application/json' } })
    for (const secret of [config.key, config.secret, config.credential.certificadoPem, config.credential.chavePrivadaPem]) expect(JSON.stringify(init)).not.toContain(secret)
  })
  it.each([201, 204, 302, 401, 403, 429, 500])('recusa HTTP %s sem expor corpo nem repetir', async status => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(status === 204 ? null : 'sensitive', { status }))
    await expect(consultarOriginalCarteiraVortx(input, request)).rejects.toMatchObject({ codigo: 'HTTP_RECUSADO', statusHttp: status })
    expect(request).toHaveBeenCalledOnce()
  })
  it.each(['', '<html>invalid</html>', '{'])('recusa corpo invalido %j', async body => {
    await expect(consultarOriginalCarteiraVortx(input, vi.fn<typeof fetch>().mockResolvedValue(new Response(body)))).rejects.toThrow('RESPOSTA_INVALIDA')
  })
  it('recusa UTF8 invalido', async () => {
    await expect(consultarOriginalCarteiraVortx(input, vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([0xff]))))).rejects.toThrow('RESPOSTA_INVALIDA')
  })
  it('recusa acima de 20 MiB', async () => {
    await expect(consultarOriginalCarteiraVortx(input, vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(20 * 1024 * 1024 + 1))))).rejects.toThrow('RESPOSTA_EXCESSIVA')
  })
  it.each([
    { ...input, config: { ...config, ambiente: 'homologacao' as const } },
    { ...input, config: { ...config, baseUrl: 'https://outro.invalid' } },
    { ...input, cnpjFundo: 'invalid' }, { ...input, dataReferencia: '2026-02-30' },
  ])('recusa contexto invalido antes de autenticar', async invalid => {
    await expect(consultarOriginalCarteiraVortx(invalid, vi.fn())).rejects.toThrow('CONTEXTO_INVALIDO')
    expect(login).not.toHaveBeenCalled()
  })
  it('nao repete falha de transporte', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('network'))
    await expect(consultarOriginalCarteiraVortx(input, request)).rejects.toThrow('network')
    expect(request).toHaveBeenCalledOnce()
  })
})
