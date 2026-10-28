'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Clock3, RefreshCw, ShieldQuestion } from 'lucide-react'
import { obterSituacaoFiscalNfe, solicitarAtualizacaoSituacaoFiscalNfe } from '@/lib/actions/situacao-fiscal-nfe'
import type { FiscalExecutionStatus, FiscalSeverity, FiscalSituationView } from '@/lib/serpro-nfe/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const severityView: Record<FiscalSeverity, {
  label: string
  icon: typeof ShieldQuestion
  className: string
}> = {
  NEUTRO: { label: 'Sem conclusão', icon: ShieldQuestion, className: 'border-border bg-muted text-muted-foreground' },
  VERDE: { label: 'Conferida na cobertura disponível', icon: CheckCircle2, className: 'border-success/30 bg-success/10 text-success-foreground' },
  AMARELO: { label: 'Requer análise', icon: AlertTriangle, className: 'border-warning/40 bg-warning/10 text-warning-foreground' },
  VERMELHO: { label: 'Impedimento fiscal identificado', icon: Ban, className: 'border-destructive/30 bg-destructive/10 text-destructive' },
}

const executionLabels: Record<FiscalExecutionStatus, string> = {
  BLOQUEADA_OFF: 'Provider desativado',
  SOLICITADA: 'Solicitada',
  EM_PROCESSAMENTO: 'Em processamento',
  CONCLUIDA: 'Concluída',
  FALHOU: 'Falhou',
  INDISPONIVEL: 'Indisponível',
}

function formatTimestamp(value: string | null) {
  if (!value) return 'Ainda não consultada'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date)
}

function formatEstimatedCost(value: number | string | null, currency: string) {
  if (value === null) return 'Estimativa indisponível'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 'Estimativa indisponível'
  return `Estimado ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(parsed)}`
}

