import { describe, expect, it } from 'vitest'
import { codigoCarteiraDaConfiguracao, prepararConfiguracaoVortxVrs } from './configuracao-vortx-vrs'

describe('prepararConfiguracaoVortxVrs', () => {
  it('mapeia o codigo da carteira UUID para configuracao_nao_sensivel.codigo_carteira', () => {
    const result = prepararConfiguracaoVortxVrs({
      configuracao: { outro_campo: true },
      codigoCarteira: '11111111-1111-1111-1111-111111111111',
    })
    expect(result).toEqual({ outro_campo: true, codigo_carteira: '11111111-1111-1111-1111-111111111111' })
  })

  it('preserva a configuracao original quando o codigo da carteira ainda nao foi informado (opcional)', () => {
    const result = prepararConfiguracaoVortxVrs({ configuracao: { outro_campo: true }, codigoCarteira: '' })
    expect(result).toEqual({ outro_campo: true })
  })

  it('rejeita codigo de carteira que nao e um UUID valido', () => {
    expect(() => prepararConfiguracaoVortxVrs({ configuracao: {}, codigoCarteira: 'nao-e-uuid' })).toThrow(/UUID/)
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
