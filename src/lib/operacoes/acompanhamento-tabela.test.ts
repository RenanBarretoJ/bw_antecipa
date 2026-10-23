import { describe, expect, it } from 'vitest'
import type { OperacaoCedenteDetalhe } from './cedente-detalhe'
import type { BaseAntecipacaoSnapshot } from './base-antecipacao'
import { construirLinhasAcompanhamento, paginarAcompanhamento } from './acompanhamento-tabela'
import { totaisLinhasParcelas } from './parcelas-tabela'

const nf: OperacaoCedenteDetalhe['notasFiscais'][number] = {
  id: 'nf-1', numero: '13197', sacado: 'Sacado QA', cnpjSacado: '98200010000175',
  valorBruto: 6000, valorBrutoFiscal: 10000, valorAntecipado: null, vencimento: '2026-12-01',
  status: 'em_antecipacao', statusLabel: 'Em antecipação', href: '/consultor/notas-fiscais/nf-1?cedente=cedente-1',
  totalParcelas: 3,
  parcelasCedidas: [
    { parcelaId: 'p-1', numero: 1, vencimentoOriginal: '2026-11-01', valorNominal: 2500, prazoDias: null, valorAntecipado: null, desconto: null, statusFinanceiro: null },
    { parcelaId: 'p-3', numero: 3, vencimentoOriginal: '2026-12-01', valorNominal: 3500, prazoDias: null, valorAntecipado: null, desconto: null, statusFinanceiro: null },
  ],
}

const linhas = () => construirLinhasAcompanhamento({ notasFiscais: [nf] })

describe('tabela de acompanhamento sem alterar a tabela do Gestor', () => {
  it('exibe somente parcelas cedidas e preserva bruto fiscal integral e valores não aprovados', () => {
    const resultado = linhas()
    expect(resultado.map(linha => linha.numeroParcela)).toEqual([1, 3])
    expect(resultado.map(linha => linha.baseCedida)).toEqual([2500, 3500])
    expect(resultado.every(linha => linha.brutoFiscal === 10000 && linha.antecipado === null)).toBe(true)
    expect(resultado[0]).toMatchObject({ parcelasCedidasNaNf: 2, totalParcelasNaNf: 3, prazoDias: null, desconto: null })
    expect(totaisLinhasParcelas(resultado)).toEqual({ notas: 1, brutoFiscal: 10000, baseCedida: 6000, antecipado: null })
  })

  it('preserva link do portal e não transforma status de NF em aceite do sacado', () => {
    expect(linhas()[0]).toMatchObject({ href: nf.href, statusNf: nf.status, statusLabel: 'Em antecipação' })
    expect(construirLinhasAcompanhamento({ notasFiscais: [{ ...nf, href: '/cedente/notas-fiscais/nf-1' }] })[0].href).toBe('/cedente/notas-fiscais/nf-1')
  })

  it('preserva memória aprovada e valores zero válidos', () => {
    const resultado = construirLinhasAcompanhamento({ notasFiscais: [{ ...nf, parcelasCedidas: nf.parcelasCedidas.map(parcela => ({ ...parcela, valorAntecipado: parcela.valorNominal, desconto: 0, prazoDias: 0, statusFinanceiro: 'Cronograma aprovado' })) }] })
    expect(resultado[0]).toMatchObject({ antecipado: 2500, desconto: 0, prazoDias: 0, statusFinanceiro: 'Cronograma aprovado' })
    expect(totaisLinhasParcelas(resultado).antecipado).toBe(6000)
  })

  it('não substitui ausência de parcelas cedidas pelo valor inteiro de uma NF parcelada', () => {
    expect(construirLinhasAcompanhamento({ notasFiscais: [{ ...nf, parcelasCedidas: [] }] })).toEqual([])
  })

  it('mantém uma linha para NF legada não parcelada', () => {
    const resultado = construirLinhasAcompanhamento({ notasFiscais: [{ ...nf, totalParcelas: 0, parcelasCedidas: [], valorAntecipado: 9300 }] })
    expect(resultado).toHaveLength(1)
    expect(resultado[0]).toMatchObject({ parcelaId: null, numeroParcela: null, baseCedida: 10000, antecipado: 9300, brutoFiscal: 10000 })
  })

  it('usa somente a base congelada quando existe snapshot', () => {
    const snapshot: BaseAntecipacaoSnapshot = {
      schema: 'bw-antecipa.base-antecipacao.v1', base: 'BRUTO', cedente_id: 'c', fundo_id: 'f', cedente_fundo_id: 'cf', politica_operacional_versao_id: 'v', capturado_em: '2026-10-23', notas: [],
      itens: [{ nota_fiscal_id: 'nf-1', parcela_id: 'p-1', valor_base: 2400, vencimento: '2026-11-01' }, { nota_fiscal_id: 'nf-1', parcela_id: 'p-3', valor_base: 3400, vencimento: '2026-12-01' }],
    }
    expect(totaisLinhasParcelas(construirLinhasAcompanhamento({ notasFiscais: [nf], baseAntecipacaoSnapshot: snapshot })).baseCedida).toBe(5800)
    expect(() => construirLinhasAcompanhamento({ notasFiscais: [nf], baseAntecipacaoSnapshot: { ...snapshot, itens: [] } })).toThrow('congelada')
  })

  it('busca, filtra e ordena sem alterar a entrada', () => {
    const entrada = [...linhas(), ...construirLinhasAcompanhamento({ notasFiscais: [{ ...nf, id: 'nf-2', numero: '2', status: 'contestada', statusLabel: 'Contestada', sacado: 'Outro QA', parcelasCedidas: [], totalParcelas: 0 }] })]
    const antes = JSON.stringify(entrada)
    expect(paginarAcompanhamento({ linhas: entrada, busca: 'OUTRO', status: 'contestada' }).itens.map(linha => linha.numeroNf)).toEqual(['2'])
    expect(paginarAcompanhamento({ linhas: entrada, busca: '98200010000175' }).filtradas).toHaveLength(3)
    expect(paginarAcompanhamento({ linhas: entrada, ordem: 'numero' }).itens[0].numeroNf).toBe('2')
    expect(JSON.stringify(entrada)).toBe(antes)
  })

  it('pagina sem perder os totais de todas as páginas ou criar página inexistente', () => {
    const entrada = Array.from({ length: 53 }, (_, index) => ({ ...linhas()[0], id: `p-${index}`, numeroParcela: index + 1 }))
    const resultado = paginarAcompanhamento({ linhas: entrada, pagina: 3 })
    expect(resultado.itens).toHaveLength(3)
    expect(resultado.filtradas).toHaveLength(53)
    expect(resultado.paginas).toBe(3)
    expect(paginarAcompanhamento({ linhas: entrada, pagina: 999 }).atual).toBe(3)
    expect(paginarAcompanhamento({ linhas: entrada, pagina: -4, tamanho: 0 }).atual).toBe(1)
    expect(paginarAcompanhamento({ linhas: [], pagina: 9 })).toMatchObject({ atual: 1, paginas: 1, itens: [] })
  })

  it('não soma antecipado parcialmente preenchido como total conhecido', () => {
    expect(totaisLinhasParcelas([{ ...linhas()[0], antecipado: 2000 }, linhas()[1]]).antecipado).toBeNull()
  })
})
