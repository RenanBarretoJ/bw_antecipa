'use client'

import { useMemo, useState, useTransition } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, FileText, History, Loader2, Send, ShieldCheck, Truck } from 'lucide-react'
import { carregarEventosHistorico, type HistoricoCursor } from '@/lib/actions/historico'
import { formatEventTime, groupHistoricoByDate, type HistoricoEventoView } from '@/lib/eventos-dominio/formatters'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type EntidadeHistorico = 'nota_fiscal' | 'operacao'
type FiltroHistorico = 'todos' | 'documento' | 'aprovacao' | 'operacao' | 'logistica'

type Props = {
  entidade: EntidadeHistorico
  entidadeId: string
  className?: string
}

const FILTERS: Array<{ value: FiltroHistorico; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'documento', label: 'Documentos' },
  { value: 'aprovacao', label: 'Aprovações' },
  { value: 'operacao', label: 'Operação' },
  { value: 'logistica', label: 'Logística' },
]

function renderCategoryIcon(categoria: HistoricoEventoView['categoria']) {
  if (categoria === 'documento') return <FileText className="size-4" />
  if (categoria === 'analise' || categoria === 'aprovacao') return <ShieldCheck className="size-4" />
  if (categoria === 'reprovacao') return <AlertCircle className="size-4" />
  if (categoria === 'desembolso' || categoria === 'operacao' || categoria === 'conclusao') return <CheckCircle2 className="size-4" />
  if (categoria === 'logistica') return <Truck className="size-4" />
  if (categoria === 'integracao') return <Send className="size-4" />
  return <Clock3 className="size-4" />
}

function toneForCategory(categoria: HistoricoEventoView['categoria']) {
  if (categoria === 'reprovacao') return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
  if (categoria === 'aprovacao' || categoria === 'conclusao') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
  if (categoria === 'logistica') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200'
  if (categoria === 'desembolso') return 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/60 dark:bg-purple-950/30 dark:text-purple-200'
  return 'border-border bg-muted text-muted-foreground'
}

function EventRow({ event }: { event: HistoricoEventoView }) {
  return (
    <div className="relative flex gap-3 py-3 pl-1">
      <div className="absolute bottom-0 left-[17px] top-9 w-px bg-border last:hidden" aria-hidden="true" />
      <span className={cn('relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border', toneForCategory(event.categoria))}>
        {renderCategoryIcon(event.categoria)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{event.descricao}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {event.atorNome} · {event.atorPerfil} · {formatEventTime(event.createdAt)}
            </p>
          </div>
          <Badge variant="outline" className="h-6 shrink-0 text-[11px] capitalize">
            {event.categoria}
          </Badge>
        </div>
        {event.metadataResumo.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {event.metadataResumo.map((item) => (
              <span key={item} className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                {item}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function HistoricoTimelineCard({ entidade, entidadeId, className }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [filtro, setFiltro] = useState<FiltroHistorico>('todos')
  const [eventos, setEventos] = useState<HistoricoEventoView[]>([])
  const [cursor, setCursor] = useState<HistoricoCursor | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [ultimoEvento, setUltimoEvento] = useState<HistoricoEventoView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function loadPage(reset = false, nextFilter = filtro, incluirTotal = false) {
    startTransition(async () => {
      setError(null)
      const result = await carregarEventosHistorico({
        entidade,
        entidadeId,
        filtro: nextFilter,
        cursor: reset ? null : cursor,
        limit: 20,
        incluirTotal,
      })
      if (!result.success) {
        setError(result.message ?? 'Não foi possível carregar o histórico.')
        return
      }
      setEventos((current) => {
        const incoming = result.data?.items ?? []
        if (reset) return incoming
        const ids = new Set(current.map((event) => event.id))
        return [...current, ...incoming.filter((event) => !ids.has(event.id))]
      })
      setCursor(result.data?.nextCursor ?? null)
      if (typeof result.data?.total === 'number') setTotal(result.data.total)
      if (reset) setUltimoEvento(result.data?.items[0] ?? null)
    })
  }

  function toggleExpanded() {
    const next = !expanded
    setExpanded(next)
    if (next && eventos.length === 0) {
      loadPage(true, filtro, total === null)
    }
  }

  function changeFilter(nextFilter: FiltroHistorico) {
    setFiltro(nextFilter)
    setEventos([])
    setCursor(null)
    if (expanded) loadPage(true, nextFilter)
  }

  const grupos = useMemo(() => groupHistoricoByDate(eventos), [eventos])

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-primary" />
            Histórico
            {total !== null && <Badge variant="secondary" className="h-5 text-[11px]">{total}</Badge>}
          </CardTitle>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {ultimoEvento
              ? `Último evento: ${ultimoEvento.descricao}`
              : total === 0
                ? 'Nenhum evento operacional registrado.'
                : 'Expanda para consultar o histórico operacional.'}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={toggleExpanded} aria-expanded={expanded}>
          {expanded ? 'Recolher' : 'Expandir'}
          <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
        </Button>
      </CardHeader>

      {expanded && (
        <CardContent className="p-0">
          <div className="flex flex-wrap gap-2 border-b px-4 py-3">
            {FILTERS.map((item) => (
              <Button
                key={item.value}
                type="button"
                size="xs"
                variant={filtro === item.value ? 'default' : 'outline'}
                onClick={() => changeFilter(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div className="max-h-[420px] overflow-y-auto px-4 py-2" aria-live="polite">
            {error && (
              <div className="my-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                {error}
              </div>
            )}
            {eventos.length === 0 && isPending && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Carregando histórico...
              </div>
            )}
            {eventos.length === 0 && !isPending && !error && (
              <div className="py-6 text-sm text-muted-foreground">Nenhum evento encontrado para este filtro.</div>
            )}
            {grupos.map((group) => (
              <section key={group.dateKey} className="py-2">
                <h4 className="sticky top-0 z-20 -mx-4 border-b bg-card px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {group.label}
                </h4>
                <div className="divide-y divide-border/60">
                  {group.events.map((event) => <EventRow key={event.id} event={event} />)}
                </div>
              </section>
            ))}
            {cursor && (
              <div className="flex justify-center border-t py-3">
                <Button type="button" variant="outline" size="sm" onClick={() => loadPage(false)} disabled={isPending}>
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  Carregar mais
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
