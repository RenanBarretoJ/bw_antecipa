import { describe, expect, it } from 'vitest'
import {
  calcularAntecipacaoEmLote,
  calcularValorPresenteNota,
  contarDiasTrinta360,
  contarDiasUteisAnbima,
  ehDiaUtilAnbima,
  METODOS_CALCULO_LABELS,
  resolverMetodoCalculo,
} from './calculo'

describe('dominio financeiro da operacao', () => {
  it('apresenta a base 360 sem o termo mes financeiro', () => {
    expect(METODOS_CALCULO_LABELS.TRINTA_360).toBe('360 - Dias corridos')
  })

  it('preserva explicitamente o fallback legado', () => {
    expect(resolverMetodoCalculo(null)).toBe('LEGADO_MENSAL_DIAS_REAIS_30')
    const memoria = calcularValorPresenteNota({ notaFiscalId: 'nf', valorNominal: 1000, taxaMensal: 2, dataBase: '2026-07-01', vencimento: '2026-07-31' })
    expect(memoria.dias).toBe(30)
    expect(memoria.expoente).toBe(1)
    expect(memoria.valorPresente).toBe(980.39)
  })

  it.each([
    ['2026-07-01', '2026-07-02', 1],
    ['2026-01-31', '2026-03-03', 31],
    ['2026-02-01', '2026-03-01', 28],
    ['2024-02-01', '2024-03-01', 29],
  ])('mantem dias civis reais no legado entre %s e %s', (dataBase, vencimento, dias) => {
    const memoria = calcularValorPresenteNota({
      notaFiscalId: 'legado',
      valorNominal: 1000,
      taxaMensal: 2,
      dataBase,
      vencimento,
      metodo: 'LEGADO_MENSAL_DIAS_REAIS_30',
    })
    expect(memoria.dias).toBe(dias)
    expect(memoria.expoente).toBeCloseTo(dias / 30, 12)
  })

  it('conta 252 excluindo inicio, incluindo fim e usando ANBIMA', () => {
    expect(contarDiasUteisAnbima('2026-08-07', '2026-08-10')).toBe(1)
    expect(contarDiasUteisAnbima('2026-09-04', '2026-09-08')).toBe(1)
    expect(ehDiaUtilAnbima('2026-11-20')).toBe(false)
    const sabado = calcularValorPresenteNota({ notaFiscalId: 'nf', valorNominal: 1000, taxaMensal: 2, dataBase: '2026-08-07', vencimento: '2026-08-08', metodo: 'DIAS_UTEIS_252' })
    expect(sabado.vencimentoConsideradoCalculo).toBe('2026-08-10')
    expect(sabado.diasUteis).toBe(1)
  })

  it('cobre domingo, feriado consecutivo e virada de ano no calendario ANBIMA', () => {
    const domingo = calcularValorPresenteNota({ notaFiscalId: 'domingo', valorNominal: 1000, taxaMensal: 2, dataBase: '2026-08-07', vencimento: '2026-08-09', metodo: 'DIAS_UTEIS_252' })
    expect(domingo.vencimentoConsideradoCalculo).toBe('2026-08-10')
    expect(domingo.dias).toBe(1)
    expect(contarDiasUteisAnbima('2026-12-31', '2027-01-04')).toBe(1)
    expect(contarDiasUteisAnbima('2026-04-02', '2026-04-06')).toBe(1)
  })

  it('aplica a convencao deterministica 30/360', () => {
    expect(contarDiasTrinta360('2026-01-15', '2026-02-15')).toBe(30)
    expect(contarDiasTrinta360('2026-01-31', '2026-02-28')).toBe(28)
    expect(contarDiasTrinta360('2024-02-29', '2024-03-31')).toBe(31)
    expect(contarDiasTrinta360('2026-12-31', '2027-01-31')).toBe(30)
    expect(contarDiasTrinta360('2026-01-30', '2026-01-31')).toBe(0)
    expect(contarDiasTrinta360('2026-02-28', '2026-03-31')).toBe(32)
    expect(contarDiasTrinta360('2026-03-30', '2026-03-31')).toBe(0)
    expect(contarDiasTrinta360('2026-03-29', '2026-03-30')).toBe(1)
  })

  it('aplica um mes financeiro completo e inclui intervalo de um dia em 30/360', () => {
    const mes = calcularValorPresenteNota({ notaFiscalId: 'mes', valorNominal: 1000, taxaMensal: 2, dataBase: '2026-01-15', vencimento: '2026-02-15', metodo: 'TRINTA_360' })
    const dia = calcularValorPresenteNota({ notaFiscalId: 'dia', valorNominal: 1000, taxaMensal: 2, dataBase: '2026-03-29', vencimento: '2026-03-30', metodo: 'TRINTA_360' })
    expect(mes.diasFinanceiros).toBe(30)
    expect(mes.expoente).toBe(1)
    expect(dia.diasFinanceiros).toBe(1)
    expect(dia.expoente).toBeCloseTo(1 / 30, 12)
  })

  it('usa ACT/365 fixo mesmo atravessando 29 de fevereiro', () => {
    const memoria = calcularValorPresenteNota({ notaFiscalId: 'nf', valorNominal: 1000, taxaMensal: 1, dataBase: '2024-02-28', vencimento: '2024-03-01', metodo: 'DIAS_CORRIDOS_365' })
    expect(memoria.dias).toBe(2)
    expect(memoria.base).toBe(365)
    expect(memoria.expoente).toBeCloseTo(24 / 365, 10)
    const ano = calcularValorPresenteNota({ notaFiscalId: 'ano', valorNominal: 1000, taxaMensal: 1, dataBase: '2023-03-01', vencimento: '2024-03-01', metodo: 'DIAS_CORRIDOS_365' })
    expect(ano.dias).toBe(366)
    expect(ano.expoente).toBeCloseTo(12 * 366 / 365, 10)
  })

  it.each([
    ['2026-08-05', '2026-08-06', 1],
    ['2026-08-05', '2026-09-04', 30],
    ['2025-08-05', '2026-08-05', 365],
  ])('usa dias corridos e base 365 entre %s e %s', (dataBase, vencimento, dias) => {
    const memoria = calcularValorPresenteNota({ notaFiscalId: 'act365', valorNominal: 1000, taxaMensal: 1, dataBase, vencimento, metodo: 'DIAS_CORRIDOS_365' })
    expect(memoria.dias).toBe(dias)
    expect(memoria.base).toBe(365)
    expect(memoria.expoente).toBeCloseTo(12 * dias / 365, 12)
  })

  it('distingue taxa zero configurada de taxa ausente e soma por NF arredondada', () => {
    const semTaxa = calcularAntecipacaoEmLote({ notas: [{ id: 'a', valorBruto: 1000, vencimento: '2026-08-10' }], taxas: [], dataBase: '2026-08-05', metodo: 'DIAS_CORRIDOS_365' })
    expect(semTaxa.taxaConfigurada).toBe(false)
    expect(semTaxa.valorLiquidoTotal).toBeNull()
    const zero = calcularAntecipacaoEmLote({ notas: [{ id: 'a', valorBruto: 1000, vencimento: '2026-08-10' }], taxaMensal: 0, dataBase: '2026-08-05', metodo: 'DIAS_CORRIDOS_365' })
    expect(zero.taxaConfigurada).toBe(true)
    expect(zero.valorLiquidoTotal).toBe(1000)
  })

  it('rejeita NF vencida e permite vencimento na data-base com prazo zero', () => {
    expect(() => calcularValorPresenteNota({ notaFiscalId: 'nf', valorNominal: 1000, taxaMensal: 1, dataBase: '2026-08-05', vencimento: '2026-08-04', metodo: 'DIAS_CORRIDOS_365' })).toThrow('A NF esta vencida')
    expect(calcularValorPresenteNota({ notaFiscalId: 'nf', valorNominal: 1000, taxaMensal: 1, dataBase: '2026-08-05', vencimento: '2026-08-05', metodo: 'DIAS_CORRIDOS_365' }).dias).toBe(0)
  })

  it('nao converte metodo desconhecido em legado silenciosamente', () => {
    expect(() => resolverMetodoCalculo('METODO_INEXISTENTE')).toThrow('Metodo de calculo financeiro invalido')
  })

  it('mantem uma unica taxa para NFs com prazos diferentes', () => {
    const resultado = calcularAntecipacaoEmLote({
      dataBase: '2026-07-01',
      metodo: 'DIAS_CORRIDOS_365',
      taxas: [{ prazo_min: 0, prazo_max: 60, taxa_percentual: 3 }],
      notas: [
        { id: 'a', valorBruto: 1000, vencimento: '2026-07-31' },
        { id: 'b', valorBruto: 2000, vencimento: '2026-08-30' },
      ],
    })
    expect(resultado.notas.every((item) => item.taxaMensal === 3)).toBe(true)
    expect(resultado.taxaMedia).toBe(3)
    expect(resultado.valorLiquidoTotal).toBe(
      resultado.notas.reduce((sum, item) => sum + (item.valorPresente || 0), 0),
    )
  })

  it('seleciona a faixa pela maior exposicao temporal da operacao', () => {
    const resultado = calcularAntecipacaoEmLote({
      dataBase: '2026-08-05',
      metodo: 'DIAS_CORRIDOS_365',
      taxas: [
        { prazo_min: 0, prazo_max: 30, taxa_percentual: 1 },
        { prazo_min: 31, prazo_max: 90, taxa_percentual: 2 },
      ],
      notas: [
        { id: 'curta', valorBruto: 1000, vencimento: '2026-08-15' },
        { id: 'longa', valorBruto: 1000, vencimento: '2026-10-04' },
      ],
    })
    expect(resultado.taxaMensal).toBe(2)
    expect(resultado.notas.map((item) => item.taxaMensal)).toEqual([2, 2])
  })

  it('arredonda cada NF antes da soma com ROUND_HALF_UP', () => {
    const resultado = calcularAntecipacaoEmLote({
      dataBase: '2026-08-05',
      metodo: 'LEGADO_MENSAL_DIAS_REAIS_30',
      taxaMensal: 1.37,
      notas: [
        { id: 'a', valorBruto: 100.01, vencimento: '2026-09-04' },
        { id: 'b', valorBruto: 100.02, vencimento: '2026-09-04' },
      ],
    })
    const somaEmCentavos = resultado.notas.reduce(
      (total, item) => total + Math.round((item.valorPresente || 0) * 100),
      0,
    )
    expect(resultado.valorLiquidoTotal).toBe(somaEmCentavos / 100)
    expect(resultado.notas.every((item) => item.arredondamento === 'ROUND_HALF_UP_2_CASAS')).toBe(true)
  })
})
