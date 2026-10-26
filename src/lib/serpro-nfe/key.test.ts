import { describe, expect, it } from 'vitest'
import { calcularDvChaveNfe, identidadeDaChaveNfe, validarChaveNfe55 } from './key'

function key(base: string) {
  const dv = calcularDvChaveNfe(base)
  if (dv === null) throw new Error('invalid fixture')
  return `${base}${dv}`
}

describe('chave principal da NF-e modelo 55', () => {
  const base = '3526101422486400010055002000002190112345678'
  const valid = key(base)

  it('valida DV, modelo e extrai a identidade fiscal', () => {
    expect(valid).toHaveLength(44)
    expect(validarChaveNfe55(valid)).toBe(true)
    expect(identidadeDaChaveNfe(valid)).toEqual({
      cnpjEmitente: '14224864000100', modelo: '55', serie: '2', numero: '2190',
    })
  })

  it('recusa DV incorreto, modelo 65, texto curto e sequência não fiscal', () => {
    expect(validarChaveNfe55(`${valid.slice(0, 43)}${Number(valid[43]) === 9 ? 0 : Number(valid[43]) + 1}`)).toBe(false)
    expect(validarChaveNfe55(`${valid.slice(0, 20)}65${valid.slice(22)}`)).toBe(false)
    expect(validarChaveNfe55('2190')).toBe(false)
    expect(validarChaveNfe55('A'.repeat(44))).toBe(false)
  })
})
