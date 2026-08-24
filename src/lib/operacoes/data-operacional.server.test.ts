import { describe, expect, it } from 'vitest'
import { dataCivilIsoValida, obterDataCivilOperacional, resolverDataCivilOperacional } from './data-operacional.server'

describe('data civil operacional em America/Sao_Paulo', () => {
  const hoje = new Date('2026-08-24T15:00:00.000Z')

  it('usa hoje em Sao Paulo quando a query nao informa data', () => {
    expect(resolverDataCivilOperacional('', hoje)).toBe('2026-08-24')
    expect(resolverDataCivilOperacional(undefined, hoje)).toBe('2026-08-24')
  })

  it('preserva uma data explicita valida', () => {
    expect(resolverDataCivilOperacional('2026-08-27', hoje)).toBe('2026-08-27')
  })

  it('volta para hoje quando a query e invalida ou representa data inexistente', () => {
    expect(resolverDataCivilOperacional('27/08/2026', hoje)).toBe('2026-08-24')
    expect(resolverDataCivilOperacional('2026-02-30', hoje)).toBe('2026-08-24')
    expect(dataCivilIsoValida('2026-02-30')).toBe(false)
  })

  it('nao sofre off-by-one perto da meia-noite UTC', () => {
    expect(obterDataCivilOperacional(new Date('2026-08-24T01:30:00.000Z'))).toBe('2026-08-23')
    expect(obterDataCivilOperacional(new Date('2026-08-24T03:30:00.000Z'))).toBe('2026-08-24')
  })
})
