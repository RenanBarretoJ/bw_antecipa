import { describe, expect, it } from 'vitest'
import { codigoCarteiraDaConfiguracao, prepararConfiguracaoVortxVrs, validarConfiguracaoInclusaoVrs } from './configuracao-vortx-vrs'

describe('prepararConfiguracaoVortxVrs', () => {
  it('mapeia o codigo textual oficial para configuracao_nao_sensivel.codigo_carteira', () => {
    const result = prepararConfiguracaoVortxVrs({
      configuracao: { outro_campo: true },
      codigoCarteira: 'CART01',
    })
    expect(result).toEqual({ outro_campo: true, codigo_carteira: 'CART01' })
  })

  it('preserva a configuracao original quando o codigo da carteira ainda nao foi informado (opcional)', () => {
    const result = prepararConfiguracaoVortxVrs({ configuracao: { outro_campo: true }, codigoCarteira: '' })
    expect(result).toEqual({ outro_campo: true })
  })

  it('rejeita codigo de carteira fora do alfabeto oficial', () => {
    expect(() => prepararConfiguracaoVortxVrs({ configuracao: {}, codigoCarteira: 'carteira com espaco' })).toThrow(/alfanumericos/)
  })

  it('normaliza e valida a configuracao completa de inclusao', () => {
    const result = prepararConfiguracaoVortxVrs({
      configuracao: {},
      codigoCarteira: 'CART01',
      inclusao: {
        termo: ' TERMO_1 ', cnpj_originador: '68.522.785/0001-04', tipo_preco: 'prefixado',
        metodo_preco: 'PREFIXADO', modalidade_operacao: '02.02', registradora: 'cerc',
      },
    })
    expect(validarConfiguracaoInclusaoVrs(result)).toBeNull()
    expect(result).toMatchObject({
      codigo_carteira: 'CART01',
      vrs_inclusao: { termo: 'TERMO_1', cnpj_originador: '68522785000104', modalidade_operacao: '0202' },
    })
  })
})

describe('codigoCarteiraDaConfiguracao', () => {
  it('le o codigo da carteira ja salvo na configuracao', () => {
    expect(codigoCarteiraDaConfiguracao({ codigo_carteira: '11111111-1111-1111-1111-111111111111' })).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('retorna string vazia quando ausente ou de tipo invalido', () => {
    expect(codigoCarteiraDaConfiguracao({})).toBe('')
    expect(codigoCarteiraDaConfiguracao({ codigo_carteira: 123 })).toBe('')
  })
})
