import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), validar: vi.fn() }))
vi.mock('@/lib/auth/authorization', () => ({ requireAuthenticated: m.auth }))
vi.mock('./contexto.server', () => ({ validarContextoNotificacoes: m.validar }))
import { resolverDestinoNotificacao } from './destino.server'
const escopo = { scope: 'FUNDO' as const, fundoId: 'A' }
describe('href: revalidação server-side antes de navegar', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.auth.mockResolvedValue({ profile: { role: 'gestor' }, supabase: { rpc: m.rpc } })
    m.rpc.mockResolvedValue({ data: [{ entidade_tipo: 'nota_fiscal', entidade_id: 'NF', fundo_id: 'A' }], error: null })
  })
  it('resolve apenas entidade do Fundo ativo com a sessão atual', async () => {
    expect(await resolverDestinoNotificacao('N', escopo)).toBe('/gestor/notas-fiscais/NF?fundo=A')
    expect(m.validar).toHaveBeenCalledWith(await m.auth(), escopo)
    expect(m.rpc).toHaveBeenCalledWith('obter_destino_notificacao', { p_id: 'N', p_scope: 'FUNDO', p_fundo_id: 'A' })
  })
  it('contexto trocado nega antes de resolver entidade', async () => {
    m.validar.mockRejectedValue(new Error('troca'))
    await expect(resolverDestinoNotificacao('N', escopo)).rejects.toThrow()
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('entidade que não pertence ao Fundo é rejeitada', async () => {
    m.rpc.mockResolvedValue({ data: [{ entidade_tipo: 'nota_fiscal', entidade_id: 'NF', fundo_id: 'B' }] })
    await expect(resolverDestinoNotificacao('N', escopo)).rejects.toThrow('Contexto divergente')
  })
  it('não usa fallback de href quando RPC nega o destinatário', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(resolverDestinoNotificacao('N', escopo)).rejects.toThrow('não autorizado')
  })
  it('Sacado usa detalhe protegido da entidade, nunca listagem multifundo sem filtro', async () => {
    m.auth.mockResolvedValue({ profile: { role: 'sacado' }, supabase: { rpc: m.rpc } })
    expect(await resolverDestinoNotificacao('N', escopo)).toBe('/notificacoes/detalhe/N?fundo=A')
  })
})
