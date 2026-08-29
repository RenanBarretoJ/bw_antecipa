import { describe, expect, it } from 'vitest'
import { formatCnpj, shortName } from './utils'

describe('onboarding cedentes presentation helpers', () => {
  it('formats a valid CNPJ without changing its source value', () => {
    expect(formatCnpj('12345678000190')).toBe('12.345.678/0001-90')
  })

  it('keeps invalid CNPJ text available for diagnosis', () => {
    expect(formatCnpj('invalido')).toBe('invalido')
  })

  it('truncates only presentation text', () => {
    expect(shortName('Cedente com um nome muito extenso', 16)).toBe('Cedente com um ...')
  })
})
