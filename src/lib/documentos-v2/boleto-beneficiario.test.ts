import { describe, expect, it } from 'vitest'
import {
  deveTentarAutodeteccaoBeneficiario,
  encontrarBeneficiarioUnico,
  extrairCandidatosCnpj,
  resolverBeneficiarioEfetivo,
} from './boleto-beneficiario'

describe('extrairCandidatosCnpj', () => {
  it('texto sem CNPJ retorna lista vazia', () => {
    expect(extrairCandidatosCnpj('boleto sem nenhum documento fiscal aqui')).toEqual([])
  })

  it('extrai CNPJ formatado (XX.XXX.XXX/XXXX-XX)', () => {
    expect(extrairCandidatosCnpj('Beneficiario: 12.345.678/0001-90 Sao Paulo')).toEqual(['12345678000190'])
  })

  it('extrai CNPJ apenas com digitos (sem formatacao)', () => {
    expect(extrairCandidatosCnpj('CNPJ 12345678000190 - ACME LTDA')).toEqual(['12345678000190'])
  })

  it('extrai multiplos CNPJs distintos, sem duplicar repeticoes', () => {
    const texto = 'Cedente 11.222.333/0001-44 Sacado 11.222.333/0001-44 Beneficiario 99.888.777/0001-66'
    expect(extrairCandidatosCnpj(texto).sort()).toEqual(['11222333000144', '99888777000166'].sort())
  })
})

describe('encontrarBeneficiarioUnico', () => {
  const beneficiarios = [
    { id: 'b1', cnpj: '12345678000190' },
    { id: 'b2', cnpj: '99888777000166' },
  ]

  it('nenhum candidato -> null', () => {
    expect(encontrarBeneficiarioUnico([], beneficiarios)).toBeNull()
  })

  it('candidato presente mas fora da lista de beneficiarios -> null (nao adivinha)', () => {
    expect(encontrarBeneficiarioUnico(['00000000000000'], beneficiarios)).toBeNull()
  })

  it('exatamente um candidato bate com um beneficiario -> retorna o id', () => {
    expect(encontrarBeneficiarioUnico(['12345678000190'], beneficiarios)).toBe('b1')
  })

  it('candidato formatado tambem casa (compara so os digitos)', () => {
    expect(encontrarBeneficiarioUnico(['12.345.678/0001-90'], beneficiarios)).toBe('b1')
  })

  it('mais de um candidato batendo com beneficiarios diferentes -> ambiguo, retorna null', () => {
    expect(encontrarBeneficiarioUnico(['12345678000190', '99888777000166'], beneficiarios)).toBeNull()
  })

  it('lista de beneficiarios vazia -> null', () => {
    expect(encontrarBeneficiarioUnico(['12345678000190'], [])).toBeNull()
  })
})

describe('resolverBeneficiarioEfetivo', () => {
  it('sem escolha local e sem persistido -> vazio (selecao manual)', () => {
    expect(resolverBeneficiarioEfetivo(null, null)).toBe('')
    expect(resolverBeneficiarioEfetivo(undefined, undefined)).toBe('')
  })

  it('sem escolha local, com beneficiario persistido -> usa o persistido (reenvio apos rejeicao)', () => {
    expect(resolverBeneficiarioEfetivo(null, 'b-persistido')).toBe('b-persistido')
  })

  it('com escolha local e com persistido -> escolha local (manual ou auto-detectada nesta sessao) prevalece', () => {
    expect(resolverBeneficiarioEfetivo('b-local', 'b-persistido')).toBe('b-local')
  })

  it('com escolha local e sem persistido -> usa a escolha local', () => {
    expect(resolverBeneficiarioEfetivo('b-local', null)).toBe('b-local')
  })
})

describe('deveTentarAutodeteccaoBeneficiario', () => {
  it('sem beneficiario resolvido (nem local, nem persistido) -> tenta autodeteccao', () => {
    expect(deveTentarAutodeteccaoBeneficiario(null, null)).toBe(true)
  })

  it('com beneficiario persistido (mesmo sem escolha local) -> NAO tenta -- preserva o de um envio anterior', () => {
    expect(deveTentarAutodeteccaoBeneficiario(null, 'b-persistido')).toBe(false)
  })

  it('com escolha local (manual ou ja auto-detectada) -> NAO tenta de novo', () => {
    expect(deveTentarAutodeteccaoBeneficiario('b-local', null)).toBe(false)
  })
})
