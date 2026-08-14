import { describe, expect, it } from 'vitest'
import { prepararConfiguracaoFinanceiraDoFundo } from './configuracao-financeira'

describe('prepararConfiguracaoFinanceiraDoFundo', () => {
  it('preserva a configuracao quando nao ha capability financeira', () => {
    const configuracao = { modo: 'CNAB' }
    expect(prepararConfiguracaoFinanceiraDoFundo({
      configuracao,
      capabilities: ['CESSAO_ENVIO'],
      cnpjFundo: '68.522.785/0001-04',
    })).toBe(configuracao)
  })

  it('registra o CNPJ normalizado e preserva os demais parametros', () => {
    expect(prepararConfiguracaoFinanceiraDoFundo({
      configuracao: {
        modo: 'CNAB',
        relatorios_financeiros: { intervalo_polling_ms: 5000, cnpj_fundo: '00000000000000' },
      },
      capabilities: ['ESTOQUE', 'AQUISICOES'],
      cnpjFundo: '68.522.785/0001-04',
    })).toEqual({
      modo: 'CNAB',
      relatorios_financeiros: {
        intervalo_polling_ms: 5000,
        cnpj_fundo: '68522785000104',
      },
    })
  })

  it('bloqueia capability financeira quando o cadastro do fundo nao possui CNPJ valido', () => {
    expect(() => prepararConfiguracaoFinanceiraDoFundo({
      configuracao: {},
      capabilities: ['LIQUIDACOES'],
      cnpjFundo: '123',
    })).toThrow('CNPJ cadastrado do fundo')
  })
})
