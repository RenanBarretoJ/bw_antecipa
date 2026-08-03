'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import {
  AlertTriangle,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  CheckCircle,
  Info,
  XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { buildListUrl } from '@/lib/pagination'
import {
  carregarMaisNotificacoes,
  marcarNotificacaoComoLida,
  marcarTodasNotificacoesComoLidas,
  recontarNotificacoesNaoLidas,
} from '@/lib/actions/notificacoes-listagem'
import {
  compactarNotificacao,
  deduplicarNotificacoes,
  notificacaoMatchesFilter,
  type NotificacaoContadores,
  type NotificacaoFiltro,
  type NotificacaoListagemItem,
  type NotificacaoPagina,
} from '@/lib/notificacoes/contracts'
import { LoadMoreButton } from '@/components/pagination/LoadMoreButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const TYPE_CONFIG: Record<string, {
  label: string
  icon: typeof Info
  badgeClass: string
  iconClass: string
  bgClass: string
}> = {
  info: {
    label: 'Info',
    icon: Info,
    badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    iconClass: 'text-blue-600 dark:text-blue-400',
    bgClass: 'bg-blue-100 dark:bg-blue-900/30',
  },
  sucesso: {
    label: 'Sucesso',
    icon: CheckCircle,
    badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    bgClass: 'bg-emerald-100 dark:bg-emerald-900/30',
  },
  alerta: {
    label: 'Alerta',
    icon: AlertTriangle,
    badgeClass: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    iconClass: 'text-yellow-600 dark:text-yellow-400',
    bgClass: 'bg-yellow-100 dark:bg-yellow-900/30',
  },
  erro: {
    label: 'Erro',
    icon: XCircle,
    badgeClass: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    iconClass: 'text-red-600 dark:text-red-400',
    bgClass: 'bg-red-100 dark:bg-red-900/30',
  },
}

