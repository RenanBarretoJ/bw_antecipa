import { describe, expect, it } from 'vitest'
import { dataCivilSaoPaulo, diaUtilAnterior } from './calendario'

describe('calendario civil canonico', () => {
  it('resolve a data civil em America/Sao_Paulo sem vazar a data UTC', () => {
    expect(dataCivilSaoPaulo(new Date('2026-09-15T02:30:00.000Z'))).toBe('2026-09-14')
    expect(dataCivilSaoPaulo(new Date('2026-09-15T03:30:00.000Z'))).toBe('2026-09-15')
  })

  it('resolve sempre o dia util ANBIMA estritamente anterior', () => {
    expect(diaUtilAnterior('2026-09-14')).toBe('2026-09-11')
    expect(diaUtilAnterior('2026-09-08')).toBe('2026-09-04')
  })
})
