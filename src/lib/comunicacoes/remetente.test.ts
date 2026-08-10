import { describe, expect, it } from 'vitest'
import { resolverNomeRemetenteGestora } from './remetente'

describe('nome visivel do remetente por gestora', () => {
  it('remove somente o sufixo societario de limitada', () => {
    expect(resolverNomeRemetenteGestora('RX ASSET LTDA')).toBe('RX ASSET')
    expect(resolverNomeRemetenteGestora('Gestora Exemplo Limitada')).toBe('Gestora Exemplo')
  })

  it('preserva o nome cadastrado quando nao possui sufixo de limitada', () => {
    expect(resolverNomeRemetenteGestora('ALPHA ASSET MANAGEMENT')).toBe('ALPHA ASSET MANAGEMENT')
  })

  it('remove caracteres de controle e possui fallback seguro', () => {
    expect(resolverNomeRemetenteGestora('RX\r\nASSET LTDA')).toBe('RX ASSET')
    expect(resolverNomeRemetenteGestora('')).toBe('BETTER WITH')
    expect(resolverNomeRemetenteGestora(null)).toBe('BETTER WITH')
  })
})
