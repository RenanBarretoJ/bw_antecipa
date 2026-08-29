import 'server-only'

import type { UserRole } from '@/types/database'
import { requireAuthenticated, requireRole, type AuthContext } from '@/lib/auth/authorization'
import { createAdminClient } from '@/lib/supabase/server'
import { encodeCursor, parseCursor } from '@/lib/pagination/cursor'
import { buildDescendingCreatedAtCursorFilter } from '@/lib/pagination/keyset'
import {
  compactarNotificacao,
  type NotificacaoContadores,
  type NotificacaoFiltro,
  type NotificacaoPagina,
} from './contracts'

const SELECT_FIELDS = 'id, titulo, mensagem, tipo, lida, entidade_tipo, entidade_id, href, created_at'

type SupabaseQueryError = {
  code?: string
  hint?: string | null
}

function registrarErroNotificacoes(operacao: string, error: SupabaseQueryError | null | undefined) {
  console.error('[notificacoes] Falha na consulta server-side.', {
    operacao,
    code: error?.code || 'UNKNOWN',
    hasHint: Boolean(error?.hint),
  })
}

export async function contarNotificacoesDoContext(context: AuthContext): Promise<NotificacaoContadores> {
  const notificationsClient = createAdminClient()
  const [totalResult, unreadResult] = await Promise.all([
    notificationsClient
      .from('notificacoes')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', context.user.id),
    notificationsClient
      .from('notificacoes')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', context.user.id)
      .eq('lida', false),
  ])
  if (totalResult.error || unreadResult.error) {
    registrarErroNotificacoes('count', totalResult.error || unreadResult.error)
    throw new Error('Nao foi possivel contar as notificacoes.')
  }
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

  const notificationsClient = createAdminClient()
  let query = notificationsClient
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
  if (listResult.error) {
    registrarErroNotificacoes('list', listResult.error)
    throw new Error('Nao foi possivel carregar as notificacoes.')
  }

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
