'use client'

import { ArrowDown, ArrowRight, GitBranch, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type {
  AcaoEsteiraFinanceiraId,
  EtapaEsteiraFinanceira,
  StatusEtapaEsteiraFinanceira,
  StatusEsteiraFinanceira,
} from '@/lib/financeiro/conciliacao/pipeline-status.server'

const STATUS_LABELS: Record<StatusEtapaEsteiraFinanceira, string> = {
  PRONTA: 'Pronta',
  EXECUTADA: 'Executada',
  EXECUTADA_SEM_MOVIMENTO: 'Executada — sem movimento',
  BLOQUEADA: 'Bloqueada',
  PENDENTE: 'Pendente',
  ERRO: 'Erro',
  NAO_APLICAVEL: 'Não aplicável',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
}

function formatDateTime(value: string | null) {
  if (!value) return 'Horário não informado'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function statusClass(status: StatusEtapaEsteiraFinanceira) {
  return cn(
    'inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium',
    ['PRONTA', 'EXECUTADA', 'EXECUTADA_SEM_MOVIMENTO'].includes(status) && 'bg-success/15 text-success-foreground',
    ['BLOQUEADA', 'PENDENTE'].includes(status) && 'bg-warning/20 text-warning-foreground',
    status === 'ERRO' && 'bg-destructive/10 text-destructive',
    status === 'NAO_APLICAVEL' && 'bg-muted text-muted-foreground',
  )
}

function StageCard({
  stage,
  pending,
  onAction,
}: {
  stage: EtapaEsteiraFinanceira
  pending: boolean
  onAction: (action: AcaoEsteiraFinanceiraId) => void
}) {
  const reasonId = `pipeline-stage-${stage.id}-reason`
  return (
    <article
      aria-labelledby={`pipeline-stage-${stage.id}`}
      className={cn(
        'flex min-h-52 min-w-0 flex-col rounded-xl border bg-card p-4',
        stage.status === 'ERRO' && 'border-destructive/35',
        stage.status === 'BLOQUEADA' && 'border-warning/35',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`pipeline-stage-${stage.id}`} className="font-semibold">{stage.titulo}</h3>
        <span className={statusClass(stage.status)}>{STATUS_LABELS[stage.status]}</span>
      </div>
      <dl className="mt-3 grid gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Data-base</dt>
          <dd className="font-medium tabular-nums">{formatDate(stage.dataReferencia)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Última execução</dt>
          <dd className="font-medium">
            {stage.ultimaExecucao
              ? <>{formatDateTime(stage.ultimaExecucao.executadaEm)}{stage.ultimaExecucao.historica && <span className="block font-normal text-muted-foreground">Histórico de {formatDate(stage.ultimaExecucao.dataReferencia)} — não usado na data atual</span>}</>
              : 'Nenhuma execução registrada'}
          </dd>
        </div>
      </dl>
      <p id={reasonId} className="mt-3 text-xs leading-relaxed text-muted-foreground">{stage.motivo}</p>
      {stage.acao && (
        <Button
          className="mt-auto w-full"
          variant={stage.acao.habilitada ? 'outline' : 'secondary'}
          disabled={pending || !stage.acao.habilitada}
          aria-describedby={reasonId}
          onClick={() => onAction(stage.acao!.id)}
        >
          <RefreshCw data-icon="inline-start" />
          {stage.acao.label}
        </Button>
      )}
    </article>
  )
}

function Connector() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center text-muted-foreground">
      <ArrowDown className="size-4 xl:hidden" />
      <ArrowRight className="hidden size-4 xl:block" />
    </div>
  )
}

export function PipelineCockpit({
  pipeline,
  pending,
  onAction,
}: {
  pipeline: StatusEsteiraFinanceira
  pending: boolean
  onAction: (action: AcaoEsteiraFinanceiraId) => void
}) {
  const byId = new Map(pipeline.etapas.map((stage) => [stage.id, stage]))
  const base = byId.get('bases')!
  const mainBranch = (['matching', 'logistica', 'exposicao', 'risco'] as const).map((id) => byId.get(id)!)
  const reconciliation = byId.get('conciliacao')!

  return (
    <Card aria-labelledby="pipeline-title">
      <CardHeader className="border-b">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle id="pipeline-title">Fluxo operacional da data</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Grafo operacional do fundo para {formatDate(pipeline.dataOperacional)}. A Conciliação Financeira é um ramo independente da cadeia logística.</p>
          </div>
          {pipeline.fundoVirgem && <span className="w-fit rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">Fundo sem histórico</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p role="status" aria-live="polite" className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-medium">
          {pipeline.proximaAcao.mensagem}
        </p>

        <StageCard stage={base} pending={pending} onAction={onAction} />

        <div className="flex items-center gap-2 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <GitBranch className="size-4" aria-hidden="true" />
          Duas rotas derivadas das bases financeiras
        </div>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)]">
          <section aria-labelledby="pipeline-main-branch" className="min-w-0 rounded-xl bg-muted/25 p-3">
            <h3 id="pipeline-main-branch" className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cadeia logística e risco</h3>
            <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:items-stretch">
              {mainBranch.map((stage, index) => (
                <div key={stage.id} className="contents">
                  {index > 0 && <Connector />}
                  <div className="min-w-0 flex-1"><StageCard stage={stage} pending={pending} onAction={onAction} /></div>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="pipeline-independent-branch" className="min-w-0 rounded-xl bg-muted/25 p-3">
            <h3 id="pipeline-independent-branch" className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ramo independente</h3>
            <StageCard stage={reconciliation} pending={pending} onAction={onAction} />
            <p className="mt-2 text-xs text-muted-foreground">A Conciliação não é pré-requisito para calcular a Exposição em Trânsito.</p>
          </section>
        </div>

        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Ao atualizar o Gate de Risco, a cadeia canônica de Matching, Conciliação, Logística e Exposição é reprocessada.
        </p>
      </CardContent>
    </Card>
  )
}
