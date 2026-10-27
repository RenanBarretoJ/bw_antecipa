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
    return <Skeleton aria-label="Carregando situação fiscal" className="h-32 w-full rounded-xl" />
  }

  const severity = situation?.severity ?? 'NEUTRO'
  const view = severityView[severity]
  const Icon = view.icon
  const capabilityUnavailable = !situation || situation.capabilityState !== 'ENABLED'

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
            <p className="text-[11px] font-medium uppercase tracking-wide text-current/65">Estado</p>
            <p className="mt-0.5 font-medium">{situation?.status.replaceAll('_', ' ') ?? 'SEM HISTÓRICO'}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-current/65">Observado em</p>
            <p className="mt-0.5 flex items-center gap-1 font-medium tabular-nums">
              <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
              {formatTimestamp(situation?.checkedAt ?? null)}
            </p>
          </div>
        </div>

        <p className="text-sm leading-5">
          {situation?.summary ?? 'Esta nota não possui consulta fiscal S1. Não há afirmação de regularidade.'}
        </p>

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

        <p className="border-t border-current/10 pt-3 text-xs leading-4 text-current/75">
          {situation?.eventCoverage === 'PARTIAL'
            ? 'Cobertura de eventos parcial: a ausência de evento no retorno não comprova inexistência de eventos fiscais.'
            : 'Histórico de eventos não comprovado para esta modalidade de consulta.'}
        </p>

        {(feedback || !capabilityUnavailable) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-xs text-current/75">{feedback}</p>
            {!capabilityUnavailable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={refreshing}
                onClick={requestRefresh}
              >
                <RefreshCw aria-hidden="true" className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Solicitando…' : 'Atualizar situação'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
