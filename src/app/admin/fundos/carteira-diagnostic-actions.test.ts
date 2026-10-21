import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const { admin, mfa, resolver, consultar, audit, single, from } = vi.hoisted(() => {
  const single = vi.fn()
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ single }) }) }))
  return { single, from, admin: vi.fn(), mfa: vi.fn(), resolver: vi.fn(), consultar: vi.fn(), audit: vi.fn() }
})
vi.mock('@/lib/auth/admin-authorization', () => ({ requireSuperAdmin: admin }))
vi.mock('@/lib/auth/sensitive-action', () => ({ autorizarEConsumirAcaoSensivel: mfa }))
vi.mock('@/lib/auth/mfa', () => ({ registrarEventoSeguranca: audit }))
vi.mock('@/lib/integracoes/vortx/credenciais.server', () => ({ resolverConfiguracaoVortxVrs: resolver }))
vi.mock('@/lib/integracoes/vortx/carteira-diagnostic.server', () => ({ consultarCarteiraComTokenVrs: consultar }))
import { AuthorizationError } from '@/lib/auth/authorization'
import { diagnosticarCarteiraJsonVrs } from './carteira-diagnostic-actions'
const fundoId = '0df93349-4244-4398-b9a8-db1c036dae7a'
const input = { fundoId, dataCarteira: '2026-10-16', mfaCode: '123456' }
beforeEach(() => {
  vi.resetAllMocks()
  for (const [key, value] of Object.entries({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/vortx-real-data-preview', NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co', VORTX_CARTEIRA_DIAGNOSTIC_ENABLED: 'true', VORTX_CARTEIRA_DIAGNOSTIC_FUNDO_ID: fundoId })) vi.stubEnv(key, value)
  admin.mockResolvedValue({ user: { id: 'ator' }, supabase: { from } })
  single.mockResolvedValue({ data: { id: fundoId, ativo: true, cnpj: '68.522.785/0001-04' }, error: null })
  resolver.mockResolvedValue({ fundoId, ambiente: 'producao' })
  consultar.mockResolvedValue({ statusHttp: 401, endpoint: 'https://apis.vortx.com.br/carteira-liberada/buscarCarteiraJSON', resposta: '{"message":"unauthorized"}' })
})
afterEach(() => vi.unstubAllEnvs())
describe('acao administrativa de diagnostico Carteira', () => {
  it('exige Super Admin, Fundo ativo, MFA, depois resolve credencial e consulta uma vez', async () => {
    const result = await diagnosticarCarteiraJsonVrs(input)
    expect(result).toMatchObject({ success: true, data: { statusHttp: 401 } })
    expect(admin).toHaveBeenCalledTimes(1)
    expect(mfa).toHaveBeenCalledWith(expect.anything(), 'testar_conexao_vortx_vrs', input.mfaCode)
    expect(mfa.mock.invocationCallOrder[0]).toBeLessThan(resolver.mock.invocationCallOrder[0])
    expect(resolver).toHaveBeenCalledExactlyOnceWith(fundoId, 'producao')
    expect(consultar).toHaveBeenCalledExactlyOnceWith({ config: { fundoId, ambiente: 'producao' }, cnpjFundo: '68522785000104', dataCarteira: input.dataCarteira })
    expect(audit).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(audit.mock.calls)).not.toContain(input.mfaCode)
    expect(audit.mock.calls[1][0]).toMatchObject({ tipo_evento: 'CREDENCIAL_USADA', dados: { diagnostico: 'TOKEN_VRS_EM_CARTEIRA_JSON', http_status: 401, etapa: 'CONCLUIDO' } })
    expect(audit.mock.calls[0][0].correlation_id).toBe(audit.mock.calls[1][0].correlation_id)
  })
  it.each(['production', 'development'])('nega ambiente %s sem ler credencial', async value => {
    vi.stubEnv('VERCEL_ENV', value)
    expect(await diagnosticarCarteiraJsonVrs(input)).toMatchObject({ success: false })
    expect(resolver).not.toHaveBeenCalled(); expect(consultar).not.toHaveBeenCalled()
  })
  it('nega outro Fundo, URL, CNPJ ou token enviados pelo cliente', async () => {
    for (const value of [{ ...input, fundoId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, { ...input, endpoint: 'https://outro.test' }, { ...input, cnpjFundo: '11111111111111' }, { ...input, token: 'token' }]) expect(await diagnosticarCarteiraJsonVrs(value)).toMatchObject({ success: false })
    expect(consultar).not.toHaveBeenCalled(); expect(resolver).not.toHaveBeenCalled()
  })
  it.each(['sem sessao', 'gestor comum', 'sessao revogada'])('interrompe %s antes do MFA e da credencial', async message => {
    admin.mockRejectedValue(new AuthorizationError(message, 'FORBIDDEN'))
    expect(await diagnosticarCarteiraJsonVrs(input)).toEqual({ success: false, message })
    expect(mfa).not.toHaveBeenCalled(); expect(resolver).not.toHaveBeenCalled()
  })
  it('bloqueia TOTP invalido, expirado ou nonce reutilizado', async () => {
    mfa.mockRejectedValue(new AuthorizationError('MFA invalido', 'FORBIDDEN'))
    expect(await diagnosticarCarteiraJsonVrs(input)).toMatchObject({ success: false, message: 'MFA invalido' })
    expect(resolver).not.toHaveBeenCalled(); expect(consultar).not.toHaveBeenCalled()
  })
  it('nega Fundo inexistente ou inativo antes do login', async () => {
    single.mockResolvedValue({ data: { ativo: false }, error: null })
    expect(await diagnosticarCarteiraJsonVrs(input)).toMatchObject({ success: false })
    expect(resolver).not.toHaveBeenCalled(); expect(consultar).not.toHaveBeenCalled()
  })
  it('nega datas futuras', async () => {
    expect(await diagnosticarCarteiraJsonVrs({ ...input, dataCarteira: '9999-12-31' })).toMatchObject({ success: false })
    expect(mfa).not.toHaveBeenCalled(); expect(consultar).not.toHaveBeenCalled()
  })
  it('falha fechada se auditoria inicial falhar', async () => {
    audit.mockRejectedValue(new Error('AUDIT_FAILED'))
    expect(await diagnosticarCarteiraJsonVrs(input)).toMatchObject({ success: false })
    expect(consultar).not.toHaveBeenCalled()
  })
  it('nao vaza erros de rede ou credenciais e nao repete', async () => {
    consultar.mockRejectedValue(new Error('Bearer secret-real senha-real'))
    const result = await diagnosticarCarteiraJsonVrs(input)
    expect(result.success).toBe(false); expect(JSON.stringify(result)).not.toMatch(/secret-real|senha-real/)
    expect(consultar).toHaveBeenCalledTimes(1)
  })
})
