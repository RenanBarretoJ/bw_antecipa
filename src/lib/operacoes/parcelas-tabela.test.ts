import { describe, expect, it } from 'vitest'
import { construirLinhasParcelasOperacao, selecionarLinhasParcelas, totaisLinhasParcelas } from './parcelas-tabela'
import type { BaseAntecipacaoSnapshot } from './base-antecipacao'

const nf = { id: 'nf-1', numero_nf: '120', razao_social_destinatario: 'Sacado teste', cnpj_destinatario: '', valor_bruto: 1000, valor_liquido: 800, valor_antecipado: 750, data_vencimento: '2026-11-30', status: 'aceita' }
const parcelas = [
  { parcelaId: 'p2', numeroParcela: 2, dataVencimento: '2026-12-30', valorNominal: 400, diasAplicados: 60, valorPresente: 380, desconto: 20 },
  { parcelaId: 'p3', numeroParcela: 3, dataVencimento: '2027-01-30', valorNominal: 200, diasAplicados: null, valorPresente: null, desconto: null },
]
const entrada = { notas: [nf], parcelasPorNf: new Map([['nf-1', parcelas]]), totalParcelasPorNf: new Map([['nf-1', 3]]), snapshot: null, memoriasLegadas: [], historico: true }

describe('tabela de parcelas da operação', () => {
  it('exibe somente parcelas cedidas, repetindo identidade e bruto integral sem dividir o antecipado da NF', () => {
    const rows = construirLinhasParcelasOperacao(entrada)
    expect(rows.map(r => r.numeroParcela)).toEqual([2, 3])
    expect(rows.map(r => r.brutoFiscal)).toEqual([1000, 1000])
    expect(rows.map(r => r.baseCedida)).toEqual([400, 200])
    expect(rows.map(r => r.antecipado)).toEqual([380, null])
    expect(rows.map(r => r.vencimento)).toEqual(['2026-12-30', '2027-01-30'])
    expect(totaisLinhasParcelas(rows)).toEqual({ notas: 1, brutoFiscal: 1000, baseCedida: 600, antecipado: null })
  })
  it('não converte NF parcelada sem vínculo de parcela em cessão integral', () => {
    expect(construirLinhasParcelasOperacao({ ...entrada, parcelasPorNf: new Map() })).toEqual([])
  })
  it('preserva zero informado e ausência do valor, somando por centavos', () => {
    const rows = construirLinhasParcelasOperacao({ ...entrada, parcelasPorNf: new Map([['nf-1', parcelas.map(p => ({ ...p, valorPresente: 0 }))]]) })
    expect(totaisLinhasParcelas(rows).antecipado).toBe(0)
    expect(rows.every(r => r.antecipado === 0)).toBe(true)
  })
  it('não usa o valor líquido fiscal como antecipado da parcela nem como prévia de aprovação', () => {
    const rows = construirLinhasParcelasOperacao({ ...entrada, parcelasPorNf: new Map(), totalParcelasPorNf: new Map(), historico: false })
    expect(rows[0].antecipado).toBeNull()
    expect(rows[0].numeroParcela).toBeNull()
  })
  it('mantém a base líquida congelada na nota legada', () => {
    const snapshot = { itens: [{ nota_fiscal_id: nf.id, parcela_id: null, valor_base: 800 }] } as BaseAntecipacaoSnapshot
    const rows = construirLinhasParcelasOperacao({ ...entrada, parcelasPorNf: new Map(), totalParcelasPorNf: new Map(), snapshot })
    expect(rows[0]).toMatchObject({ brutoFiscal: 1000, baseCedida: 800, antecipado: 750 })
  })
  it('rejeita snapshot incompleto em vez de ocultar divergência financeira', () => {
    expect(() => construirLinhasParcelasOperacao({ ...entrada, snapshot: { itens: [] } as unknown as BaseAntecipacaoSnapshot })).toThrow('base de antecipação congelada')
  })
  it('filtra por NF sem perder suas parcelas e ordena pelo vencimento de cada uma', () => {
    const rows = construirLinhasParcelasOperacao(entrada)
    expect(selecionarLinhasParcelas(rows, '120', 'todas', 'vencimento', true).map(r => r.numeroParcela)).toEqual([2, 3])
    expect(selecionarLinhasParcelas(rows, 'inexistente', 'todas', 'numero', true)).toEqual([])
    expect(rows.map(r => r.numeroParcela)).toEqual([2, 3])
  })
  it('aceite dispensado nunca produz pendência; contestação continua pesquisável', () => {
    const rows = construirLinhasParcelasOperacao(entrada).map(r => ({ ...r, statusNf: 'em_antecipacao' }))
    expect(selecionarLinhasParcelas(rows, '', 'pendentes', 'numero', false)).toEqual([])
    expect(selecionarLinhasParcelas(rows, '', 'pendentes', 'numero', true)).toHaveLength(2)
    expect(selecionarLinhasParcelas(rows.map(r => ({ ...r, statusNf: 'contestada' })), '', 'contestadas', 'numero', false)).toHaveLength(2)
  })
})
