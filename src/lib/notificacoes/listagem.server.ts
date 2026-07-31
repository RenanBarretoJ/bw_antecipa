import 'server-only'

import type { UserRole } from '@/types/database'
import { requireAuthenticated, requireRole, type AuthContext } from '@/lib/auth/authorization'
import { encodeCursor, parseCursor } from '@/lib/pagination/cursor'
import { buildDescendingCreatedAtCursorFilter } from '@/lib/pagination/keyset'
import {
  compactarNotificacao,
  type NotificacaoContadores,
  type NotificacaoFiltro,
  type NotificacaoPagina,
} from './contracts'

const SELECT_FIELDS = 'id, titulo, mensagem, tipo, lida, created_at'

export async function contarNotificacoesDoContext(context: AuthContext): Promise<NotificacaoContadores> {
  const [totalResult, unreadResult] = await Promise.all([
    context.supabase
      .from('notificacoes')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', context.user.id),
    context.supabase
      .from('notificacoes')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', context.user.id)
      .eq('lida', false),
  ])
  if (totalResult.error || unreadResult.error) throw new Error('Nao foi possivel contar as notificacoes.')
  return { total: totalResult.count ?? 0, naoLidas: unreadResult.count ?? 0 }
}

export async function contarNotificacoesUsuario(): Promise<NotificacaoContadores> {
  return contarNotificacoesDoContext(await requireAuthenticated())
}

export async function carregarNotificacoesUsuario(input: {
  cursor?: string | null
  limit?: number
  filtro?: NotificacaoFiltro
  roleEsperada?: UserRole
  incluirContadores?: boolean
}): Promise<NotificacaoPagina & { userId: string }> {
  const context = input.roleEsperada
    ? await requireRole(input.roleEsperada)
    : await requireAuthenticated()
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 40)
  const cursor = input.cursor ? parseCursor(input.cursor) : null
  if (input.cursor && !cursor) {
    console.warn('[notificacoes] Cursor invalido ignorado; primeira pagina sera carregada.')
  }

  let query = context.supabase
    .from('notificacoes')
    .select(SELECT_FIELDS)
    .eq('usuario_id', context.user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (input.filtro === 'nao_lidas') query = query.eq('lida', false)
  if (input.filtro === 'lidas') query = query.eq('lida', true)
  if (cursor) query = query.or(buildDescendingCreatedAtCursorFilter(cursor))

  const [listResult, contadores] = await Promise.all([
    query,
    input.incluirContadores === false ? Promise.resolve(undefined) : contarNotificacoesDoContext(context),
  ])
  if (listResult.error) throw new Error(`Nao foi possivel carregar as notificacoes: ${listResult.error.message}`)

  const rows = (listResult.data ?? []) as unknown[]
  const pageRows = rows.slice(0, limit)
  const items = pageRows.map(compactarNotificacao).filter((item) => item !== null)
  const last = pageRows.at(-1) as Record<string, unknown> | undefined
  const hasMore = rows.length > limit

  return {
    userId: context.user.id,
    items,
    hasMore,
    nextCursor: hasMore && last
      ? encodeCursor({ createdAt: String(last.created_at), id: String(last.id) })
      : null,
    contadores,
  }
}
