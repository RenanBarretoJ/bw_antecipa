import { describe, expect, it } from 'vitest'
import { validarFundoParaIngestao } from './fund-context'

describe('contexto tecnico da ingestao financeira', () => {
  it('permite preparar fundo inativo sem torna-lo operacional', () => {
    expect(validarFundoParaIngestao({ id: 'fundo-inativo', ativo: false })).toEqual({ id: 'fundo-inativo', ativo: false })
  })

  it('bloqueia fundo inexistente', () => {
    expect(() => validarFundoParaIngestao(null)).toThrow('Fundo inexistente')
  })
})
