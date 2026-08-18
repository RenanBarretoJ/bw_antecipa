import { describe, expect, it } from 'vitest'
import { validarComposicaoEstabelecimentosOperacao } from './estabelecimentos'

describe('validarComposicaoEstabelecimentosOperacao', () => {
  it('preserva comportamento sem decidir se estabelecimentos diferentes podem coexistir', () => {
    expect(validarComposicaoEstabelecimentosOperacao({
      cedenteId: 'cedente-a',
      estabelecimentoIds: ['matriz-a', 'filial-a', 'filial-a'],
    })).toEqual({
      cedenteId: 'cedente-a',
      estabelecimentoIds: ['matriz-a', 'filial-a'],
    })
  })
})
