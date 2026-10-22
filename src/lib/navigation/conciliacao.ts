import type { ConciliacaoTab } from '@/lib/financeiro/conciliacao/loaders.server'

export type FilaConciliacao = 'matching' | 'conciliacao' | 'logistica'
export const FILAS_CONCILIACAO: readonly FilaConciliacao[] = ['matching', 'conciliacao', 'logistica']

export const SECOES_CONCILIACAO = [
  { id: 'resumo', label: 'Resumo', views: ['visao-geral'] },
  { id: 'estoque-movimentacoes', label: 'Estoque e Movimentações', views: ['conciliacao'] },
  { id: 'lastro-logistica', label: 'Lastro e Logística', views: ['matching', 'logistica'] },
  { id: 'exposicao-risco', label: 'Exposição e Risco', views: ['exposicao', 'risco'] },
  { id: 'pendencias', label: 'Pendências', views: ['excecoes'] },
] as const

export function secaoConciliacao(tab: ConciliacaoTab) {
  return SECOES_CONCILIACAO.find(section => section.views.some(view => view === tab)) || SECOES_CONCILIACAO[0]
}

export function resolverNavegacaoConciliacao(tab: string, detalhe = '', fila = ''): { tab: ConciliacaoTab; fila?: FilaConciliacao } {
  const section = SECOES_CONCILIACAO.find(item => item.id === tab)
  const legacy = SECOES_CONCILIACAO.flatMap(item => [...item.views]).find(view => view === tab)
  const view = section?.views.find(view => view === detalhe) || section?.views[0] || legacy || 'visao-geral'
  return { tab: view, ...(view === 'excecoes' && FILAS_CONCILIACAO.some(item => item === fila) ? { fila: fila as FilaConciliacao } : {}) }
}

export function parametrosConciliacao(tab: ConciliacaoTab, data?: string, fila?: FilaConciliacao) {
  const section = secaoConciliacao(tab)
  const params = new URLSearchParams({ tab: section.id })
  if (section.views.length > 1) params.set('detalhe', tab)
  if (data) params.set('data', data)
  if (tab === 'excecoes' && fila) params.set('fila', fila)
  return params
}

export function hrefConciliacao(tab: ConciliacaoTab, data?: string, fila?: FilaConciliacao) {
  return `/gestor/conciliacao?${parametrosConciliacao(tab, data, fila)}`
}
