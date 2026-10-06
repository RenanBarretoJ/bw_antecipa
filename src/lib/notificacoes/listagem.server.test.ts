import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '@/lib/auth/authorization'
import { encodeCursor } from '@/lib/pagination/cursor'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), validar: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/authorization', () => ({ requireAuthenticated: mocks.auth }))
vi.mock('./contexto.server', () => ({ validarContextoNotificacoes: mocks.validar }))
import { carregarNotificacoesUsuario, contarNotificacoesDoContext } from './listagem.server'
const A = '00000000-0000-4000-8000-000000000002'
const user = '00000000-0000-4000-8000-000000000001'
const escopo = { scope: 'FUNDO' as const, fundoId: A }
const row = { id: user, created_at: '2026-10-06T10:00:00.123456Z', titulo: 'QA', mensagem: 'QA', tipo: 'nf_aprovada', lida: false, scope_type: 'FUNDO', fundo_id: A }
describe('notificações: leitura oficial com sessão e contexto explícito', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ user: { id: user }, supabase: { rpc: mocks.rpc } })
    mocks.rpc.mockImplementation(async (name: string) => name === 'contar_notificacoes' ? { data: [{ total: 3, nao_lidas: 2 }], error: null } : { data: [row], error: null })
  })
  it('conta via RPC session-bound e Fundo explícito, sem admin', async () => {
    await expect(contarNotificacoesDoContext(await mocks.auth() as AuthContext, escopo)).resolves.toEqual({ total: 3, naoLidas: 2 })
    expect(mocks.rpc).toHaveBeenCalledWith('contar_notificacoes', { p_scope: 'FUNDO', p_fundo_id: A })
    const source = readFileSync('src/lib/notificacoes/listagem.server.ts','utf8')
    expect(source).not.toContain('createAdminClient')
    expect(source).not.toContain(".from('notificacoes')")
  })
  it('valida Fundo canônico antes de qualquer consulta e envia filtro no servidor', async () => {
    const page = await carregarNotificacoesUsuario({ escopo, filtro: 'documentos' })
    expect(mocks.validar).toHaveBeenCalledWith(await mocks.auth(), escopo)
    expect(mocks.rpc).toHaveBeenCalledWith('listar_notificacoes_filtradas', { p_scope: 'FUNDO', p_fundo_id: A, p_filtro: 'documentos', p_limit: 21, p_cursor_em: null, p_cursor_id: null })
    expect(page.items).toHaveLength(1)
    expect(page.items[0].fundoId).toBe(A)
  })
  it('não consulta se contexto foi trocado ou está proibido', async () => {
    mocks.validar.mockRejectedValue(new Error('Fundo mudou'))
    await expect(carregarNotificacoesUsuario({ escopo })).rejects.toThrow('Fundo mudou')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('preserva microsegundos no cursor e limita antes de consultar', async () => {
    const cursor = encodeCursor({ id: user, createdAt: row.created_at })
    await carregarNotificacoesUsuario({ escopo, cursor, limit: 999 })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_notificacoes_filtradas', expect.objectContaining({ p_cursor_em: row.created_at, p_cursor_id: user, p_limit: 40 }))
  })
  it('rejeita cursor inválido sem reiniciar página silenciosamente', async () => {
    await expect(carregarNotificacoesUsuario({ escopo, cursor: 'bad' })).rejects.toThrow('Cursor')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('separa GLOBAL de FUNDO, sem null significar todos os Fundos', async () => {
    await carregarNotificacoesUsuario({ escopo: { scope: 'GLOBAL', fundoId: null } })
    expect(mocks.rpc).toHaveBeenCalledWith('contar_notificacoes', { p_scope: 'GLOBAL', p_fundo_id: null })
  })
  it('limita página e produz cursor determinístico', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'contar_notificacoes' ? [{ total: 2, nao_lidas: 2 }] : [row, { ...row, id: A }], error: null }))
    const page = await carregarNotificacoesUsuario({ escopo, limit: 1 })
    expect(page.hasMore).toBe(true)
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBe(encodeCursor({ id: user, createdAt: row.created_at }))
  })
  it('falhas de banco não viram contador zero nem exibem mensagem SQL', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'secret-sql' } })
    await expect(carregarNotificacoesUsuario({ escopo })).rejects.toThrow('Não foi possível')
  })
})
