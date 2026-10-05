import { beforeEach, describe, expect, it, vi } from 'vitest'
import { carregarGestaoSacados } from './gestao.server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), rpc: vi.fn(), order: vi.fn() }))
vi.mock('@/lib/auth/authorization', () => ({ requireRole: mocks.auth }))
vi.mock('@/lib/gestor/contexto-fundo.server', () => ({ resolverContextoFundoGestor: mocks.context }))
const fundos = [{ id: 'primeiro', nome: 'Alfabético' }, { id: 'ativo', nome: 'Fundo ativo' }]
beforeEach(() => {
  vi.clearAllMocks()
  mocks.order.mockResolvedValue({ data: fundos, error: null })
  mocks.auth.mockResolvedValue({ profile: { role: 'gestor' }, supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: mocks.order }) }) }), rpc: mocks.rpc,
  } })
  mocks.context.mockResolvedValue({ fundoId: 'ativo' })
  mocks.rpc.mockResolvedValue({ data: { total: 0, usuarios: [], acessos: [], pode_editar: false }, error: null })
})
describe('Contexto inicial da gestão de sacados', () => {
  it('usa o fundo ativo autorizado, não o primeiro em ordem alfabética', async () => {
    expect((await carregarGestaoSacados({})).fundo.id).toBe('ativo')
    expect(mocks.rpc).toHaveBeenCalledWith('listar_gestao_sacados', expect.objectContaining({ p_fundo_id: 'ativo' }))
  })
  it('preserva filtro explícito autorizado', async () => {
    expect((await carregarGestaoSacados({ fundo: 'primeiro' })).fundo.id).toBe('primeiro')
    expect(mocks.context).not.toHaveBeenCalled()
  })
  it('não consulta RPC com fundo fora da lista autorizada', async () => {
    await expect(carregarGestaoSacados({ fundo: 'nao-autorizado' })).rejects.toThrow('Selecione um Fundo autorizado.')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('não troca silenciosamente de fundo quando contexto falha', async () => {
    mocks.context.mockRejectedValue(new Error('Sem fundo autorizado'))
    await expect(carregarGestaoSacados({})).rejects.toThrow('Sem fundo autorizado')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('preserva seleção administrativa sem contexto de gestor', async () => {
    const auth = await mocks.auth()
    mocks.auth.mockResolvedValue({ ...auth, profile: { role: 'super_admin' } })
    expect((await carregarGestaoSacados({})).fundo.id).toBe('primeiro')
    expect(mocks.context).not.toHaveBeenCalled()
  })
})
