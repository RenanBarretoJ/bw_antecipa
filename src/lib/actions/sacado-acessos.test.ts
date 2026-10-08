import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consultarEmpresaSacado, gerenciarAcessoSacado } from './sacado-acessos'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), context: vi.fn(), rpc: vi.fn(), mfa: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/auth/authorization', () => ({ requireRole: mocks.auth }))
vi.mock('@/lib/auth/admin-authorization', () => ({ requireSuperAdmin: mocks.admin }))
vi.mock('@/lib/gestor/contexto-fundo.server', () => ({ resolverContextoFundoGestor: mocks.context }))
vi.mock('@/lib/auth/sensitive-action', () => ({ autorizarEConsumirAcaoSensivel: mocks.mfa }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
const fundo = '10000000-0000-4000-8000-000000000001'
const outro = '10000000-0000-4000-8000-000000000002'
const usuario = '20000000-0000-4000-8000-000000000001'
const state = { success: false, message: '' }
function form(fundoId = fundo) {
  const data = new FormData()
  Object.entries({ usuario, fundo: fundoId, cnpj: '11344038002141', razao: 'Empresa QA', acao: 'adicionar', mfa: '123456', confirmacao: 'on' }).forEach(([key, value]) => data.set(key, value))
  return data
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ profile: { role: 'gestor' }, supabase: { rpc: mocks.rpc } })
  mocks.context.mockResolvedValue({ fundoId: fundo })
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  mocks.mfa.mockResolvedValue({ nonceHash: 'nonce-qa' })
  mocks.admin.mockRejectedValue(new Error('Sem acesso administrativo'))
})
describe('Fundo ativo nas actions de sacados', () => {
  it('consulta empresa no fundo ativo', async () => {
    expect((await consultarEmpresaSacado(fundo, '11.344.038/0021-41')).success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('consultar_empresa_sacado', { p_fundo_id: fundo, p_cnpj: '11344038002141' })
  })
  it('bloqueia consulta e gravação de formulário de outro fundo antes do MFA', async () => {
    const consulta = await consultarEmpresaSacado(outro, '11344038002141')
    const alteracao = await gerenciarAcessoSacado(state, form(outro))
    for (const result of [consulta, alteracao]) {
      expect(result.success).toBe(false)
      expect(result).toHaveProperty('message', expect.stringContaining('fundo ativo mudou'))
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.mfa).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('não redireciona silenciosamente o envio quando o fundo muda em outra aba', async () => {
    mocks.context.mockResolvedValue({ fundoId: outro })
    expect((await gerenciarAcessoSacado(state, form())).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.mfa).not.toHaveBeenCalled()
  })
  it('falha de contexto não vaza erro técnico nem permite acesso', async () => {
    mocks.context.mockRejectedValue(new Error('erro SQL privado'))
    const consulta = await consultarEmpresaSacado(fundo, '11344038002141')
    const alteracao = await gerenciarAcessoSacado(state, form())
    expect(consulta).toEqual({ success: false, message: 'Não foi possível validar o fundo ativo. Atualize a página antes de continuar.' })
    expect(alteracao).toEqual(consulta)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.mfa).not.toHaveBeenCalled()
  })
  it('mantém MFA transacional e RPC para fundo ativo', async () => {
    expect((await gerenciarAcessoSacado(state, form())).success).toBe(true)
    expect(mocks.mfa).toHaveBeenCalledWith(expect.anything(), 'gerenciar_acesso_sacado', '123456', { consumoTransacional: true })
    expect(mocks.rpc).toHaveBeenCalledWith('gerenciar_sacado_acesso', expect.objectContaining({ p_fundo_id: fundo, p_user_id: usuario, p_nonce_hash: 'nonce-qa' }))
    expect(mocks.revalidate).toHaveBeenCalledWith('/gestor/sacados')
  })
  it('preserva escolha administrativa com autorização da RPC e MFA', async () => {
    mocks.admin.mockResolvedValue({ profile: { role: 'gestor' }, roles: ['gestor', 'super_admin'], supabase: { rpc: mocks.rpc } })
    const data = form(outro)
    data.set('contexto', 'admin')
    expect((await consultarEmpresaSacado(outro, '11344038002141', 'admin')).success).toBe(true)
    expect((await gerenciarAcessoSacado(state, data)).success).toBe(true)
    expect(mocks.admin).toHaveBeenCalledTimes(2)
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.mfa).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledWith('gerenciar_sacado_acesso', expect.objectContaining({ p_fundo_id: outro }))
  })
  it('adulterar contexto para admin não contorna autorização', async () => {
    const data = form(outro)
    data.set('contexto', 'admin')
    expect((await gerenciarAcessoSacado(state, data)).success).toBe(false)
    await expect(consultarEmpresaSacado(outro, '11344038002141', 'admin')).rejects.toThrow('Sem acesso administrativo')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.mfa).not.toHaveBeenCalled()
  })
  it('super admin no portal gestor não contorna o fundo ativo', async () => {
    mocks.auth.mockResolvedValue({ profile: { role: 'super_admin' }, supabase: { rpc: mocks.rpc } })
    expect((await gerenciarAcessoSacado(state, form(outro))).success).toBe(false)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('nega mutação quando MFA falha', async () => {
    mocks.mfa.mockRejectedValue(new Error('MFA inválido'))
    expect((await gerenciarAcessoSacado(state, form())).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('mantém negação de autorização da RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    const result = await gerenciarAcessoSacado(state, form())
    expect(result.success).toBe(false)
    expect(result.message).toContain('Acesso negado')
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
