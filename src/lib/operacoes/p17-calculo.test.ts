import { describe, expect, it } from 'vitest'
import { calcularAntecipacaoEmLote, calcularValorPresenteNota, criarConfiguracaoCalculoSnapshot } from './calculo'

const caso = { notaFiscalId: '1756', valorNominal: 122386.47, taxaMensal: 3.99, dataBase: '2026-09-29', vencimento: '2026-11-09', metodo: 'TRINTA_360' }

describe('P17 - 360 dias corridos, taxa mensal', () => {
  it('reproduz o incidente e recupera a taxa implicita com tolerancia de centavos', () => {
    const m = calcularValorPresenteNota(caso)
    expect(m).toMatchObject({ dias: 41, diasCorridosReais: 41, diasFinanceiros: null, base: 360, versaoMotor: 2, valorPresente: 116014.32, desconto: 6372.15 })
    expect(m.expoente).toBeCloseTo(41 / 30, 12)
    const taxaImplicita = (Math.pow(m.valorNominal / m.valorPresente!, 30 / m.dias) - 1) * 100
    expect(Math.abs(taxaImplicita - 3.99)).toBeLessThan(0.00001)
    expect(m.valorPresente).not.toBe(116165.72)
  })

  it.each([
    ['2026-09-29', '2026-11-09', 41],
    ['2026-09-30', '2026-10-30', 30],
    ['2026-01-31', '2026-02-28', 28],
    ['2026-02-28', '2026-03-31', 31],
    ['2024-02-29', '2024-03-31', 31],
    ['2024-02-28', '2024-03-01', 2],
    ['2026-12-31', '2027-01-01', 1],
    ['2026-09-29', '2026-09-29', 0],
    ['2026-01-30', '2026-01-31', 1],
  ])('%s ate %s aplica %i dias civis', (dataBase, vencimento, dias) => {
    const m = calcularValorPresenteNota({ ...caso, dataBase, vencimento })
    expect(m.dias).toBe(dias)
    expect(m.diasCorridosReais).toBe(dias)
    expect(m.expoente).toBeCloseTo(dias / 30, 12)
  })

  it('falha fechado para data invalida, timestamp e NF vencida', () => {
    for (const vencimento of ['2026-09-28', '2026-02-30', '2026-11-09T00:00:00-03:00']) {
      expect(() => calcularValorPresenteNota({ ...caso, vencimento })).toThrow()
    }
  })

  it('nao muda datas civis conforme timezone do processo, inclusive horario de verao', () => {
    const anterior = process.env.TZ
    try {
      for (const timezone of ['UTC', 'America/Sao_Paulo', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
        process.env.TZ = timezone
        expect(calcularValorPresenteNota(caso).valorPresente).toBe(116014.32)
        expect(calcularValorPresenteNota({ ...caso, dataBase: '2018-11-03', vencimento: '2018-11-05' }).dias).toBe(2)
      }
    } finally {
      if (anterior === undefined) delete process.env.TZ
      else process.env.TZ = anterior
    }
  })

  it('taxa mantida e alterada usam o mesmo prazo no motor dos tres portais', () => {
    const input = { dataBase: caso.dataBase, metodo: caso.metodo, notas: [{ id: caso.notaFiscalId, valorBruto: caso.valorNominal, vencimento: caso.vencimento }] }
    const proposta = calcularAntecipacaoEmLote({ ...input, taxaMensal: 3.99 })
    const direta = calcularAntecipacaoEmLote({ ...input, taxas: [{ prazo_min: 0, prazo_max: 180, taxa_percentual: 3.99 }] })
    expect(proposta).toEqual(direta)
    expect(proposta.prazoMedio).toBe(41)
    expect(proposta.valorLiquidoTotal).toBe(116014.32)
    const alterada = calcularAntecipacaoEmLote({ ...input, taxaMensal: 2.35 })
    expect(alterada.prazoMedio).toBe(41)
    expect(alterada.valorLiquidoTotal).toBeGreaterThan(proposta.valorLiquidoTotal!)
  })

  it('snapshot novo identifica a semantica e outros metodos mantem versao 1', () => {
    expect(criarConfiguracaoCalculoSnapshot('TRINTA_360')).toMatchObject({ base: 360, divisor_mensal: 30, unidade_contagem: 'dias_corridos', convencao: 'DIAS_REAIS_DIV_30', versao_motor: 2 })
    for (const metodo of ['DIAS_UTEIS_252', 'DIAS_CORRIDOS_365', 'LEGADO_MENSAL_DIAS_REAIS_30']) {
      expect(criarConfiguracaoCalculoSnapshot(metodo).versao_motor).toBe(1)
    }
  })
})
