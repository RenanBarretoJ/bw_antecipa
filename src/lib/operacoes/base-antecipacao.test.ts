import { describe, expect, it } from 'vitest'
import { resolverBaseAntecipacao, valorBaseSnapshot, type BaseAntecipacaoSnapshot } from './base-antecipacao'
import { calcularAntecipacaoEmLote } from './calculo'

const nota = { valorBruto: 100000, valorLiquido: 90000, origemLiquido: 'DOCUMENTO_EXPLICITO', possuiParcelas: false }

describe('GUIBOR A5 - seleção fiscal sem fórmula financeira paralela', () => {
  it('BRUTO preserva o nominal inclusive para notas legadas e parceladas', () => {
    expect(resolverBaseAntecipacao('BRUTO', nota)).toEqual({ elegivel: true, base: 'BRUTO', valorBase: 100000 })
    expect(resolverBaseAntecipacao('BRUTO', { ...nota, valorLiquido: null, origemLiquido: null, possuiParcelas: true }).elegivel).toBe(true)
  })
  it.each([[100000, 90000], [39521.98, 37229.70], [112710.81, 105779.10]])('LIQUIDO %s/%s usa somente líquido explícito', (valorBruto, valorLiquido) => {
    expect(resolverBaseAntecipacao('LIQUIDO', { ...nota, valorBruto, valorLiquido })).toEqual({ elegivel: true, base: 'LIQUIDO', valorBase: valorLiquido })
  })
  it.each(['LEGACY_BRUTO', 'NAO_INFORMADO', null, '', 'manual'])('nega origem %s mesmo com líquido numérico', (origemLiquido) => {
    expect(resolverBaseAntecipacao('LIQUIDO', { ...nota, origemLiquido }).elegivel).toBe(false)
  })
  it.each([null, 0, -1, NaN, Infinity, 100001])('nega líquido %s sem fallback', (valorLiquido) => {
    expect(resolverBaseAntecipacao('LIQUIDO', { ...nota, valorLiquido }).elegivel).toBe(false)
  })
  it('nega LIQUIDO com parcelas, mesmo com provenance explícita', () => {
    expect(resolverBaseAntecipacao('LIQUIDO', { ...nota, possuiParcelas: true })).toMatchObject({ elegivel: false, motivo: expect.stringContaining('parceladas') })
  })
  it('múltiplas NFs alimentam a mesma engine P17 nos fluxos direto e proposto', () => {
    const notas = [50000, 30000].map((valorLiquido, i) => {
      const base = resolverBaseAntecipacao('LIQUIDO', { ...nota, valorLiquido })
      if (!base.elegivel) throw new Error(base.motivo)
      return { id: String(i), valorBruto: base.valorBase, vencimento: '2026-11-09' }
    })
    const input = { notas, dataBase: '2026-09-29', metodo: 'TRINTA_360' }
    const proposta = calcularAntecipacaoEmLote({ ...input, taxaMensal: 3.99 })
    const direta = calcularAntecipacaoEmLote({ ...input, taxas: [{ prazo_min: 0, prazo_max: 180, taxa_percentual: 3.99 }] })
    expect(proposta).toEqual(direta)
    expect(proposta.valorBrutoTotal).toBe(80000)
    expect(proposta.prazoMedio).toBe(41)
  })
  it('snapshot não consulta cadastro vivo e snapshot incompleto falha fechado', () => {
    const snapshot: BaseAntecipacaoSnapshot = {
      schema: 'bw-antecipa.base-antecipacao.v1', base: 'LIQUIDO', cedente_id: 'c', fundo_id: 'f', cedente_fundo_id: 'cf',
      politica_operacional_versao_id: 'v', capturado_em: '2026-09-29T12:00:00Z', notas: [],
      itens: [{ nota_fiscal_id: 'n', parcela_id: null, valor_base: 90000, vencimento: '2026-11-09' }],
    }
    expect(valorBaseSnapshot(snapshot, 'n', 100000)).toBe(90000)
    expect(() => valorBaseSnapshot(snapshot, 'outra', 100000)).toThrow(/congelada/)
    expect(valorBaseSnapshot(null, 'n', 100000)).toBe(100000)
  })
})
