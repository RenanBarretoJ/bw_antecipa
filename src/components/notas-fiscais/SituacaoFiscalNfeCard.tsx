'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Clock3, RefreshCw, ShieldQuestion } from 'lucide-react'
import { obterSituacaoFiscalNfe, solicitarAtualizacaoSituacaoFiscalNfe } from '@/lib/actions/situacao-fiscal-nfe'
import type { FiscalSeverity, FiscalSituationView } from '@/lib/serpro-nfe/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const severityView: Record<FiscalSeverity, {
  label: string
  icon: typeof ShieldQuestion
  className: string
}> = {
  NEUTRO: {
    label: 'Sem conclusão',
    icon: ShieldQuestion,
    className: 'border-border bg-muted text-muted-foreground',
  },
  VERDE: {
    label: 'Conferida na cobertura disponível',
    icon: CheckCircle2,
    className: 'border-success/30 bg-success/10 text-success-foreground',
  },
  AMARELO: {
    label: 'Requer análise',
    icon: AlertTriangle,
    className: 'border-warning/40 bg-warning/10 text-warning-foreground',
  },
  VERMELHO: {
    label: 'Impedimento fiscal identificado',
    icon: Ban,
    className: 'border-destructive/30 bg-destructive/10 text-destructive',
  },
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

export function SituacaoFiscalNfeCard({ notaFiscalId }: { notaFiscalId: string }) {
  const [situation, setSituation] = useState<FiscalSituationView | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [feedback, setFeedback] = useState('')

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

  const requestRefresh = async () => {
    setRefreshing(true)
    const result = await solicitarAtualizacaoSituacaoFiscalNfe(notaFiscalId)
    setFeedback(result.message)
    if (result.success) await load()
    setRefreshing(false)
  }

  if (loading) {
    return <Skeleton aria-label="Carregando situação fiscal" className="h-44 w-full rounded-xl" />
  }

  const severity = situation?.severity ?? 'NEUTRO'
  const view = severityView[severity]
  const Icon = view.icon
  const capabilityUnavailable = !situation || situation.capabilityState !== 'ENABLED'

  return (
    <Card aria-labelledby="situacao-fiscal-title" className={view.className}>
      <CardHeader className="border-b border-current/10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle id="situacao-fiscal-title" className="flex items-center gap-2">
              <Icon aria-hidden="true" className="size-5 shrink-0" />
              Situação fiscal da NF-e
            </CardTitle>
            <CardDescription className="mt-1 text-current/75">
              Fonte: SERPRO / consulta fiscal de NF-e
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-current/30 bg-background/70 text-current">
            {view.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-current/65">Estado da consulta</p>
            <p className="mt-1 font-medium">{situation?.status.replaceAll('_', ' ') ?? 'SEM HISTÓRICO'}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-current/65">Observado em</p>
            <p className="mt-1 flex items-center gap-1.5 font-medium tabular-nums">
              <Clock3 aria-hidden="true" className="size-4" />
              {formatTimestamp(situation?.checkedAt ?? null)}
            </p>
          </div>
        </div>

        <p className="leading-relaxed">
          {situation?.summary ?? 'Esta nota não possui consulta fiscal S1. Não há afirmação de regularidade.'}
        </p>

        {!!situation?.differences.length && (
          <div>
            <p className="font-medium">Divergências identificadas</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {situation.differences.map(item => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}

        {!!situation?.events.length && (
          <details className="rounded-lg border border-current/20 bg-background/55 p-3">
            <summary className="cursor-pointer font-medium">Eventos fiscais ({situation.events.length})</summary>
            <ol className="mt-3 space-y-3">
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

        <div className="rounded-lg border border-current/20 bg-background/55 p-3 text-xs leading-relaxed">
          {situation?.eventCoverage === 'PARTIAL'
            ? 'Cobertura de eventos parcial: a ausência de evento no retorno não comprova inexistência de eventos fiscais.'
            : 'Histórico de eventos não comprovado para esta modalidade de consulta.'}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className="min-h-5 text-xs text-current/75">{feedback}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing || capabilityUnavailable}
            onClick={requestRefresh}
            title={capabilityUnavailable ? 'Capacidade contratual ainda não validada' : undefined}
          >
            <RefreshCw aria-hidden="true" className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Solicitando…' : 'Atualizar situação'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