export function SituacaoFiscalNfeCard({ notaFiscalId }: { notaFiscalId: string }) {
  const [situation, setSituation] = useState<FiscalSituationView | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [feedback, setFeedback] = useState('')
  const requestInFlight = useRef(false)

  const load = useCallback(async () => {
    const result = await obterSituacaoFiscalNfe(notaFiscalId)
    if (result.success) setSituation(result.situation)
    else setFeedback(result.message)
    setLoading(false)
  }, [notaFiscalId])

  useEffect(() => {
    let active = true
    void obterSituacaoFiscalNfe(notaFiscalId).then(result => {
      if (!active) return
      if (result.success) setSituation(result.situation)
      else setFeedback(result.message)
      setLoading(false)
    })
    return () => { active = false }
  }, [notaFiscalId])

  useEffect(() => {
    if (situation?.consumptionMode !== 'UNLIMITED_WITH_METERING'
      || !situation.history.some(item => ['SOLICITADA', 'EM_PROCESSAMENTO', 'INDISPONIVEL'].includes(item.status))) return
    let active = true
    const timer = setTimeout(async () => {
      try {
        const result = await obterSituacaoFiscalNfe(notaFiscalId)
        if (active && result.success) setSituation(result.situation)
      } catch {
        if (active) setFeedback('Não foi possível atualizar o acompanhamento. Recarregue a página.')
      }
    }, 5000)
    return () => { active = false; clearTimeout(timer) }
  }, [notaFiscalId, situation])

  const requestRefresh = async () => {
    if (requestInFlight.current) return
    requestInFlight.current = true
    setRefreshing(true)
    try {
      const result = await solicitarAtualizacaoSituacaoFiscalNfe(notaFiscalId, crypto.randomUUID())
      setFeedback(result.message)
      await load()
    } finally {
      requestInFlight.current = false
      setRefreshing(false)
    }
  }

  if (loading) {
    return <Skeleton aria-label="Carregando situação fiscal" className="h-32 w-full rounded-xl" />
  }

  const severity = situation?.severity ?? 'NEUTRO'
  const view = severityView[severity]
  const Icon = view.icon
  const canRequest = situation?.capabilityState === 'ENABLED'
    && situation.consumptionMode === 'UNLIMITED_WITH_METERING'
  const latestExecution = situation?.history[0]
  const hasActiveExecution = situation?.history.some(item => ['SOLICITADA', 'EM_PROCESSAMENTO', 'INDISPONIVEL'].includes(item.status)) ?? false

  return (
    <Card aria-labelledby="situacao-fiscal-title" className={view.className}>
      <CardHeader className="space-y-2 border-b border-current/10 p-4 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle id="situacao-fiscal-title" className="flex items-center gap-2 text-base">
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              Situação fiscal da NF-e
            </CardTitle>
            <CardDescription className="mt-0.5 text-xs text-current/75">
              Fonte: SERPRO · consulta fiscal de NF-e
            </CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 border-current/30 bg-background/70 text-current">
            {view.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-current/65">Estado fiscal</p>
            <p className="mt-0.5 font-medium">{situation?.status.replaceAll('_', ' ') ?? 'SEM HISTÓRICO'}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-current/65">Última observação</p>
            <p className="mt-0.5 flex items-center gap-1 font-medium tabular-nums">
              <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
              {formatTimestamp(situation?.checkedAt ?? null)}
            </p>
          </div>
        </div>

        {latestExecution && (
          <div className="rounded-md border border-current/15 bg-background/45 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{executionLabels[latestExecution.status]}</span>
              <span>{latestExecution.source === 'MANUAL_GESTOR' ? 'Manual' : 'Automática'} · {formatTimestamp(latestExecution.requestedAt)}</span>
            </div>
          </div>
        )}

        <p className="text-sm leading-5">
          {situation?.summary ?? 'Esta nota não possui consulta fiscal. Não há afirmação de regularidade.'}
        </p>
        {situation?.consumptionMode === 'OFF_ZERO_BUDGET' && (
          <p className="text-xs">SERPRO desativado. O último resultado, quando existente, permanece visível.</p>
        )}

        {!!situation?.differences.length && (
          <div className="text-sm">
            <p className="font-medium">Divergências identificadas</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {situation.differences.map(item => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}

        {!!situation?.events.length && (
          <details className="rounded-lg border border-current/20 bg-background/55 p-2.5 text-sm">
            <summary className="cursor-pointer font-medium">Eventos fiscais ({situation.events.length})</summary>
            <ol className="mt-2 space-y-2">
              {situation.events.map(event => (
                <li key={`${event.code}:${event.protocol ?? event.observedAt}`} className="border-l-2 border-current/25 pl-3">
                  <p className="font-medium">{event.description}</p>
                  <p className="text-xs text-current/70">
                    Código {event.code} · fato {formatTimestamp(event.occurredAt)} · observado {formatTimestamp(event.observedAt)}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        )}

        {!!situation?.history.length && (
          <details className="rounded-lg border border-current/20 bg-background/55 p-2.5 text-sm">
            <summary className="cursor-pointer font-medium">Histórico de consultas ({situation.history.length})</summary>
            <ol className="mt-2 space-y-2">
              {situation.history.map(item => (
                <li key={item.requestId} className="border-l-2 border-current/25 pl-3">
                  <p className="font-medium">{executionLabels[item.status]} · {item.source === 'MANUAL_GESTOR' ? 'Manual' : 'Automática'}</p>
                  <p className="text-xs text-current/70">
                    {formatTimestamp(item.requestedAt)} · {item.providerCallCount} GET autorizado(s) · {formatEstimatedCost(item.estimatedCost, item.costCurrency)}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        )}

        <div className="border-t border-current/10 pt-3 text-xs leading-4 text-current/75">
          <p>{situation?.eventCoverage === 'PARTIAL'
            ? 'Cobertura parcial: ausência de evento no retorno não comprova inexistência de eventos fiscais.'
            : 'Histórico de eventos não comprovado para esta modalidade de consulta.'}</p>
          {situation && (
            <p className="mt-1">
              Nesta NF: {situation.consumption.noteCalls} GET autorizado(s) · {formatEstimatedCost(situation.consumption.noteEstimatedCost, situation.consumption.currency)}.
              {' '}No Fundo: {situation.consumption.fundCalls} GET autorizado(s). Valores são estimativas, não fatura.
            </p>
          )}
        </div>

        {(feedback || canRequest) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-xs text-current/75">{feedback}</p>
            {canRequest && (
              <Button type="button" variant="outline" size="sm" disabled={refreshing || hasActiveExecution} onClick={requestRefresh}>
                <RefreshCw aria-hidden="true" className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Solicitando…' : hasActiveExecution ? 'Consulta em andamento' : 'Reconsultar SERPRO'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
