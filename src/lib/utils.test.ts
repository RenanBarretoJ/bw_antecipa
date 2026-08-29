import { describe, expect, it } from 'vitest'
import { formatDateTimeSaoPaulo } from './utils'

describe('formatDateTimeSaoPaulo', () => {
  it('converte UTC 12:20:24Z para 09:20:24 em America/Sao_Paulo (exemplo do ticket)', () => {
    expect(formatDateTimeSaoPaulo('2026-08-26T12:20:24Z')).toBe('26/08/2026, 09:20:24')
  })

  it('lida com meia-noite UTC virando o dia anterior em Sao Paulo (-03:00)', () => {
    expect(formatDateTimeSaoPaulo('2026-08-26T02:00:00Z')).toBe('25/08/2026, 23:00:00')
  })

  it('retorna "-" para valor nulo/ausente', () => {
    expect(formatDateTimeSaoPaulo(null)).toBe('-')
    expect(formatDateTimeSaoPaulo(undefined)).toBe('-')
    expect(formatDateTimeSaoPaulo('')).toBe('-')
  })

  it('retorna "-" para data invalida em vez de "Invalid Date"', () => {
    expect(formatDateTimeSaoPaulo('nao-e-uma-data')).toBe('-')
  })

  it('produz o mesmo resultado para o mesmo instante independente de sufixo (Z vs +00:00)', () => {
    expect(formatDateTimeSaoPaulo('2026-08-26T12:20:24Z')).toBe(formatDateTimeSaoPaulo('2026-08-26T12:20:24+00:00'))
  })
})
