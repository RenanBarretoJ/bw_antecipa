import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { carregarPosicaoCarteiraVortx } from './carteira-posicao.server'
import type { AppSupabaseClient } from '@/lib/auth/authorization'
const fund = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const row = { id: 'qa-import', fundo_id: fund, data_referencia: '2026-10-21', valor_total: '30.0000', status: 'PUBLICADA', metadados: { cotas: [{ codigoCarteira: 'QA', rotulo: 'Cota QA', patrimonioLiquido: '30.0000' }] } }
const last = vi.fn(), eq = vi.fn(), order = vi.fn(), limit = vi.fn(), select = vi.fn(), from = vi.fn()
const client = { from } as never as AppSupabaseClient
beforeEach(() => {
  vi.resetAllMocks(); from.mockReturnValue({ select }); select.mockReturnValue({ eq }); eq.mockReturnValue({ eq, order }); order.mockReturnValue({ limit }); limit.mockReturnValue({ maybeSingle: last }); last.mockResolvedValue({ data: row, error: null })
})
describe('leitura canonica da carteira com cliente autenticado', () => {
  it('limita a um registro, Fundo e fonte; nao expoe ID, metadados extras ou arquivo bruto', async () => {
    const result = await carregarPosicaoCarteiraVortx(client, fund)
    expect(eq).toHaveBeenCalledWith('fundo_id', fund); expect(eq).toHaveBeenCalledWith('tipo_base', 'CARTEIRA'); expect(eq).toHaveBeenCalledWith('fonte_ambiente', 'producao'); expect(eq).toHaveBeenCalledWith('status', 'PUBLICADA')
    expect(limit).toHaveBeenCalledWith(1); expect(result).toHaveProperty('vigente', true); expect(result).not.toHaveProperty('id'); expect(result).not.toHaveProperty('metadados')
  })
  it('sem publicacao nao inventa valor zero', async () => {
    last.mockResolvedValue({ data: null, error: null }); expect(await carregarPosicaoCarteiraVortx(client, fund)).toBeNull()
  })
  it('confere id de duplicata e distingue historico retificado', async () => {
    last.mockResolvedValue({ data: { ...row, status: 'RETIFICADA' }, error: null })
    expect(await carregarPosicaoCarteiraVortx(client, fund, 'qa-import')).toHaveProperty('vigente', false); expect(eq).toHaveBeenCalledWith('id', 'qa-import')
  })
  it('erro RLS/leitura nao e tratado como posicao vazia', async () => {
    last.mockResolvedValue({ data: null, error: { code: '42501' } }); await expect(carregarPosicaoCarteiraVortx(client, fund)).rejects.toThrow('CARTEIRA_LEITURA_INDISPONIVEL')
  })
  it('rejeita qualquer retorno fora do Fundo', async () => {
    last.mockResolvedValue({ data: { ...row, fundo_id: 'other' }, error: null }); await expect(carregarPosicaoCarteiraVortx(client, fund)).rejects.toThrow('CARTEIRA_LEITURA_FORA_DO_ESCOPO')
  })
})
