import { describe, expect, it } from 'vitest'
import { hrefConciliacao, parametrosConciliacao, resolverNavegacaoConciliacao, SECOES_CONCILIACAO } from './conciliacao'

describe('navegacao agrupada da conciliacao', () => {
  it('organiza cinco secoes sem perder as sete visoes existentes', () => {
    expect(SECOES_CONCILIACAO.map(item => item.label)).toEqual(['Resumo', 'Estoque e Movimentações', 'Lastro e Logística', 'Exposição e Risco', 'Pendências'])
    expect(new Set(SECOES_CONCILIACAO.flatMap(item => [...item.views])).size).toBe(7)
  })
  it.each(['visao-geral', 'matching', 'conciliacao', 'logistica', 'exposicao', 'risco', 'excecoes'])('preserva o link legado %s', tab => {
    expect(resolverNavegacaoConciliacao(tab).tab).toBe(tab)
  })
  for (const section of SECOES_CONCILIACAO) for (const view of section.views) {
    it(`preserva ${view} ao navegar pela secao ${section.id}`, () => {
      const params = parametrosConciliacao(view, '2026-10-22')
      expect(params.get('tab')).toBe(section.id)
      expect(params.get('data')).toBe('2026-10-22')
      expect(resolverNavegacaoConciliacao(params.get('tab')!, params.get('detalhe') || '').tab).toBe(view)
      expect(hrefConciliacao(view)).toContain('/gestor/conciliacao?')
    })
  }
  it('rejeita detalhes e filas de outro contexto ou nao reconhecidos', () => {
    expect(resolverNavegacaoConciliacao('lastro-logistica', 'risco', 'matching')).toEqual({ tab: 'matching' })
    expect(resolverNavegacaoConciliacao('pendencias', '', 'invalida')).toEqual({ tab: 'excecoes' })
    expect(resolverNavegacaoConciliacao('invalida', 'risco')).toEqual({ tab: 'visao-geral' })
  })
  it('mantem a fila no link paginado e nao aceita que ela mude o dominio fora de Pendencias', () => {
    const params = parametrosConciliacao('excecoes', '2026-10-22', 'logistica')
    params.set('page', '3')
    expect(resolverNavegacaoConciliacao(params.get('tab')!, '', params.get('fila')!)).toEqual({ tab: 'excecoes', fila: 'logistica' })
    expect(parametrosConciliacao('risco', undefined, 'matching').has('fila')).toBe(false)
  })
})
