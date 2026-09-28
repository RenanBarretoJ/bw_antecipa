import { describe, expect, it } from 'vitest'
import {
  formatarTaxaOperacaoInput,
  normalizarTaxaOperacao,
  parseTaxaOperacao,
  taxaEstaConfiguradaParaPrazo,
  taxaMantemPropostaConsultor,
} from './taxa-operacao'

const taxas = [
  { prazo_min: 0, prazo_max: 60, taxa_percentual: 2.5 },
  { prazo_min: 0, prazo_max: 60, taxa_percentual: 2.35 },
]

describe('taxa da operacao', () => {
  it('aceita decimal pt-BR sem usar float como representacao canonica', () => {
    expect(normalizarTaxaOperacao('2,50')).toBe('2.5')
    expect(parseTaxaOperacao('2,35')).toBe(2.35)
    expect(formatarTaxaOperacaoInput(2.5)).toBe('2,5')
  })

  it.each(['', '-1', 'NaN', 'Infinity', '2,3,4', 'abc'])('rejeita entrada invalida %s', (value) => {
    expect(normalizarTaxaOperacao(value)).toBeNull()
    expect(parseTaxaOperacao(value)).toBeNull()
  })

  it('aceita somente taxa exatamente configurada e aplicavel ao prazo', () => {
    expect(taxaEstaConfiguradaParaPrazo(taxas, 30, '2,50')).toBe(true)
    expect(taxaEstaConfiguradaParaPrazo(taxas, 30, '2,35')).toBe(true)
    expect(taxaEstaConfiguradaParaPrazo(taxas, 30, '2,40')).toBe(false)
    expect(taxaEstaConfiguradaParaPrazo(taxas, 90, '2,50')).toBe(false)
  })

  it('permite ao Gestor manter a proposta livre do Consultor', () => {
    expect(taxaMantemPropostaConsultor('2,40', 2.4)).toBe(true)
    expect(taxaMantemPropostaConsultor('2,35', 2.4)).toBe(false)
    expect(taxaMantemPropostaConsultor('2,40', null)).toBe(false)
  })
})
