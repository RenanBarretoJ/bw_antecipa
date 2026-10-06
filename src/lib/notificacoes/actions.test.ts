import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), validar: vi.fn(), resolver: vi.fn(), set: vi.fn() }))
vi.mock('@/lib/auth/authorization', () => ({ requireAuthenticated: m.auth }))
vi.mock('@/lib/notificacoes/contexto.server', () => ({ validarContextoNotificacoes: m.validar, resolverContextoNotificacoes: m.resolver, NOTIFICACOES_FUNDO_COOKIE: 'qa' }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: m.set }) }))
import { marcarNotificacoesLidas, selecionarFundoNotificacoes } from '@/lib/actions/notificacoes-listagem'
const scope = { scope: 'FUNDO' as const, fundoId: 'A' }
describe('ações autenticadas por Fundo', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.auth.mockResolvedValue({ user: { id: 'U' }, supabase: { rpc: m.rpc } })
    m.rpc.mockImplementation(async (name) => ({ data: name === 'contar_notificacoes' ? [{ total: 2, nao_lidas: 0 }] : 2, error: null }))
    m.resolver.mockResolvedValue({ seletorProprio: true, fundos: [{ id: 'A' }] })
  })
  it('mark all envia apenas A e nunca update global de own-user', async () => {
    await marcarNotificacoesLidas(scope, null)
    expect(m.rpc).toHaveBeenCalledWith('marcar_notificacoes_lidas', { p_scope: 'FUNDO', p_fundo_id: 'A', p_id: null })
  })
  it('ID malformado não chega ao banco', async () => {
    await expect(marcarNotificacoesLidas(scope, 'bad')).rejects.toThrow()
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('contexto divergente nega mutação antes do RPC', async () => {
    m.validar.mockRejectedValue(new Error('contexto'))
    await expect(marcarNotificacoesLidas(scope, null)).rejects.toThrow()
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('erro do RPC não confirma leitura', async () => {
    m.rpc.mockResolvedValue({ error: { code: '42501' } })
    await expect(marcarNotificacoesLidas(scope, null)).rejects.toThrow('Não foi possível marcar')
  })
  it('seletor próprio proíbe Fundo não autorizado', async () => {
    await expect(selecionarFundoNotificacoes('C')).rejects.toThrow()
    expect(m.set).not.toHaveBeenCalled()
  })
  it('seletor próprio não substitui o seletor canônico do gestor/cedente', async () => {
    m.resolver.mockResolvedValue({ seletorProprio: false, fundos: [{ id: 'A' }] })
    await expect(selecionarFundoNotificacoes('A')).rejects.toThrow()
    expect(m.set).not.toHaveBeenCalled()
  })
})
