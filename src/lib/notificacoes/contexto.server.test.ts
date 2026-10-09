import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '@/lib/auth/authorization'
const m = vi.hoisted(() => ({ rpc: vi.fn(), cookies: vi.fn(), gestor: vi.fn(), cedente: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: m.cookies }))
vi.mock('@/lib/gestor/contexto-fundo.server', () => ({ resolverContextoFundoGestor: m.gestor }))
vi.mock('@/lib/fundos/cedente-fundo', () => ({ resolverCedenteFundoAtivo: m.cedente, CedenteFundoError: class extends Error { constructor(public message: string, public code: string) { super(message) } } }))
import { resolverContextoNotificacoes, validarContextoNotificacoes } from './contexto.server'
import { CedenteFundoError } from '@/lib/fundos/cedente-fundo'
const auth = (role: string) => ({ user: { id: 'U' }, profile: { role }, supabase: { rpc: m.rpc } }) as unknown as AuthContext
describe('contexto canônico das notificações', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.rpc.mockImplementation(async (name) => ({ data: name === 'get_user_cedente_id' ? 'C' : [{ id: 'A', nome: 'Fundo A' }, { id: 'B', nome: 'Fundo B' }], error: null }))
    m.cookies.mockResolvedValue({ get: () => ({ value: 'B' }) })
    m.gestor.mockResolvedValue({ fundoId: 'A' })
    m.cedente.mockResolvedValue({ fundo: { id: 'A' } })
  })
  it('gestor usa seletor global canônico, não cookie de notificações', async () => {
    expect(await resolverContextoNotificacoes(auth('gestor'))).toMatchObject({ fundoId: 'A', seletorProprio: false })
    expect(m.gestor).toHaveBeenCalled()
    expect(m.cookies).not.toHaveBeenCalled()
  })
  it('cedente usa vínculo operacional canônico', async () => {
    expect(await resolverContextoNotificacoes(auth('cedente'))).toMatchObject({ fundoId: 'A', seletorProprio: false })
    expect(m.cedente).toHaveBeenCalledWith('C', expect.anything())
  })
  it('não escolhe primeiro vínculo quando cedente multifundo ainda não selecionou', async () => {
    m.cedente.mockRejectedValue(new CedenteFundoError('Selecionar', 'MULTIPLOS_VINCULOS_ATIVOS'))
    expect((await resolverContextoNotificacoes(auth('cedente'))).fundoId).toBeNull()
  })
  it.each(['sacado', 'consultor'])('%s seleciona apenas contexto autorizado', async (role) => {
    expect(await resolverContextoNotificacoes(auth(role))).toMatchObject({ fundoId: 'B', seletorProprio: true })
    m.cookies.mockResolvedValue({ get: () => ({ value: 'C' }) })
    expect((await resolverContextoNotificacoes(auth(role))).fundoId).toBe('A')
  })
  it('nega contexto B mesmo autorizado se o gestor está em A', async () => {
    await expect(validarContextoNotificacoes(auth('gestor'), { scope: 'FUNDO', fundoId: 'B' })).rejects.toThrow('Fundo mudou')
    await expect(validarContextoNotificacoes(auth('gestor'), { scope: 'FUNDO', fundoId: 'A' })).resolves.toBeUndefined()
  })
  it('não aceita GLOBAL com Fundo nem scope indefinido', async () => {
    await expect(validarContextoNotificacoes(auth('gestor'), { scope: 'GLOBAL', fundoId: 'A' } as never)).rejects.toThrow()
    await expect(validarContextoNotificacoes(auth('gestor'), null as never)).rejects.toThrow()
  })
  it('erros não retornam fallback de todos os Fundos', async () => {
    m.rpc.mockResolvedValue({ error: { code: '42501' }, data: null })
    await expect(resolverContextoNotificacoes(auth('gestor'))).rejects.toThrow()
  })
})
