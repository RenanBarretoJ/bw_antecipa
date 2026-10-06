import 'server-only'
import { requireAuthenticated, type AuthContext } from '@/lib/auth/authorization'
import { encodeCursor, parseCursor } from '@/lib/pagination/cursor'
import { compactarNotificacao, parseNotificacaoFiltro, type NotificacaoContadores, type NotificacaoEscopo, type NotificacaoFiltro, type NotificacaoPagina } from './contracts'
import { validarContextoNotificacoes } from './contexto.server'

export async function contarNotificacoesDoContext(context: AuthContext, escopo: NotificacaoEscopo): Promise<NotificacaoContadores> {
  const { data, error } = await context.supabase.rpc('contar_notificacoes', { p_scope: escopo.scope, p_fundo_id: escopo.fundoId })
  if (error) throw new Error('Não foi possível contar as notificações.')
  return { total: Number(data?.[0]?.total ?? 0), naoLidas: Number(data?.[0]?.nao_lidas ?? 0) }
}

export async function carregarNotificacoesUsuario(input: {
  escopo: NotificacaoEscopo
  cursor?: string | null
  limit?: number
  filtro?: NotificacaoFiltro
}): Promise<NotificacaoPagina & { userId: string }> {
  const context = await requireAuthenticated()
  await validarContextoNotificacoes(context, input.escopo)
  const limit = Math.min(Math.max(Number.isFinite(input.limit) ? Math.trunc(input.limit!) : 20, 1), 39)
  const cursor = input.cursor ? parseCursor(input.cursor) : null
  if (input.cursor && !cursor) throw new Error('Cursor de notificações inválido.')
  const [list, contadores] = await Promise.all([
    context.supabase.rpc('listar_notificacoes_filtradas', {
      p_scope: input.escopo.scope, p_fundo_id: input.escopo.fundoId,
      p_filtro: parseNotificacaoFiltro(input.filtro), p_limit: limit + 1,
      p_cursor_em: cursor?.createdAt ?? null, p_cursor_id: cursor?.id ?? null,
    }),
    contarNotificacoesDoContext(context, input.escopo),
  ])
  if (list.error) throw new Error('Não foi possível carregar as notificações.')
  const rows = (list.data ?? []).slice(0, limit)
  const last = rows.at(-1)
  const hasMore = (list.data?.length ?? 0) > limit
  return {
    userId: context.user.id,
    items: rows.map(compactarNotificacao).filter((item) => item !== null),
    contadores, hasMore,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  }
}
