import { describe, expect, it } from 'vitest'
import { calcularAntecipacaoEmLote } from './calculo'

describe('calculo financeiro da operacao', () => {
  it('calcula valores e medias ponderadas sem depender da UI', () => {
    const resultado = calcularAntecipacaoEmLote({
      agoraMs: new Date('2026-07-01T12:00:00').getTime(),
      taxas: [
        { prazo_min: 1, prazo_max: 30, taxa_percentual: 2 },
        { prazo_min: 31, prazo_max: 60, taxa_percentual: 3 },
      ],
      notas: [
        { id: 'a', valorBruto: 1000, vencimento: '2026-07-31' },
        { id: 'b', valorBruto: 2000, vencimento: '2026-08-30' },
      ],
    })
    expect(resultado.valorBrutoTotal).toBe(3000)
    expect(resultado.valorLiquidoTotal).toBeLessThan(3000)
    expect(resultado.taxaMedia).toBeCloseTo(8 / 3, 5)
    expect(resultado.prazoMedio).toBe(50)
  })
})
