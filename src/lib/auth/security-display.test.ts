import { describe, expect, it } from 'vitest'
import { formatarDataSeguranca, formatarTempoRestanteSessaoMfa } from './security-display'

describe('apresentacao da sessao de seguranca', () => {
  it('calcula a janela restante usando o relogio recebido do servidor', () => {
    expect(formatarTempoRestanteSessaoMfa('2026-08-13T10:00:00.000Z', '2026-08-14T09:32:00.000Z')).toBe('23h 32min')
  })

  it('considera expirada a fronteira exata e nao inventa prazo ausente', () => {
    expect(formatarTempoRestanteSessaoMfa('2026-08-14T10:00:00.000Z', '2026-08-14T10:00:00.000Z')).toBe('Expirada')
    expect(formatarTempoRestanteSessaoMfa('2026-08-14T10:00:00.000Z', null)).toBe('Nao disponivel')
  })

  it('nao apresenta datas invalidas como informacao confiavel', () => {
    expect(formatarDataSeguranca('invalida')).toBe('Nao informado')
    expect(formatarDataSeguranca(null)).toBe('Nao informado')
  })
})
