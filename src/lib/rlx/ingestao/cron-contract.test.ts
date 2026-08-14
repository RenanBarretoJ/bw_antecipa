import { describe, expect, it } from 'vitest'
import { resolverExpectativasCicloRlx } from './cron-contract'

describe('contrato do ciclo financeiro RLX', () => {
  it('resolve Estoque e movimentos em D-1 e Carteira em D-2 ANBIMA', () => {
    expect(resolverExpectativasCicloRlx('2026-08-10')).toEqual({
      CARTEIRA: '2026-08-06',
      ESTOQUE: '2026-08-07',
      AQUISICOES: '2026-08-07',
      LIQUIDACOES: '2026-08-07',
    })
  })

  it('atravessa fim de semana e feriado sem inventar fallback de PL', () => {
    expect(resolverExpectativasCicloRlx('2026-11-23')).toEqual({
      CARTEIRA: '2026-11-18',
      ESTOQUE: '2026-11-19',
      AQUISICOES: '2026-11-19',
      LIQUIDACOES: '2026-11-19',
    })
  })
})
