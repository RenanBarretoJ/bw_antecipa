import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BaseAntecipacaoConfig } from './BaseAntecipacaoConfig'

vi.mock('@/lib/actions/configuracao-financeira-fundo', () => ({ configurarBaseAntecipacao: vi.fn() }))

describe('rótulo persistido da base de antecipação', () => {
  it.each([
    ['BRUTO', 'Valor bruto da nota'],
    ['LIQUIDO', 'Valor líquido da nota'],
  ] as const)('mostra %s com descrição de negócio antes de abrir o seletor', (base, label) => {
    const html = renderToStaticMarkup(createElement(BaseAntecipacaoConfig, { vinculoId: 'qa', baseAtual: base }))
    expect(html).toContain(`>${label}</span>`)
  })
})
