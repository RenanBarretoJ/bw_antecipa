import { describe, expect, it } from 'vitest'
import { calcularAgregadosPosicao, calcularExposicao, classificarOverlayCandidate, classificarPercentualExposicao } from './calculo'

describe('P2.5 exposure Decimal domain', () => {
  it.each([
    ['25', 'ABAIXO_LIMITE'], ['37', 'ABAIXO_LIMITE'], ['39.8', 'ABAIXO_LIMITE'],
    ['40', 'NO_LIMITE'], ['42', 'ACIMA_LIMITE'], ['39.999999999', 'ABAIXO_LIMITE'],
    ['40.000000000', 'NO_LIMITE'], ['40.000000001', 'ACIMA_LIMITE'],
  ])('classifies %s exactly', (value, expected) => expect(classificarPercentualExposicao(value, '40')).toBe(expected))

  it('keeps delivered, indeterminate, unmatched and absent values outside the numerator', () => {
    expect(calcularAgregadosPosicao([
      { statusVinculo: 'MATCHED_FINANCEIRO_NF', statusLogistico: 'EM_TRANSITO', valorAquisicao: '10.25' },
      { statusVinculo: 'MATCHED_FINANCEIRO_NF', statusLogistico: 'ENTREGUE', valorAquisicao: '20' },
      { statusVinculo: 'MATCHED_FINANCEIRO_NF', statusLogistico: 'INDETERMINADA', valorAquisicao: null },
      { statusVinculo: 'SEM_MATCH_FINANCEIRO_NF', statusLogistico: null, valorAquisicao: '30' },
    ])).toEqual(expect.objectContaining({ valorEmTransito: '10.2500', valorEntregue: '20.0000', valorSemMatch: '30.0000', valorAusente: 1 }))
  })

  it('does not double count incorporated or prior-day operations', () => {
    const common = { operacaoId: 'op', notaFiscalId: 'nf', valorAquisicao: '100', statusLogistico: 'EM_TRANSITO' as const, dataOperacional: '2026-08-10' }
    const included = classificarOverlayCandidate({ ...common, jaIncorporadoEstoque: false, operacaoEconomicaEm: '2026-08-10T10:00:00Z' })
    const incorporated = classificarOverlayCandidate({ ...common, jaIncorporadoEstoque: true, operacaoEconomicaEm: '2026-08-10T10:00:00Z' })
    const old = classificarOverlayCandidate({ ...common, jaIncorporadoEstoque: false, operacaoEconomicaEm: '2026-08-09T10:00:00Z' })
    expect(calcularExposicao({ posicaoEmTransito: '100', overlay: [included, incorporated, old], patrimonioLiquido: '1000', limite: '40' }))
      .toEqual(expect.objectContaining({ exposicaoEmTransitoTotal: '200.0000', percentualExposicao: '20.000000000000', operacoesJaIncorporadasValor: '100.0000', operacoesNaoIncorporadasValor: '100.0000' }))
  })

  it('rejects zero and negative PL', () => {
    expect(() => calcularExposicao({ posicaoEmTransito: '1', overlay: [], patrimonioLiquido: '0', limite: '40' })).toThrow('PL_D2_INVALIDO')
    expect(() => calcularExposicao({ posicaoEmTransito: '1', overlay: [], patrimonioLiquido: '-1', limite: '40' })).toThrow('PL_D2_INVALIDO')
  })
})
