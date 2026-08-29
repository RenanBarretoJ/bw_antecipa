import { describe, expect, it } from 'vitest'
import { mensagemBloqueioNovaSolicitacao } from './nova-solicitacao-block'

describe('mensagemBloqueioNovaSolicitacao', () => {
  it('transforma ausencia de politica em bloqueio operacional explicito', () => {
    expect(mensagemBloqueioNovaSolicitacao({
      code: 'POLITICA_CONTEXT_NOT_CONFIGURED',
      message: 'Politica publicada ausente.',
    })).toBe('Politica publicada ausente.')
  })

  it('nao mascara falhas inesperadas', () => {
    expect(mensagemBloqueioNovaSolicitacao(new Error('Falha de banco'))).toBeNull()
  })
})

