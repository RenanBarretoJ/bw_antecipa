import type { CursorResult } from '@/lib/pagination/types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type NotificacaoFiltro = 'todas' | 'nao_lidas' | 'lidas'

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
}

export type NotificacaoContadores = {
  total: number
  naoLidas: number
}

export type NotificacaoPagina = CursorResult<NotificacaoListagemItem> & {
  contadores?: NotificacaoContadores
}

export function parseNotificacaoFiltro(value: unknown): NotificacaoFiltro {
  return value === 'nao_lidas' || value === 'lidas' ? value : 'todas'
}

export function notificacaoMatchesFilter(item: NotificacaoListagemItem, filtro: NotificacaoFiltro): boolean {
  if (filtro === 'nao_lidas') return !item.lida
  if (filtro === 'lidas') return item.lida
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
  ) return null

  return {
    id: value.id,
    createdAt: value.created_at,
    titulo: value.titulo,
    mensagem: value.mensagem,
    tipo: value.tipo,
    lida: value.lida,
    entidadeTipo: null,
    entidadeId: null,
    href: null,
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
