import { describe, expect, it } from 'vitest'
import { resolverExpectativasCicloFinanceiro } from './cron-contract'

describe('contrato do ciclo financeiro RLX', () => {
  it('resolve terca-feira como segunda e sexta anteriores', () => {
    expect(resolverExpectativasCicloFinanceiro('2026-09-15')).toMatchObject({
      ESTOQUE: '2026-09-14',
      CARTEIRA: '2026-09-11',
    })
  })

  it('resolve segunda-feira como sexta e quinta anteriores', () => {
    expect(resolverExpectativasCicloFinanceiro('2026-09-14')).toMatchObject({
      ESTOQUE: '2026-09-11',
      CARTEIRA: '2026-09-10',
    })
  })

  it('atravessa uma sexta-feira feriada a partir da segunda seguinte', () => {
    expect(resolverExpectativasCicloFinanceiro('2026-04-06')).toMatchObject({
      ESTOQUE: '2026-04-02',
      CARTEIRA: '2026-04-01',
    })
  })

  it('atravessa uma segunda-feira feriada a partir da terca seguinte', () => {
    expect(resolverExpectativasCicloFinanceiro('2026-09-08')).toMatchObject({
      ESTOQUE: '2026-09-04',
      CARTEIRA: '2026-09-03',
    })
  })

  it('preserva viradas de mes e de ano', () => {
    expect(resolverExpectativasCicloFinanceiro('2026-06-01')).toMatchObject({
      ESTOQUE: '2026-05-29',
      CARTEIRA: '2026-05-28',
    })
    expect(resolverExpectativasCicloFinanceiro('2026-01-05')).toMatchObject({
      ESTOQUE: '2026-01-02',
      CARTEIRA: '2025-12-31',
    })
  })

  it('resolve Estoque e movimentos em D-1 e Carteira em D-2 ANBIMA', () => {
    expect(resolverExpectativasCicloFinanceiro('2026-08-10')).toEqual({
      CARTEIRA: '2026-08-06',
      ESTOQUE: '2026-08-07',
      AQUISICOES: '2026-08-07',
      LIQUIDACOES: '2026-08-07',
    })
  })

  it('atravessa fim de semana e feriado sem inventar fallback de PL', () => {
    expect(resolverExpectativasCicloFinanceiro('2026-11-23')).toEqual({
      CARTEIRA: '2026-11-18',
      ESTOQUE: '2026-11-19',
      AQUISICOES: '2026-11-19',
      LIQUIDACOES: '2026-11-19',
    })
  })
})
