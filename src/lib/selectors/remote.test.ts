import { describe, expect, it } from 'vitest'
import { preservarOpcaoSelecionada } from './remote'

describe('seletor remoto', () => {
  it('preserva a opcao selecionada quando uma nova busca nao a retorna', () => {
    const selecionada = { value: '1', label: 'Selecionada' }
    expect(preservarOpcaoSelecionada([{ value: '2', label: 'Outra' }], selecionada)).toEqual([
      selecionada,
      { value: '2', label: 'Outra' },
    ])
  })

  it('nao duplica a opcao selecionada', () => {
    const selecionada = { value: '1', label: 'Selecionada' }
    expect(preservarOpcaoSelecionada([selecionada], selecionada)).toEqual([selecionada])
  })
})
