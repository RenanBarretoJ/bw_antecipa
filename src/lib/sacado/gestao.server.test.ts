import { beforeEach, describe, expect, it, vi } from 'vitest'
import { carregarGestaoSacados } from './gestao.server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), context: vi.fn(), rpc: vi.fn(), order: vi.fn() }))
vi.mock('@/lib/auth/authorization', () => ({ requireRole: mocks.auth }))
vi.mock('@/lib/auth/admin-authorization', () => ({ requireSuperAdmin: mocks.admin }))
vi.mock('@/lib/gestor/contexto-fundo.server', () => ({ resolverContextoFundoGestor: mocks.context }))
const fundos = [{ id: 'primeiro', nome: 'Alfabético' }, { id: 'ativo', nome: 'Fundo ativo' }]
beforeEach(() => {
  vi.clearAllMocks()
  mocks.order.mockResolvedValue({ data: fundos, error: null })
  mocks.auth.mockResolvedValue({ profile: { role: 'gestor' }, supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: mocks.order }) }) }), rpc: mocks.rpc,
  } })
  mocks.context.mockResolvedValue({ fundoId: 'ativo' })
  mocks.admin.mockImplementation(() => mocks.auth())
  mocks.rpc.mockResolvedValue({ data: { total: 0, usuarios: [], acessos: [], pode_editar: false }, error: null })
})
describe('Contexto inicial da gestão de sacados', () => {
  it('usa o fundo ativo autorizado, não o primeiro em ordem alfabética', async () => {
    expect((await carregarGestaoSacados({})).fundo.id).toBe('ativo')
    expect(mocks.rpc).toHaveBeenCalledWith('listar_gestao_sacados', expect.objectContaining({ p_fundo_id: 'ativo' }))
  })
  it.each(['primeiro', 'nao-autorizado', ['primeiro', 'ativo']])('ignora fundo da URL do gestor: %s', async fundo => {
    const result = await carregarGestaoSacados({ fundo })
    expect(result.fundo.id).toBe('ativo')
    expect(result.podeSelecionarFundo).toBe(false)
    expect(mocks.context).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledWith('listar_gestao_sacados', expect.objectContaining({ p_fundo_id: 'ativo' }))
  })
  it('não consulta RPC quando contexto aponta para fundo indisponível', async () => {
    mocks.context.mockResolvedValue({ fundoId: 'indisponivel' })
    await expect(carregarGestaoSacados({})).rejects.toThrow('Selecione um Fundo autorizado.')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('não troca silenciosamente de fundo quando contexto falha', async () => {
    mocks.context.mockRejectedValue(new Error('Sem fundo autorizado'))
    await expect(carregarGestaoSacados({ fundo: 'primeiro' })).rejects.toThrow('Sem fundo autorizado')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('preserva seleção administrativa sem contexto de gestor', async () => {
    const auth = await mocks.auth()
    mocks.auth.mockResolvedValue({ ...auth, profile: { role: 'super_admin' } })
    expect((await carregarGestaoSacados({}, 'admin')).fundo.id).toBe('primeiro')
    expect(mocks.context).not.toHaveBeenCalled()
  })
  it('mantém filtro explícito para super admin', async () => {
    const auth = await mocks.auth()
    mocks.auth.mockResolvedValue({ ...auth, profile: { role: 'super_admin' } })
    const result = await carregarGestaoSacados({ fundo: 'ativo' }, 'admin')
    expect(result.fundo.id).toBe('ativo')
    expect(result.podeSelecionarFundo).toBe(true)
    expect(mocks.context).not.toHaveBeenCalled()
    await expect(carregarGestaoSacados({ fundo: 'inexistente' }, 'admin')).rejects.toThrow('Selecione um Fundo autorizado.')
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
  it('usuário multi-papel escolhe fundo somente no portal administrativo', async () => {
    expect((await carregarGestaoSacados({ fundo: 'primeiro' }, 'admin')).fundo.id).toBe('primeiro')
    expect(mocks.admin).toHaveBeenCalledOnce()
    expect((await carregarGestaoSacados({ fundo: 'primeiro' }, 'gestor')).fundo.id).toBe('ativo')
    expect(mocks.context).toHaveBeenCalledOnce()
  })
  it('nega modo administrativo sem autorização independente do perfil principal', async () => {
    mocks.admin.mockRejectedValue(new Error('Sem acesso administrativo'))
    await expect(carregarGestaoSacados({}, 'admin')).rejects.toThrow('Sem acesso administrativo')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('super admin no portal gestor também segue o fundo ativo', async () => {
    const auth = await mocks.auth()
    mocks.auth.mockResolvedValue({ ...auth, profile: { role: 'super_admin' } })
    expect((await carregarGestaoSacados({ fundo: 'primeiro' })).fundo.id).toBe('ativo')
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
