import { beforeEach, expect, it, vi } from 'vitest'
import { gerarRemessaOperacional } from './service.server'
import { config, operacao } from './vrs/__fixtures__/operacao'
import { hashRemessa, stableStringify, type RemessaLoteCanonico } from './domain'
import { VRS_LAYOUT_VERSION } from './vrs/xlsx'

const mocks = vi.hoisted(() => ({ from: vi.fn(), loader: vi.fn(), upload: vi.fn(), remove: vi.fn(), log: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: mocks.from, storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) } }) }))
vi.mock('./loader.server', () => ({ carregarLoteRemessaCanonico: mocks.loader }))
vi.mock('@/lib/actions/auditoria', () => ({ registrarLog: mocks.log }))

const rows = new Map<string, Record<string, unknown>[]>()
const deletes: string[] = []
let rejectKeys = false
let lote: RemessaLoteCanonico
beforeEach(() => {
  vi.clearAllMocks()
  rows.clear()
  deletes.length = 0
  rejectKeys = false
  lote = { fundo: { id: 'fundo-1', nome: 'Fundo QA', cnpj: '12345678000195' },
    integracao: { versaoId: 'config-v1', adapterKey: 'vortx_vrs', configuracao: config }, operacoes: [operacao()] }
  mocks.loader.mockImplementation(async () => structuredClone(lote))
  mocks.upload.mockResolvedValue({ error: null })
  mocks.remove.mockResolvedValue({ error: null })
  mocks.from.mockImplementation((table: string) => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), single: vi.fn(), order: vi.fn(), insert: vi.fn(), update: vi.fn(), in: vi.fn(), delete: vi.fn() }
    query.select.mockReturnValue(query)
    query.eq.mockImplementation(() => {
      if (query.delete.mock.calls.length) deletes.push(table)
      return query
    })
    query.maybeSingle.mockResolvedValue({ data: null, error: null })
    query.single.mockImplementation(async () => ({ data: rows.get(table)?.[0], error: null }))
    query.order.mockImplementation(async () => ({ data: rows.get(table) ?? [], error: null }))
    query.insert.mockImplementation(async (value: Record<string, unknown> | Record<string, unknown>[]) => {
      if (table === 'remessa_operacional_chaves' && rejectKeys) return { error: { message: 'QA_CONSTRAINT_REJECTED' } }
      rows.set(table, Array.isArray(value) ? value : [value])
      return { error: null }
    })
    query.update.mockReturnValue(query)
    query.in.mockResolvedValue({ error: null })
    query.delete.mockReturnValue(query)
    return query
  })
})

it('persiste uma referencia completa por duplicata, sem ATIVOs duplicados com parcela NULL', async () => {
  const result = await gerarRemessaOperacional({ operacaoIds: ['operacao-cedente-a'], userId: 'gestor-qa' })
  expect(result.formato).toBe('VRS_CSV')
  expect(result.excelDisponivel).toBe(true)
  expect(rows.get('remessa_operacional_chaves')).toEqual([2, 3, 5].map(numero => ({
    remessa_operacional_arquivo_id: expect.any(String), operacao_id: 'operacao-cedente-a',
    nota_fiscal_id: '11111111-2222-3333-4444-555555555555', parcela_id: `parcela-${numero}-cedente-a`,
    chave_unica_ativo: `100/${numero}`, chave_unica_parcela: `100/${numero}-1`,
  })))
  const remessa = rows.get('remessas_operacionais')?.[0]
  expect(remessa?.idempotency_key).toBe(hashRemessa(stableStringify({ tipo: 'remessa_operacional', fundoId: 'fundo-1', integracaoVersaoId: 'config-v1', adapterKey: 'vortx_vrs', operacaoIds: ['operacao-cedente-a'], layout: VRS_LAYOUT_VERSION })))
  expect(mocks.upload).toHaveBeenCalledTimes(2)
  expect(mocks.upload.mock.calls[0][0]).toMatch(/12345678000195\.csv$/)
  expect(mocks.upload.mock.calls[1][0]).toMatch(/12345678000195\.xlsx$/)
  expect(mocks.upload.mock.calls.every(call => call[2].upsert === false)).toBe(true)
  expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ dados_depois: expect.objectContaining({
    layout: VRS_LAYOUT_VERSION, classificacoes_logisticas: [expect.objectContaining({ status: 'EM_TRANSITO', documento_id: 'qa-cte', versao_id: 'qa-cte-v1' })],
  }) }))
})

it('compensa somente os novos uploads e a nova remessa quando a persistencia das referencias falha', async () => {
  rejectKeys = true
  await expect(gerarRemessaOperacional({ operacaoIds: ['operacao-cedente-a'], userId: 'gestor-qa' })).rejects.toThrow('QA_CONSTRAINT_REJECTED')
  expect(deletes).toEqual(['remessas_operacionais'])
  const paths = mocks.upload.mock.calls.map(call => call[0])
  expect(mocks.remove).toHaveBeenCalledWith(paths)
  expect(paths).toHaveLength(2)
})

it('status indeterminado bloqueia antes de upload ou persistencia de remessa', async () => {
  lote.operacoes[0].notas[0].classificacaoLogistica = undefined
  await expect(gerarRemessaOperacional({ operacaoIds: ['operacao-cedente-a'], userId: 'gestor-qa' })).rejects.toThrow(/status logistico indeterminado/)
  expect(mocks.upload).not.toHaveBeenCalled()
  expect(rows.size).toBe(0)
})
