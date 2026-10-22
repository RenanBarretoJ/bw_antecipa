import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { carregarHistoricoCarteiraVortx, carregarPosicaoCarteiraVortx } from './carteira-posicao.server'
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
    expect(order).toHaveBeenCalledExactlyOnceWith('data_referencia', { ascending: false })
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

describe('histórico canônico da carteira', () => {
  const range = vi.fn(), status = vi.fn()
  const record = { ...row, recebida_em: '2026-10-22T14:06:59+00:00', publicada_em: '2026-10-22T14:06:59+00:00', substituida_em: null }
  beforeEach(() => {
    const builder = { eq, order, range, in: status }
    select.mockReturnValue(builder); eq.mockReturnValue(builder); order.mockReturnValue(builder); status.mockReturnValue(builder)
    range.mockResolvedValue({ data: [record], error: null, count: 1 })
  })
  it('pagina no banco por referência, publicação e ID com projeção restrita ao DTO', async () => {
    const result = await carregarHistoricoCarteiraVortx(client, fund, { carteiraPagina: '2' })
    expect(eq).toHaveBeenCalledWith('fundo_id', fund); expect(eq).toHaveBeenCalledWith('provedor', 'VORTX'); expect(eq).toHaveBeenCalledWith('fonte_ambiente', 'producao'); expect(eq).toHaveBeenCalledWith('tipo_base', 'CARTEIRA')
    expect(status).toHaveBeenCalledWith('status', ['PUBLICADA', 'RETIFICADA']); expect(range).toHaveBeenCalledWith(20, 39)
    expect(order.mock.calls).toEqual([['data_referencia', { ascending: false }], ['publicada_em', { ascending: false }], ['id', { ascending: false }]])
    expect(result).toMatchObject({ total: 1, pagina: 2, registros: [{ estado: 'PUBLICADA', cotas: row.metadados.cotas }] })
    expect(result.registros[0]).not.toHaveProperty('metadados'); expect(result.registros[0]).not.toHaveProperty('storage_path'); expect(result.registros[0]).not.toHaveProperty('fundo_id')
    expect(select.mock.calls[0][0]).not.toMatch(/storage|hash|contexto|lease|\*/)
  })
  it('filtra apenas situação e data validadas, sem aceitar Fundo ou predicados da URL', async () => {
    await carregarHistoricoCarteiraVortx(client, fund, { carteiraEstado: 'RETIFICADA', carteiraReferencia: '2026-10-20', fundoId: 'other' })
    expect(eq).toHaveBeenCalledWith('status', 'RETIFICADA'); expect(eq).toHaveBeenCalledWith('data_referencia', '2026-10-20'); expect(eq).not.toHaveBeenCalledWith('fundo_id', 'other')
  })
  it('ignora parâmetros duplicados ou inválidos sem ampliar o conjunto de estados', async () => {
    await carregarHistoricoCarteiraVortx(client, fund, { carteiraEstado: ['PUBLICADA', 'RETIFICADA'], carteiraReferencia: '2026-02-30', carteiraPagina: '-2' })
    expect(eq).not.toHaveBeenCalledWith('status', expect.anything()); expect(eq).not.toHaveBeenCalledWith('data_referencia', expect.anything()); expect(range).toHaveBeenCalledWith(0, 19)
  })
  it('preserva a versão retificada sem a apresentar como vigente', async () => {
    range.mockResolvedValue({ data: [{ ...record, status: 'RETIFICADA', substituida_em: '2026-10-22T15:00:00Z' }], error: null, count: 1 })
    expect((await carregarHistoricoCarteiraVortx(client, fund)).registros[0].estado).toBe('RETIFICADA')
  })
  it('distingue conjunto vazio de erro de leitura ou contagem', async () => {
    range.mockResolvedValue({ data: [], error: null, count: 0 })
    expect(await carregarHistoricoCarteiraVortx(client, fund)).toMatchObject({ registros: [], total: 0 })
    range.mockResolvedValue({ data: null, error: { code: '42501' }, count: null })
    await expect(carregarHistoricoCarteiraVortx(client, fund)).rejects.toThrow('CARTEIRA_HISTORICO_INDISPONIVEL')
    range.mockResolvedValue({ data: [], error: null, count: null })
    await expect(carregarHistoricoCarteiraVortx(client, fund)).rejects.toThrow('CARTEIRA_HISTORICO_INDISPONIVEL')
  })
  it('rejeita resposta fora do Fundo e posição com dados fiscais inválidos', async () => {
    range.mockResolvedValue({ data: [{ ...record, fundo_id: 'other' }], error: null, count: 1 })
    await expect(carregarHistoricoCarteiraVortx(client, fund)).rejects.toThrow('CARTEIRA_LEITURA_FORA_DO_ESCOPO')
    range.mockResolvedValue({ data: [{ ...record, valor_total: 'NaN' }], error: null, count: 1 })
    await expect(carregarHistoricoCarteiraVortx(client, fund)).rejects.toThrow('CARTEIRA_PL_INVALIDO')
  })
})
