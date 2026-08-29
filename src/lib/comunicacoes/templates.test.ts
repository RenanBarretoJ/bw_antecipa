import { describe, expect, it } from 'vitest'
import { agruparComunicacoes } from './agrupamento'
import { criarGrupoPreview, obterTemplatePadrao, renderizarComunicacao, validarTemplate } from './templates'
import type { ItemComunicacao } from './tipos'

function item(patch: Partial<ItemComunicacao> = {}): ItemComunicacao {
  return { ...criarGrupoPreview('LOGISTICA').itens[0], ...patch }
}

describe('templates e agrupamento de comunicacoes', () => {
  it('rejeita variavel fora da allowlist', () => {
    expect(() => validarTemplate({ assunto: '{{segredo}}', html: '<p>ok</p>', texto: 'ok' }, 'LOGISTICA')).toThrow('Variavel de template nao permitida')
  })

  it('escapa dados operacionais e preserva somente a tabela gerada pelo sistema', () => {
    const group = criarGrupoPreview('LOGISTICA')
    group.itens[0].cedenteNome = '<img src=x onerror=alert(1)>'
    group.itens[0].numeroNf = '<script>alert(1)</script>'
    const rendered = renderizarComunicacao(group, obterTemplatePadrao(group.categoria))
    expect(rendered.html).not.toContain('<script>')
    expect(rendered.html).toContain('&lt;script&gt;')
    expect(rendered.html).toContain('<table')
  })

  it('consolida itens do mesmo fundo, familia, destinatario e data', () => {
    const groups = agruparComunicacoes([item(), item({ itemKey: 'outro', numeroNf: '2' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].itens).toHaveLength(2)
  })

  it('separa fundos, familias, destinatarios e datas diferentes', () => {
    const groups = agruparComunicacoes([
      item(),
      item({ fundoId: 'fundo-2', itemKey: '2' }),
      item({ destinatarioEmail: 'outro@example.invalid', itemKey: '3' }),
      item({ familia: 'FINANCEIRO', itemKey: '4' }),
      item({ etapa: { ...item().etapa, dataEfetiva: '2026-08-12' }, itemKey: '5' }),
    ])
    expect(groups).toHaveLength(5)
  })

  it('mantem a categoria mais critica em uma consolidacao', () => {
    const groups = agruparComunicacoes([item({ categoria: 'LOGISTICA_LEMBRETE' }), item({ itemKey: '2', categoria: 'LOGISTICA_REJEITADO' })])
    expect(groups[0].categoria).toBe('LOGISTICA_REJEITADO')
  })
})