function formatAbsoluto(dateStr: string): string {
  return new Date(dateStr).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function applyRealtimeItem(
  current: NotificacaoListagemItem[],
  item: NotificacaoListagemItem,
  filtro: NotificacaoFiltro,
) {
  const withoutCurrent = current.filter((entry) => entry.id !== item.id)
  return notificacaoMatchesFilter(item, filtro)
    ? deduplicarNotificacoes([item, ...withoutCurrent])
    : withoutCurrent
}

export function NotificacoesPageClient({
  initialPage,
  initialFilter,
  userId,
  basePath,
}: {
  initialPage: NotificacaoPagina
  initialFilter: NotificacaoFiltro
  userId: string
  basePath: string
}) {
  const [items, setItems] = useState(initialPage.items)
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [counts, setCounts] = useState<NotificacaoContadores>(
    initialPage.contadores ?? { total: 0, naoLidas: 0 },
  )
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [supabase] = useState(() => createClient())
  const realtimeIdsRef = useRef(new Set(initialPage.items.map((item) => item.id)))

  useEffect(() => {
    const channel = supabase
      .channel(`notificacoes-page-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notificacoes',
        filter: `usuario_id=eq.${userId}`,
      }, (payload) => {
        const newRow = payload.new as Record<string, unknown>
        const oldRow = payload.old as Record<string, unknown>

        if (payload.eventType === 'INSERT') {
          if (newRow.usuario_id !== userId) return
          const item = compactarNotificacao(newRow)
          if (!item || realtimeIdsRef.current.has(item.id)) return
          realtimeIdsRef.current.add(item.id)
          setItems((current) => applyRealtimeItem(current, item, initialFilter))
          setCounts((current) => ({
            total: current.total + 1,
            naoLidas: current.naoLidas + (item.lida ? 0 : 1),
          }))
          return
        }

        if (payload.eventType === 'UPDATE') {
          if (newRow.usuario_id !== userId) return
          const item = compactarNotificacao(newRow)
          if (!item) return
          setItems((current) => {
            if (!current.some((entry) => entry.id === item.id)) return current
            const updated = applyRealtimeItem(current, item, initialFilter)
            if (!notificacaoMatchesFilter(item, initialFilter)) {
              realtimeIdsRef.current.delete(item.id)
            }
            return updated
          })
          if (typeof oldRow.lida === 'boolean' && oldRow.lida !== item.lida) {
            setCounts((current) => ({
              ...current,
              naoLidas: Math.max(0, current.naoLidas + (item.lida ? -1 : 1)),
            }))
          }
          return
        }

        const deletedId = typeof oldRow.id === 'string' ? oldRow.id : null
        if (!deletedId) return
        realtimeIdsRef.current.delete(deletedId)
        setItems((current) => current.filter((item) => item.id !== deletedId))
        setCounts((current) => ({
          total: Math.max(0, current.total - 1),
          naoLidas: Math.max(0, current.naoLidas - (oldRow.lida === false ? 1 : 0)),
        }))
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [initialFilter, supabase, userId])

  async function reconcileCount() {
    try {
      setCounts(await recontarNotificacoesNaoLidas())
    } catch {
      // Realtime remains best effort; a later mutation or navigation reconciles it.
    }
  }

  function loadMore() {
    if (!nextCursor || isPending) return
    startTransition(async () => {
      setError(null)
      try {
        const page = await carregarMaisNotificacoes({ cursor: nextCursor, filtro: initialFilter })
        page.items.forEach((item) => realtimeIdsRef.current.add(item.id))
        setItems((current) => deduplicarNotificacoes([...current, ...page.items]))
        setNextCursor(page.nextCursor)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar mais notificações.')
      }
    })
  }

  async function markOne(item: NotificacaoListagemItem) {
    if (item.lida || markingId) return
    setMarkingId(item.id)
    setError(null)
    const previous = items
    setItems((current) => applyRealtimeItem(current, { ...item, lida: true }, initialFilter))
    setCounts((current) => ({ ...current, naoLidas: Math.max(0, current.naoLidas - 1) }))
    const result = await marcarNotificacaoComoLida(item.id)
    if (!result.success) {
      setItems(previous)
      setError(result.message ?? 'Não foi possível marcar a notificação como lida.')
      await reconcileCount()
    } else if (result.contadores) {
      setCounts(result.contadores)
    }
    setMarkingId(null)
  }

  async function markAll() {
    if (markingAll || counts.naoLidas === 0) return
    setMarkingAll(true)
    setError(null)
    const previous = items
    const previousCursor = nextCursor
    setItems((current) => initialFilter === 'nao_lidas'
      ? []
      : current.map((item) => ({ ...item, lida: true })))
    if (initialFilter === 'nao_lidas') setNextCursor(null)
    setCounts((current) => ({ ...current, naoLidas: 0 }))
    const result = await marcarTodasNotificacoesComoLidas()
    if (!result.success) {
      setItems(previous)
      setNextCursor(previousCursor)
      setError(result.message ?? 'Não foi possível marcar todas como lidas.')
      await reconcileCount()
    } else if (result.contadores) {
      setCounts(result.contadores)
    }
    setMarkingAll(false)
  }

  const tabs: Array<{ key: NotificacaoFiltro; label: string; count?: number }> = [
    { key: 'todas', label: 'Todas', count: counts.total },
    { key: 'nao_lidas', label: 'Não lidas', count: counts.naoLidas },
    { key: 'lidas', label: 'Lidas', count: Math.max(0, counts.total - counts.naoLidas) },
  ]

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notificações</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {counts.naoLidas > 0 ? `${counts.naoLidas} não lida${counts.naoLidas > 1 ? 's' : ''}` : 'Tudo em dia'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={markAll} disabled={markingAll || counts.naoLidas === 0} className="gap-2">
          <CheckCheck className="size-4" />
          {markingAll ? 'Marcando...' : 'Marcar todas como lidas'}
        </Button>
      </div>

      <nav className="mb-5 flex items-center gap-1 border-b border-border" aria-label="Filtros de notificações">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={buildListUrl(basePath, undefined, {
              filtro: tab.key === 'todas' ? null : tab.key,
              cursor: null,
            }, { pageParam: 'cursor', resetPageOn: ['filtro'] })}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              initialFilter === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            )}
          >
            {tab.label}
            {Boolean(tab.count) && (
              <span className={cn(
                'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold',
                initialFilter === tab.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}>{tab.count}</span>
            )}
          </Link>
        ))}
      </nav>

      {error && <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="rounded-full bg-muted p-4">
              {initialFilter === 'nao_lidas'
                ? <BellOff className="size-8 text-muted-foreground/50" />
                : <Bell className="size-8 text-muted-foreground/50" />}
            </div>
            <p className="font-semibold text-foreground">
              {initialFilter === 'nao_lidas' ? 'Nenhuma notificação não lida' : 'Nenhuma notificação'}
            </p>
            <p className="text-sm text-muted-foreground">
              {initialFilter === 'nao_lidas'
                ? 'Você está em dia com todas as suas notificações.'
                : 'Suas notificações aparecerão aqui quando houver atualizações.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" aria-live="polite">
          {items.map((item) => {
            const config = TYPE_CONFIG[item.tipo] ?? TYPE_CONFIG.info
            const TypeIcon = config.icon
            return (
              <Card key={item.id} className={cn(!item.lida && 'border-primary/20 bg-primary/[0.02] dark:bg-primary/[0.04]')}>
                <CardContent className="py-4">
                  <div className="flex items-start gap-3">
                    <div className={cn('shrink-0 rounded-lg p-2', config.bgClass)}>
                      <TypeIcon className={cn('size-[18px]', config.iconClass)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <p className={cn('text-sm leading-snug', !item.lida ? 'font-semibold' : 'font-medium text-foreground/80')}>
                          {item.titulo}
                          {!item.lida && <span className="ml-2 inline-block size-2 rounded-full bg-primary align-middle" />}
                        </p>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatAbsoluto(item.createdAt)}</span>
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">{item.mensagem}</p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <Badge className={cn('gap-1 border-transparent', config.badgeClass)}>
                          <TypeIcon className="size-2.5" />{config.label}
                        </Badge>
                        <div className="flex items-center gap-2">
                          {item.href && <Button render={<Link href={item.href} />} variant="outline" size="sm" className="h-7 px-2.5 text-xs">Abrir detalhe</Button>}
                          {!item.lida && (
                            <Button variant="ghost" size="sm" onClick={() => markOne(item)} disabled={markingId === item.id} className="h-7 gap-1.5 px-2.5 text-xs">
                              <Check className="size-3" />{markingId === item.id ? 'Marcando...' : 'Marcar como lida'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <LoadMoreButton
        className="pt-4"
        hasMore={Boolean(nextCursor)}
        loading={isPending}
        onLoadMore={loadMore}
        error={error}
      />
    </div>
  )
}
