import type { CursorResult } from '@/lib/pagination/types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const NOTIFICACAO_FILTROS = {
  todas: 'Todas', nao_lidas: 'Não lidas', lidas: 'Lidas', operacoes: 'Operações',
  documentos: 'Documentos', logistica: 'Logística', integracoes: 'Integrações', alertas: 'Alertas',
} as const
export type NotificacaoFiltro = keyof typeof NOTIFICACAO_FILTROS
export type NotificacaoEscopo = { scope: 'FUNDO'; fundoId: string } | { scope: 'GLOBAL'; fundoId: null }
export type NotificacaoContexto = {
  userId: string
  role: string
  fundos: Array<{ id: string; nome: string }>
  fundoId: string | null
  seletorProprio: boolean
}

export function chaveEscopo(escopo: NotificacaoEscopo | null): string {
  return escopo ? `${escopo.scope}:${escopo.fundoId ?? 'geral'}` : 'sem-fundo'
}

export function eventoDoEscopo(row: Record<string, unknown>, userId: string, escopo: NotificacaoEscopo): boolean {
  return row.usuario_id === userId && row.scope_type === escopo.scope && row.fundo_id === escopo.fundoId
}

export type NotificacaoListagemItem = {
  id: string
  createdAt: string
  titulo: string
  mensagem: string
  tipo: string
  lida: boolean
  entidadeTipo: string | null
  entidadeId: string | null
  href: string | null
  scope: 'FUNDO' | 'GLOBAL'
  fundoId: string | null
}

export type NotificacaoContadores = {
  total: number
  naoLidas: number
}

export type NotificacaoPagina = CursorResult<NotificacaoListagemItem> & {
  contadores?: NotificacaoContadores
}

export function parseNotificacaoFiltro(value: unknown): NotificacaoFiltro {
  return typeof value === 'string' && Object.hasOwn(NOTIFICACAO_FILTROS, value) ? value as NotificacaoFiltro : 'todas'
}

export function notificacaoMatchesFilter(item: NotificacaoListagemItem, filtro: NotificacaoFiltro): boolean {
  if (filtro === 'nao_lidas') return !item.lida
  if (filtro === 'lidas') return item.lida
  // Mirrors the official filtered RPC; filtering is applied before pagination.
  const categorias = {
    operacoes: /^(operacao_|antecipacao_|cessao_|desembolso|liquidacao|pagamento_|vencimento_|inadimplencia)/,
    documentos: /^(documento_|nf_|nota_fiscal_|boleto_|cadastro_|alteracao_cadastral|estabelecimento_)/,
    logistica: /(cte|canhoto|entrega|logistica|postergacao)/,
    integracoes: /(integracao|intake|cnab|custodiante|transportadora|webhook)/,
    alertas: /(alerta|erro|falha|vencid|vencimento|inadimpl|prazo|pendencia|seguranca|mfa_)/,
  }
  if (filtro in categorias) return categorias[filtro as keyof typeof categorias].test(item.tipo)
  return true
}

export function compactarNotificacao(row: unknown): NotificacaoListagemItem | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const value = row as Record<string, unknown>
  if (
    typeof value.id !== 'string'
    || !UUID_PATTERN.test(value.id)
    || typeof value.created_at !== 'string'
    || Number.isNaN(new Date(value.created_at).getTime())
    || typeof value.titulo !== 'string'
    || typeof value.mensagem !== 'string'
    || typeof value.tipo !== 'string'
    || typeof value.lida !== 'boolean'
    || !['FUNDO', 'GLOBAL'].includes(String(value.scope_type))
    || (value.scope_type === 'FUNDO' && (typeof value.fundo_id !== 'string' || !UUID_PATTERN.test(value.fundo_id)))
    || (value.scope_type === 'GLOBAL' && value.fundo_id !== null)
  ) return null

  // Never navigate to a stored arbitrary URL, including legacy URLs.
  const href = `/notificacoes/abrir/${value.id}?${value.scope_type === 'GLOBAL' ? 'scope=GLOBAL' : `fundo=${value.fundo_id}`}`

  return {
    id: value.id,
    createdAt: value.created_at,
    titulo: value.titulo,
    mensagem: value.mensagem,
    tipo: value.tipo,
    lida: value.lida,
    entidadeTipo: typeof value.entidade_tipo === 'string' ? value.entidade_tipo : null,
    entidadeId: typeof value.entidade_id === 'string' && UUID_PATTERN.test(value.entidade_id) ? value.entidade_id : null,
    href,
    scope: value.scope_type as 'FUNDO' | 'GLOBAL',
    fundoId: value.fundo_id as string | null,
  }
}

export function deduplicarNotificacoes(items: NotificacaoListagemItem[]): NotificacaoListagemItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}
