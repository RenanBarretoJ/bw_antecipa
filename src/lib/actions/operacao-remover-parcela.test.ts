import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), fundo: vi.fn(), revalidate: vi.fn(), link: true }))
vi.mock('@/lib/auth/authorization', () => ({ AuthorizationError: class extends Error {}, requireGestor: mocks.auth, requireAuthenticated: vi.fn() }))
vi.mock('@/lib/fundos/fundo-ativo.server', () => ({ obterFundoAtivoAutorizado: mocks.fundo }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(), createClient: async () => ({
  rpc: mocks.rpc,
  from: (table: string) => {
    const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ error: null,
      data: table === 'operacoes' ? { id: 'op', cedente_fundo_id: 'cf' } : mocks.link ? { id: 'cf' } : null }) }
    return builder
  },
}) }))

import { removerParcelaDaOperacao } from './operacao'

const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'] as const
describe('retirada de parcela — Server Action', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.link = true; mocks.auth.mockResolvedValue({}); mocks.fundo.mockResolvedValue({ fundoId: 'fundo' }); mocks.rpc.mockResolvedValue({ error: null, data: { numero_nf: '123', numero_parcela: 2, operacao_cancelada: false, nf_retirada: false } }) })
  it('exige autorização de Gestor antes de chamar o banco', async () => {
    mocks.auth.mockRejectedValue(new Error('Acesso negado'))
    await expect(removerParcelaDaOperacao(...ids)).rejects.toThrow('Acesso negado')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('nega IDs inválidos sem executar a RPC', async () => {
    expect(await removerParcelaDaOperacao(ids[0], ids[1], 'inválido')).toMatchObject({ success: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('nega operação fora do fundo ativo mesmo com um ID válido', async () => {
    mocks.link = false
    expect(await removerParcelaDaOperacao(...ids)).toMatchObject({ success: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('envia a identidade completa e revalida as listas somente após confirmação do banco', async () => {
    expect(await removerParcelaDaOperacao(...ids)).toMatchObject({ success: true, message: expect.stringContaining('demais parcelas foram preservadas') })
    expect(mocks.rpc).toHaveBeenCalledWith('remover_parcela_operacao_gestor_atomica', { p_operacao_id: ids[0], p_nota_fiscal_id: ids[1], p_parcela_id: ids[2] })
    expect(mocks.revalidate).toHaveBeenCalledWith(`/gestor/operacoes/${ids[0]}`)
  })
  it('não expõe SQL ou stack trace numa falha da RPC', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.rpc.mockResolvedValue({ error: { code: '22023', message: 'SQL private.table stack secret' }, data: null })
      const result = await removerParcelaDaOperacao(...ids)
      expect(result?.success).toBe(false)
      expect(result?.message).not.toMatch(/SQL|private|stack|secret/)
      expect(mocks.revalidate).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })
  it('informa cancelamento ao retirar a última parcela da última NF', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { numero_nf: '123', numero_parcela: 1, operacao_cancelada: true, nf_retirada: true } })
    expect(await removerParcelaDaOperacao(...ids)).toMatchObject({ success: true, message: expect.stringContaining('cancelada') })
  })
})
