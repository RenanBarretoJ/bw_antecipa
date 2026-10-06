'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { carregarPaginaNotificacoes, marcarNotificacoesLidas } from '@/lib/actions/notificacoes-listagem'
import { chaveEscopo, deduplicarNotificacoes, eventoDoEscopo, type NotificacaoFiltro, type NotificacaoPagina } from '@/lib/notificacoes/contracts'
import { NOTIFICACOES_ATUALIZAR, NOTIFICACOES_CONTEXTO_INICIO } from '@/lib/notificacoes/events'
import { useNotificacoesContexto } from './notificacoes-context'

const EMPTY: NotificacaoPagina = { items: [], hasMore: false, nextCursor: null, contadores: { total: 0, naoLidas: 0 } }
type State = { key: string; page: NotificacaoPagina; loading: boolean; more: boolean; busy: boolean; error: string | null }

export function useNotificacoes(filtro: NotificacaoFiltro, limit: number) {
  const { contexto, escopo, epoch } = useNotificacoesContexto()
  const key = `${contexto?.userId}:${chaveEscopo(escopo)}:${epoch}:${filtro}:${limit}`
  const [state, setState] = useState<State>({ key: '', page: EMPTY, loading: true, more: false, busy: false, error: null })
  const [supabase] = useState(() => createClient())
  const ticket = useRef(0)
  const session = useRef(0)
  const refreshRef = useRef<() => void>(() => {})
  const current = useMemo(() => state.key === key ? state : { key, page: EMPTY, loading: Boolean(escopo), more: false, busy: false, error: null }, [state, key, escopo])

  const requestPage = useCallback(async (cursor: string | null = null) => {
    if (!escopo || !contexto) return
    const request = ++ticket.current
    const boundary = session.current
    setState((old) => ({ key, page: old.key === key ? old.page : EMPTY, loading: !cursor, more: Boolean(cursor), busy: old.key === key && old.busy, error: null }))
    try {
      const page = await carregarPaginaNotificacoes({ escopo, filtro, limit, cursor })
      if (request !== ticket.current || boundary !== session.current || page.userId !== contexto.userId) return
      // Defense in depth: never render a wrong-scope response, even if transport or mocks misbehave.
      if (page.items.some((item) => item.scope !== escopo.scope || item.fundoId !== escopo.fundoId)) throw new Error('Contexto divergente.')
      setState((old) => ({ key, page: cursor && old.key === key ? { ...page, items: deduplicarNotificacoes([...old.page.items, ...page.items]) } : page, loading: false, more: false, busy: false, error: null }))
    } catch {
      if (request === ticket.current && boundary === session.current) setState({ key, page: EMPTY, loading: false, more: false, busy: false, error: 'Não foi possível carregar as notificações deste contexto. Tente novamente.' })
    }
  }, [contexto, escopo, filtro, key, limit])

  useEffect(() => {
    session.current += 1
    refreshRef.current = () => { void requestPage() }
    void requestPage()
    if (!escopo || !contexto) return
    const refresh = () => { void requestPage() }
    const invalidate = () => { session.current += 1; ticket.current += 1; setState({ key: '', page: EMPTY, loading: true, more: false, busy: false, error: null }) }
    const channel = supabase.channel(`notificacoes:${key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notificacoes', filter: `usuario_id=eq.${contexto.userId}` }, (payload) => {
        // UPDATE old values / DELETE may only contain a PK. Do not infer counts or a fund from them.
        if (payload.eventType === 'DELETE' || eventoDoEscopo(payload.new as Record<string, unknown>, contexto.userId, escopo)) refresh()
      }).subscribe((status) => { if (status === 'SUBSCRIBED') refresh() })
    const interval = window.setInterval(refresh, 30_000)
    window.addEventListener(NOTIFICACOES_ATUALIZAR, refresh)
    window.addEventListener(NOTIFICACOES_CONTEXTO_INICIO, invalidate)
    window.addEventListener('focus', refresh)
    return () => {
      session.current += 1
      ticket.current += 1
      window.clearInterval(interval)
      window.removeEventListener(NOTIFICACOES_ATUALIZAR, refresh)
      window.removeEventListener(NOTIFICACOES_CONTEXTO_INICIO, invalidate)
      window.removeEventListener('focus', refresh)
      void supabase.removeChannel(channel)
    }
  }, [contexto, escopo, key, requestPage, supabase])

  const mark = useCallback(async (id: string | null) => {
    if (!escopo || current.busy || current.loading) return false
    const boundary = session.current
    setState((old) => ({ ...old, busy: true, error: null }))
    try {
      await marcarNotificacoesLidas(escopo, id)
      if (boundary !== session.current) return false
      window.dispatchEvent(new Event(NOTIFICACOES_ATUALIZAR))
      return true
    } catch {
      if (boundary === session.current) setState((old) => ({ ...old, busy: false, error: 'Não foi possível marcar neste contexto. Nenhuma confirmação de leitura foi recebida.' }))
      return false
    }
  }, [escopo, current.busy, current.loading])
  const loadMore = useCallback(() => {
    if (current.page.nextCursor && !current.loading && !current.more) void requestPage(current.page.nextCursor)
  }, [current.page.nextCursor, current.loading, current.more, requestPage])
  return useMemo(() => ({ ...current, mark, loadMore, retry: () => refreshRef.current() }), [current, mark, loadMore])
}
