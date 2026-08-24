'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Calculator, GitCompareArrows, Link2, Play, Search, ShieldCheck, Truck, Unlink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useNotifications } from '@/components/notifications/notification-provider'
import {
  confirmarMatchManualAction,
  executarConciliacaoAction,
  executarMatchingAction,
  executarPosicaoLogisticaAction,
  executarExposicaoAction,
  executarGateRiscoAction,
  decidirRevisaoRiscoAction,
  pesquisarNotasParaMatchingAction,
  revogarMatchManualAction,
  simularExposicaoAction,
} from '@/lib/actions/conciliacao'
import { cn } from '@/lib/utils'
import type { ConciliacaoDashboard, ConciliacaoTab, MatchingViewRow } from '@/lib/financeiro/conciliacao/loaders.server'
import { RISK_REASON_CODES } from '@/lib/financeiro/risco/types'

const tabs: Array<{ id: ConciliacaoTab; label: string }> = [
  { id: 'visao-geral', label: 'Visao geral' },
  { id: 'matching', label: 'Matching' },
  { id: 'conciliacao', label: 'Conciliacao' },
  { id: 'logistica', label: 'Logistica' },
  { id: 'exposicao', label: 'Exposicao' },
  { id: 'risco', label: 'Risco' },
  { id: 'excecoes', label: 'Excecoes' },
]

type NoteOption = {
  id: string
  numero_nf?: string
  razao_social_emitente?: string
  cnpj_emitente?: string
  razao_social_destinatario?: string
  cnpj_destinatario?: string
  data_vencimento?: string
  valor_bruto?: string | number
}

function money(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 'Indisponivel'
  const numeric = Number(value)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numeric)
}

function date(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
}

function badge(status: string) {
  const ok = ['MATCH_FORTE', 'MANTIDO_CORRETO', 'ENTRADA_INCORPORADA', 'SAIDA_REFLETIDA', 'CONCLUIDA', 'APTO', 'LIBERADA', 'INFORMATIVO'].includes(status)
  const warning = ['AMBIGUO', 'BASE_INCOMPLETA', 'PROCESSANDO', 'EM_TRANSITO', 'INDETERMINADA', 'REVISAO_MANUAL', 'PENDENTE', 'REVISAO', 'NAO_APLICAVEL'].includes(status)
  const logisticsOk = status === 'ENTREGUE'
  return cn(
    'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
    (ok || logisticsOk) && 'bg-success/15 text-success-foreground',
    warning && 'bg-warning/20 text-warning-foreground',
    !ok && !logisticsOk && !warning && 'bg-destructive/10 text-destructive',
  )
}

function currentQuery(dashboard: ConciliacaoDashboard, tab: ConciliacaoTab) {
  const params = new URLSearchParams()
  params.set('tab', tab)
  if (dashboard.filtros.dataReferencia) params.set('data', dashboard.filtros.dataReferencia)
  return `/gestor/conciliacao?${params.toString()}`
}

function SummaryCard({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  return (
    <Card size="sm" className={cn(
      tone === 'success' && 'bg-success/5 ring-success/20',
      tone === 'warning' && 'bg-warning/10 ring-warning/25',
      tone === 'danger' && 'bg-destructive/5 ring-destructive/20',
    )}>
      <CardContent>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

function BlockError({ message }: { message: string }) {
  return <div role="status" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{message}</div>
}

function baseValue(base: NonNullable<ConciliacaoDashboard['baseFinanceira']>['estoque']) {
  if (base.estado === 'SEM_MOVIMENTO') return 'Sem movimento'
  if (base.estado === 'INDISPONIVEL') return 'Indisponivel'
  if (base.estado === 'DISPONIVEL') return 'Disponivel'
  return money(base.valor)
}

function sourceLabel(base: NonNullable<ConciliacaoDashboard['baseFinanceira']>['estoque']) {
  if (!base.importacaoId) return 'Sem base publicada'
  return `${base.origemQa ? 'QA SYNTHETIC' : base.origem || 'Origem nao informada'} · ${base.provedor || 'Provedor nao informado'}`
}

function BaseFinanceiraCard({ dashboard }: { dashboard: ConciliacaoDashboard }) {
  const base = dashboard.baseFinanceira
  if (!base) return <BlockError message="Selecione uma data operacional para resolver as bases financeiras." />
  const items = [
    ['Estoque D-1', base.estoque],
    ['Aquisicoes D-1', base.aquisicoes],
    ['Liquidacoes D-1', base.liquidacoes],
    ['PL da carteira D-2', base.carteira],
  ] as const
  const statusLabel = base.statusGeral === 'PRONTA' ? 'Pronta para calculo' : base.statusGeral === 'BASE_INCOMPLETA' ? 'Base incompleta' : base.statusGeral === 'SEM_MOVIMENTO' ? 'Sem movimento' : 'Indisponivel'
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><CardTitle>Base financeira da data</CardTitle><p className="mt-1 text-sm text-muted-foreground">Data operacional {date(base.dataOperacional)} · D-1 {date(base.dataD1)} · D-2 {date(base.dataD2)}</p></div>
          <span className={badge(base.statusGeral)}>{statusLabel}</span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map(([label, item]) => <div key={label} className="rounded-lg border bg-muted/20 p-3"><p className="text-xs font-medium uppercase text-muted-foreground">{label} · esperado em {date(item.dataEsperada)}</p><p className="mt-1 font-semibold tabular-nums">{baseValue(item)}</p><p className="mt-1 truncate text-xs text-muted-foreground" title={sourceLabel(item)}>{sourceLabel(item)}</p></div>)}
        {dashboard.erros.base && <div className="sm:col-span-2 xl:col-span-4"><BlockError message={dashboard.erros.base} /></div>}
      </CardContent>
    </Card>
  )
}

function PreviousExecution({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">Sem execucao atual. Ultima {label} anterior: {date(value)}. Ela nao foi usada como resultado da data selecionada.</p>
}

export function ConciliacaoFinanceiraClient({ dashboard }: { dashboard: ConciliacaoDashboard }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [pending, startTransition] = useTransition()
  const [manualRow, setManualRow] = useState<MatchingViewRow | null>(null)
  const [revokeRow, setRevokeRow] = useState<MatchingViewRow | null>(null)
  const [notes, setNotes] = useState<NoteOption[]>([])
  const [selectedNoteId, setSelectedNoteId] = useState('')
  const [query, setQuery] = useState('')
  const [reason, setReason] = useState('')
  const [totp, setTotp] = useState('')
  const [simulationOperationId, setSimulationOperationId] = useState('')
  const [simulation, setSimulation] = useState<Record<string, unknown> | null>(null)
  const [riskReview, setRiskReview] = useState<ConciliacaoDashboard['risco']['rows'][number] | null>(null)
  const [riskDecision, setRiskDecision] = useState<'LIBERADA' | 'RECUSADA'>('LIBERADA')
  const [riskJustification, setRiskJustification] = useState('')
  const [riskTotp, setRiskTotp] = useState('')

  const matchingCoverage = dashboard.matchingExecucao?.total_registros
    ? Math.round((dashboard.matchingExecucao.matched / dashboard.matchingExecucao.total_registros) * 100)
    : null
  const reconCounts = dashboard.conciliacaoExecucao?.contagens || {}
  const correct = Number(reconCounts.MANTIDO_CORRETO || 0) + Number(reconCounts.ENTRADA_INCORPORADA || 0) + Number(reconCounts.SAIDA_REFLETIDA || 0)
  const divergences = Object.entries(reconCounts)
    .filter(([status]) => !['MANTIDO_CORRETO', 'ENTRADA_INCORPORADA', 'SAIDA_REFLETIDA'].includes(status))
    .reduce((sum, [, count]) => sum + Number(count || 0), 0)
  const baseIds = dashboard.conciliacaoExecucao
    ? [
        dashboard.conciliacaoExecucao.estoque_d2_importacao_id,
        dashboard.conciliacaoExecucao.estoque_d1_importacao_id,
        dashboard.conciliacaoExecucao.aquisicoes_d1_importacao_id,
        dashboard.conciliacaoExecucao.liquidacoes_d1_importacao_id,
      ].filter(Boolean)
    : dashboard.matchingExecucao?.input_import_ids || []
  const noExceptions = dashboard.filtros.tab === 'excecoes'
    && !dashboard.erros.matching && !dashboard.erros.conciliacao && !dashboard.erros.logistica
    && dashboard.matching.total === 0 && dashboard.conciliacao.total === 0 && dashboard.logistica.total === 0

  const initialCandidates = useMemo(() => manualRow?.candidatos
    .map((candidate) => candidate.notaFiscal as NoteOption | null)
    .filter((item): item is NoteOption => Boolean(item)) || [], [manualRow])

  function run(action: () => Promise<{ success: boolean; notification: { type: 'success' | 'error' | 'warning' | 'info'; message: string; details?: string } }>, close?: () => void) {
    startTransition(async () => {
      const result = await action()
      notifications.notify(result.notification)
      if (result.success) {
        close?.()
        router.refresh()
      }
    })
  }

  function openManual(row: MatchingViewRow) {
    setManualRow(row)
    setNotes([])
    setSelectedNoteId(row.candidatos[0]?.nota_fiscal_id || '')
    setReason('')
    setTotp('')
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Fundo ativo · {dashboard.fundo.nome}</p>
          <h1 className="mt-1 text-2xl font-bold">Conciliacao</h1>
          <p className="text-muted-foreground">Matching auditavel entre titulos financeiros e NFs, seguido da reconciliacao temporal das bases publicadas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending || !dashboard.baseFinanceira?.dataD1} onClick={() => run(() => executarMatchingAction({ dataReferencia: dashboard.baseFinanceira!.dataD1 }))}>
            <Play /> Executar matching
          </Button>
          <Button disabled={pending || !dashboard.baseFinanceira?.dataD1} onClick={() => run(() => executarConciliacaoAction({ dataReferencia: dashboard.baseFinanceira!.dataD1 }))}>
            <GitCompareArrows /> Executar conciliacao
          </Button>
          <Button variant="outline" disabled={pending || !dashboard.baseFinanceira?.dataD1} onClick={() => run(() => executarPosicaoLogisticaAction({ dataReferencia: dashboard.baseFinanceira!.dataD1 }))}>
            <Truck /> Atualizar logistica
          </Button>
          <Button variant="outline" disabled={pending || !dashboard.filtros.dataReferencia} onClick={() => run(() => executarExposicaoAction({ dataReferencia: dashboard.filtros.dataReferencia }))}>
            <Calculator /> Calcular exposicao
          </Button>
          <Button variant="outline" disabled={pending || !dashboard.filtros.dataReferencia} onClick={() => run(() => executarGateRiscoAction({ dataReferencia: dashboard.filtros.dataReferencia }))}>
            <ShieldCheck /> Atualizar risco
          </Button>
        </div>
      </header>

      <BaseFinanceiraCard dashboard={dashboard} />

      <nav className="flex flex-wrap gap-1 rounded-xl bg-muted p-1" aria-label="Secoes da conciliacao">
        {tabs.map((tab) => (
          <Link key={tab.id} href={currentQuery(dashboard, tab.id)} className={cn('rounded-lg px-3 py-2 text-sm font-medium', dashboard.filtros.tab === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {tab.label}
          </Link>
        ))}
      </nav>

      <Card>
        <CardContent>
          <form method="get" className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_180px_180px_180px_auto]">
            <input type="hidden" name="tab" value={dashboard.filtros.tab} />
            <label className="relative min-w-0">
              <span className="sr-only">Buscar</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={dashboard.filtros.q} placeholder="Titulo, cedente, sacado, NF ou chave" className="pl-9" />
            </label>
            <select name="data" defaultValue={dashboard.filtros.dataReferencia} className="h-8 rounded-lg border border-input bg-background px-2 text-sm">
              {!dashboard.filtros.dataReferencia && <option value="">Data de referencia</option>}
              {dashboard.datasDisponiveis.map((item) => <option key={item} value={item}>{date(item)}</option>)}
            </select>
            <select name="status" defaultValue={dashboard.filtros.status} className="h-8 rounded-lg border border-input bg-background px-2 text-sm">
              <option value="">Todos os status</option>
              {['MATCH_FORTE', 'AMBIGUO', 'NAO_CONCILIADO', 'CONFLITO', 'MANTIDO_CORRETO', 'ENTRADA_INCORPORADA', 'ENTRADA_NAO_INCORPORADA', 'SAIDA_REFLETIDA', 'SAIDA_SEM_LIQUIDACAO', 'LIQUIDADO_AINDA_NO_ESTOQUE', 'DIVERGENCIA_VALOR', 'ENTREGUE', 'EM_TRANSITO', 'INDETERMINADA', 'SEM_MATCH_FINANCEIRO_NF', 'INCLUIDA_EM_TRANSITO', 'JA_INCORPORADO_ESTOQUE', 'OPERACAO_NAO_INCORPORADA', 'VALOR_AUSENTE', 'APTO', 'REVISAO_MANUAL', 'BLOQUEADO', 'NAO_APLICAVEL', 'AVALIACAO_RISCO_INDISPONIVEL'].map((item) => <option key={item}>{item}</option>)}
            </select>
            <select name="metodo" defaultValue={dashboard.filtros.metodo} className="h-8 rounded-lg border border-input bg-background px-2 text-sm">
              <option value="">Todos os metodos</option>
              {['CHAVE_NFE', 'SEU_NUMERO', 'COMPOSTO', 'ID_RECEBIVEL', 'AMBIGUO', 'NAO_CONCILIADO', 'CONFLITO'].map((item) => <option key={item}>{item}</option>)}
            </select>
            <div className="flex gap-2">
              <Button type="submit">Aplicar</Button>
              <Button render={<Link href={currentQuery(dashboard, dashboard.filtros.tab)} />} nativeButton={false} variant="outline">Limpar</Button>
            </div>
          </form>
          {dashboard.filtros.tab === 'logistica' && (
            <form method="get" className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2 xl:grid-cols-4">
              <input type="hidden" name="tab" value="logistica" />
              <input type="hidden" name="data" value={dashboard.filtros.dataReferencia} />
              <input type="hidden" name="q" value={dashboard.filtros.q} />
              <input type="hidden" name="status" value={dashboard.filtros.status} />
              <input type="hidden" name="metodo" value={dashboard.filtros.metodo} />
              <Input name="cedente" defaultValue={dashboard.filtros.cedente} placeholder="Cedente" />
              <Input name="sacado" defaultValue={dashboard.filtros.sacado} placeholder="Sacado" />
              <Input name="seuNumero" defaultValue={dashboard.filtros.seuNumero} placeholder="Seu numero" />
              <Input name="idRecebivel" defaultValue={dashboard.filtros.idRecebivel} placeholder="ID recebivel" />
              <Input name="nf" defaultValue={dashboard.filtros.notaFiscal} placeholder="UUID da NF" />
              <Input name="vencimentoDe" type="date" defaultValue={dashboard.filtros.vencimentoDe} aria-label="Vencimento inicial" />
              <Input name="vencimentoAte" type="date" defaultValue={dashboard.filtros.vencimentoAte} aria-label="Vencimento final" />
              <Button type="submit" variant="outline">Aplicar filtros logisticos</Button>
            </form>
          )}
          {dashboard.filtros.tab === 'risco' && (
            <form method="get" className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2 xl:grid-cols-3">
              <input type="hidden" name="tab" value="risco" />
              <input type="hidden" name="data" value={dashboard.filtros.dataReferencia} />
              <input type="hidden" name="q" value={dashboard.filtros.q} />
              <input type="hidden" name="status" value={dashboard.filtros.status} />
              <select name="motivo" defaultValue={dashboard.filtros.riskReason} className="h-8 rounded-lg border border-input bg-background px-2 text-sm" aria-label="Motivo de risco">
                <option value="">Todos os motivos</option>
                {RISK_REASON_CODES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <Input name="operacao" defaultValue={dashboard.filtros.riskOperation} placeholder="UUID da operacao" />
              <Input name="cedente" defaultValue={dashboard.filtros.cedente} placeholder="Cedente ou CNPJ" />
              <Input name="politica" defaultValue={dashboard.filtros.riskPolicy} placeholder="UUID da politica publicada" />
              <Input name="dataDe" type="date" defaultValue={dashboard.filtros.riskCreatedFrom} aria-label="Avaliacao criada a partir de" />
              <Input name="dataAte" type="date" defaultValue={dashboard.filtros.riskCreatedTo} aria-label="Avaliacao criada ate" />
              <div className="flex gap-2 sm:col-span-2 xl:col-span-3">
                <Button type="submit" variant="outline">Aplicar filtros de risco</Button>
                <Button render={<Link href={currentQuery(dashboard, 'risco')} />} nativeButton={false} variant="outline">Limpar filtros de risco</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {dashboard.filtros.tab === 'visao-geral' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Cobertura do matching" value={matchingCoverage === null ? 'Sem execucao' : `${matchingCoverage}%`} tone={matchingCoverage === null ? 'default' : matchingCoverage >= 90 ? 'success' : 'warning'} />
            <SummaryCard label="Conciliacoes corretas" value={dashboard.conciliacaoExecucao ? correct : 'Sem execucao'} tone={dashboard.conciliacaoExecucao ? 'success' : 'default'} />
            <SummaryCard label="Divergencias" value={dashboard.conciliacaoExecucao ? divergences : 'Sem execucao'} tone={dashboard.conciliacaoExecucao && divergences ? 'danger' : dashboard.conciliacaoExecucao ? 'success' : 'default'} />
            <SummaryCard label="Ambiguos / nao conciliados" value={dashboard.matchingExecucao ? dashboard.matchingExecucao.ambiguos + dashboard.matchingExecucao.nao_conciliados : 'Sem execucao'} tone={dashboard.matchingExecucao ? 'warning' : 'default'} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Execucao de matching</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Data</span><p className="font-medium">{date(dashboard.matchingExecucao?.data_referencia)}</p></div>
                <div><span className="text-muted-foreground">Status</span><p><span className={badge(dashboard.matchingExecucao?.status || 'SEM_EXECUCAO')}>{dashboard.matchingExecucao?.status || 'Sem execucao'}</span></p></div>
                <div><span className="text-muted-foreground">Regra</span><p className="font-medium">{dashboard.matchingExecucao?.regra_versao || '—'}</p></div>
                <div><span className="text-muted-foreground">Titulos</span><p className="font-medium tabular-nums">{dashboard.matchingExecucao?.total_registros ?? 'Sem execucao'}</p></div>
                <div className="col-span-2"><PreviousExecution label="execucao de matching" value={dashboard.execucoesAnteriores.matching?.data_referencia} /></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Execucao de conciliacao</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Data</span><p className="font-medium">{date(dashboard.conciliacaoExecucao?.data_referencia)}</p></div>
                <div><span className="text-muted-foreground">Status</span><p><span className={badge(dashboard.conciliacaoExecucao?.status || 'SEM_EXECUCAO')}>{dashboard.conciliacaoExecucao?.status || 'Sem execucao'}</span></p></div>
                <div className="col-span-2"><span className="text-muted-foreground">Bases utilizadas</span><p className="break-all font-mono text-xs">{baseIds.length ? baseIds.join(' · ') : 'Nenhuma base resolvida'}</p></div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {noExceptions && <Card><CardContent className="py-10 text-center text-muted-foreground">Nenhuma excecao registrada para esta data.</CardContent></Card>}

      {!noExceptions && (dashboard.filtros.tab === 'matching' || dashboard.filtros.tab === 'excecoes') && (
        dashboard.erros.matching ? <BlockError message={dashboard.erros.matching} /> : <div className="space-y-3"><PreviousExecution label="execucao de matching" value={!dashboard.matchingExecucao ? dashboard.execucoesAnteriores.matching?.data_referencia : null} /><MatchingTable rows={dashboard.matching.rows} total={dashboard.matching.total} onManual={openManual} onRevoke={(row) => { setRevokeRow(row); setReason(''); setTotp('') }} /></div>
      )}
      {!noExceptions && (dashboard.filtros.tab === 'conciliacao' || dashboard.filtros.tab === 'excecoes') && (
        dashboard.erros.conciliacao ? <BlockError message={dashboard.erros.conciliacao} /> : <div className="space-y-3"><PreviousExecution label="execucao de conciliacao" value={!dashboard.conciliacaoExecucao ? dashboard.execucoesAnteriores.conciliacao?.data_referencia : null} /><ReconciliationTable rows={dashboard.conciliacao.rows} total={dashboard.conciliacao.total} /></div>
      )}
      {!noExceptions && (dashboard.filtros.tab === 'logistica' || dashboard.filtros.tab === 'excecoes') && (
        dashboard.erros.logistica ? <BlockError message={dashboard.erros.logistica} /> : <LogisticsView dashboard={dashboard} />
      )}
      {dashboard.filtros.tab === 'exposicao' && (
        dashboard.erros.exposicao ? <BlockError message={dashboard.erros.exposicao} /> : <ExposureView
          dashboard={dashboard}
          operationId={simulationOperationId}
          onOperationId={setSimulationOperationId}
          simulation={simulation}
          pending={pending}
          onSimulate={() => run(async () => {
            const result = await simularExposicaoAction({ operacaoId: simulationOperationId })
            if (result.success) setSimulation(result.data || null)
            return result
          })}
        />
      )}
      {dashboard.filtros.tab === 'risco' && (
        dashboard.erros.risco ? <BlockError message={dashboard.erros.risco} /> : <RiskView dashboard={dashboard} onReview={(row) => {
          setRiskReview(row)
          setRiskDecision('LIBERADA')
          setRiskJustification('')
          setRiskTotp('')
        }} />
      )}

      <Pagination dashboard={dashboard} total={dashboard.filtros.tab === 'risco' ? dashboard.risco.total : dashboard.filtros.tab === 'exposicao' ? dashboard.exposicao.total : dashboard.filtros.tab === 'logistica' ? dashboard.logistica.total : dashboard.filtros.tab === 'conciliacao' ? dashboard.conciliacao.total : dashboard.filtros.tab === 'matching' ? dashboard.matching.total : Math.max(dashboard.matching.total, dashboard.conciliacao.total, dashboard.logistica.total)} />

      <Dialog open={Boolean(manualRow)} onOpenChange={(open) => { if (!open) setManualRow(null) }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Associar titulo a uma NF</DialogTitle>
            <DialogDescription>A busca e a confirmacao permanecem limitadas ao fundo ativo. A associacao manual e auditada e exige TOTP fresco.</DialogDescription>
          </DialogHeader>
          {manualRow && (
            <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
              <div className="grid gap-3 rounded-lg bg-muted p-3 sm:grid-cols-3">
                <div><p className="text-xs text-muted-foreground">Titulo externo</p><p className="font-medium">{manualRow.identidade_externa}</p></div>
                <div><p className="text-xs text-muted-foreground">Cedente / sacado</p><p className="truncate font-medium" title={`${manualRow.cedente_nome || ''} · ${manualRow.sacado_nome || ''}`}>{manualRow.cedente_nome || '—'} · {manualRow.sacado_nome || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Valor / vencimento</p><p className="font-medium">{money(manualRow.valor_referencia)} · {date(manualRow.data_vencimento)}</p></div>
              </div>
              <div className="flex gap-2">
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar NF do fundo ativo" />
                <Button variant="outline" disabled={pending || query.trim().length < 2} onClick={() => run(async () => {
                  const result = await pesquisarNotasParaMatchingAction({ q: query })
                  if (result.success) setNotes((result.data?.notas || []) as NoteOption[])
                  return result
                })}><Search /> Pesquisar</Button>
              </div>
              <div className="space-y-2">
                {[...initialCandidates, ...notes].filter((note, index, all) => all.findIndex((item) => item.id === note.id) === index).map((note) => (
                  <label key={note.id} className={cn('grid cursor-pointer gap-2 rounded-lg border p-3 sm:grid-cols-[auto_1fr_auto]', selectedNoteId === note.id && 'border-primary bg-primary/5')}>
                    <input type="radio" name="notaFiscal" value={note.id} checked={selectedNoteId === note.id} onChange={() => setSelectedNoteId(note.id)} />
                    <span className="min-w-0"><span className="block truncate font-medium">NF {note.numero_nf || note.id.slice(0, 8)} · {note.razao_social_destinatario || 'Sacado nao informado'}</span><span className="block truncate text-xs text-muted-foreground">{note.cnpj_emitente || '—'} → {note.cnpj_destinatario || '—'}</span></span>
                    <span className="text-right text-sm font-medium">{money(note.valor_bruto)}<span className="block text-xs text-muted-foreground">{date(note.data_vencimento)}</span></span>
                  </label>
                ))}
              </div>
              <label className="block space-y-1"><span className="text-sm font-medium">Motivo</span><Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></label>
              <label className="block space-y-1"><span className="text-sm font-medium">Codigo TOTP</span><Input value={totp} onChange={(event) => setTotp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" /></label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualRow(null)}>Cancelar</Button>
            <Button disabled={pending || !manualRow || !selectedNoteId || reason.trim().length < 5 || totp.length !== 6} onClick={() => manualRow && run(() => confirmarMatchManualAction({ matchingResultadoId: manualRow.id, notaFiscalId: selectedNoteId, motivo: reason, codigoTotp: totp }), () => setManualRow(null))}>
              <Link2 /> Confirmar associacao
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(revokeRow)} onOpenChange={(open) => { if (!open) setRevokeRow(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Revogar associacao manual</DialogTitle><DialogDescription>O historico sera preservado e uma nova execucao podera recalcular o matching.</DialogDescription></DialogHeader>
          <label className="space-y-1"><span className="text-sm font-medium">Motivo</span><Input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Codigo TOTP</span><Input value={totp} onChange={(event) => setTotp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" /></label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeRow(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={pending || !revokeRow?.vinculo?.id || reason.trim().length < 5 || totp.length !== 6} onClick={() => revokeRow?.vinculo?.id && run(() => revogarMatchManualAction({ vinculoId: revokeRow.vinculo!.id, motivo: reason, codigoTotp: totp }), () => setRevokeRow(null))}><Unlink /> Revogar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(riskReview)} onOpenChange={(open) => { if (!open) setRiskReview(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Revisao manual de risco</DialogTitle><DialogDescription>A decisao exige justificativa, TOTP fresco e fica vinculada ao snapshot avaliado. Uma nova avaliacao expira esta liberacao.</DialogDescription></DialogHeader>
          {riskReview && <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
            <div><span className="text-muted-foreground">Operacao</span><p className="font-mono text-xs">{riskReview.operacao_id || 'Nao vinculada'}</p></div>
            <div><span className="text-muted-foreground">Decisao automatica</span><p className="font-medium">{riskReview.decisao || riskReview.status_tecnico}</p></div>
            <div><span className="text-muted-foreground">Exposicao projetada</span><p className="font-medium">{riskReview.exposicao_projetada_pct == null ? 'Indeterminada' : percentValue(riskReview.exposicao_projetada_pct)}</p></div>
            <div><span className="text-muted-foreground">Motivos</span><p className="font-medium">{riskReview.motivos.map((item) => item.codigo).join(', ') || 'Nenhum'}</p></div>
          </div>}
          <label className="space-y-1"><span className="text-sm font-medium">Decisao</span><select className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" value={riskDecision} onChange={(event) => setRiskDecision(event.target.value as 'LIBERADA' | 'RECUSADA')}><option value="LIBERADA">Liberar operacao</option><option value="RECUSADA">Recusar operacao</option></select></label>
          <label className="space-y-1"><span className="text-sm font-medium">Justificativa</span><Input value={riskJustification} onChange={(event) => setRiskJustification(event.target.value)} maxLength={1000} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Codigo TOTP</span><Input value={riskTotp} onChange={(event) => setRiskTotp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" /></label>
          <DialogFooter><Button variant="outline" onClick={() => setRiskReview(null)}>Cancelar</Button><Button disabled={pending || !riskReview?.revisao || riskJustification.trim().length < 5 || riskTotp.length !== 6} onClick={() => riskReview?.revisao && run(() => decidirRevisaoRiscoAction({ revisaoId: riskReview.revisao!.id, decisao: riskDecision, justificativa: riskJustification, codigoTotp: riskTotp }), () => setRiskReview(null))}>Confirmar decisao</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MatchingTable({ rows, total, onManual, onRevoke }: { rows: MatchingViewRow[]; total: number; onManual: (row: MatchingViewRow) => void; onRevoke: (row: MatchingViewRow) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle>Matching ({total})</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground"><tr><th className="py-2 pr-3">Titulo externo</th><th className="pr-3">Cedente</th><th className="pr-3">Sacado</th><th className="pr-3">Valor</th><th className="pr-3">Vencimento</th><th className="pr-3">Metodo</th><th className="pr-3">NF</th><th>Status</th><th className="text-right">Acoes</th></tr></thead>
          <tbody className="divide-y">
            {rows.map((row) => <tr key={row.id}><td className="max-w-48 truncate py-3 pr-3 font-mono text-xs" title={row.identidade_externa}>{row.identidade_externa}</td><td className="max-w-44 truncate pr-3" title={row.cedente_nome || ''}>{row.cedente_nome || '—'}</td><td className="max-w-44 truncate pr-3" title={row.sacado_nome || ''}>{row.sacado_nome || '—'}</td><td className="pr-3 tabular-nums">{money(row.valor_referencia)}</td><td className="pr-3">{date(row.data_vencimento)}</td><td className="pr-3">{row.metodo}</td><td className="pr-3">{row.nota_fiscal_id ? row.nota_fiscal_id.slice(0, 8) : '—'}</td><td><span className={badge(row.status)}>{row.status}</span></td><td className="space-x-1 text-right">{['AMBIGUO', 'NAO_CONCILIADO', 'CONFLITO'].includes(row.status) && <Button size="sm" variant="outline" onClick={() => onManual(row)}>Associar</Button>}{row.vinculo?.origem === 'MANUAL' && row.vinculo.status === 'ATIVO' && <Button size="sm" variant="destructive" onClick={() => onRevoke(row)}>Revogar</Button>}</td></tr>)}
          </tbody>
        </table>
        {!rows.length && <p className="py-10 text-center text-muted-foreground">Nenhum resultado de matching para os filtros informados.</p>}
      </CardContent>
    </Card>
  )
}

function ReconciliationTable({ rows, total }: { rows: ConciliacaoDashboard['conciliacao']['rows']; total: number }) {
  return (
    <Card>
      <CardHeader><CardTitle>Conciliacao D-2 → D-1 ({total})</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground"><tr><th className="py-2 pr-3">Titulo / NF</th><th className="pr-3">D-2</th><th className="pr-3">Aquisicoes</th><th className="pr-3">Liquidacoes</th><th className="pr-3">D-1</th><th>Resultado</th></tr></thead>
          <tbody className="divide-y">{rows.map((row) => <tr key={row.id}><td className="max-w-64 truncate py-3 pr-3 font-mono text-xs" title={row.identidade_externa}>{row.identidade_externa}{row.nota_fiscal_id ? ` · NF ${row.nota_fiscal_id.slice(0, 8)}` : ''}</td><td className="pr-3 tabular-nums">{row.presente_d2 ? money(row.valor_aquisicao_d2) : 'Ausente'}</td><td className="pr-3 tabular-nums">{row.aquisicoes_count} · {money(row.aquisicoes_valor)}</td><td className="pr-3 tabular-nums">{row.liquidacoes_count} · {money(row.liquidacoes_valor_pago)}</td><td className="pr-3 tabular-nums">{row.presente_d1 ? money(row.valor_aquisicao_d1) : 'Ausente'}</td><td><span className={badge(row.status)}>{row.status}</span></td></tr>)}</tbody>
        </table>
        {!rows.length && <p className="py-10 text-center text-muted-foreground">Nenhum resultado de conciliacao para os filtros informados.</p>}
      </CardContent>
    </Card>
  )
}

function LogisticsView({ dashboard }: { dashboard: ConciliacaoDashboard }) {
  const execution = dashboard.logisticaExecucao
  if (!execution) return <Card><CardHeader><CardTitle>Posicao logistica</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Nenhuma execucao logistica disponivel para D-1 {date(dashboard.baseFinanceira?.dataD1)}. Nenhuma contagem ou valor foi inferido.</p><PreviousExecution label="posicao logistica" value={dashboard.execucoesAnteriores.logistica?.data_referencia} /></CardContent></Card>
  const cards = [
    ['Posicao total', execution.total_posicoes, execution.valor_total_aquisicao],
    ['Matched', execution.posicoes_matched, execution.valor_matched],
    ['Sem match', execution.posicoes_sem_match, execution.valor_sem_match],
    ['Entregue', execution.posicoes_entregues, execution.valor_entregue],
    ['Em transito', execution.posicoes_em_transito, execution.valor_em_transito],
    ['Indeterminada', execution.posicoes_indeterminadas, execution.valor_indeterminado],
  ] as const
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {cards.map(([label, count, value]) => <Card size="sm" key={label}><CardContent><p className="text-xs uppercase text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{count}</p><p className="text-xs font-medium tabular-nums text-muted-foreground">{value === null || value === undefined ? 'Valor nao informado' : money(value)}</p></CardContent></Card>)}
    </div>
    <Card>
      <CardHeader><CardTitle>Posicao logistica ({dashboard.logistica.total})</CardTitle></CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-2 rounded-lg bg-muted p-3 text-sm sm:grid-cols-3"><div><span className="text-muted-foreground">Estoque</span><p className="font-mono text-xs">{execution.estoque_importacao_id ? execution.estoque_importacao_id.slice(0, 8) : 'Indisponivel'}</p></div><div><span className="text-muted-foreground">Logistica as-of</span><p>{execution.logistica_as_of ? new Date(execution.logistica_as_of).toLocaleString('pt-BR') : 'Indisponivel'}</p></div><div><span className="text-muted-foreground">Regra</span><p>{execution.regra_versao}</p></div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="border-b text-xs uppercase text-muted-foreground"><tr><th className="py-2 pr-3">Titulo / NF</th><th className="pr-3">Cedente</th><th className="pr-3">Sacado</th><th className="pr-3">Aquisicao</th><th className="pr-3">Matching</th><th className="pr-3">Logistica</th><th className="pr-3">Evidencia</th><th>Vencimento</th></tr></thead><tbody className="divide-y">
          {dashboard.logistica.rows.map((row) => <tr key={row.id}><td className="max-w-48 truncate py-3 pr-3" title={row.id_recebivel || row.seu_numero || ''}><p className="font-mono text-xs">{row.id_recebivel || row.seu_numero || row.numero_documento || '—'}</p>{row.nota_fiscal_id ? <Link className="text-xs font-medium text-primary hover:underline" href={`/gestor/notas-fiscais/${row.nota_fiscal_id}`}>Ver NF</Link> : <Link className="text-xs font-medium text-primary hover:underline" href={currentQuery(dashboard, 'matching')}>Resolver matching</Link>}</td><td className="max-w-44 truncate pr-3" title={row.cedente_nome || ''}>{row.cedente_nome || '—'}</td><td className="max-w-44 truncate pr-3" title={row.sacado_nome || ''}>{row.sacado_nome || '—'}</td><td className="pr-3 tabular-nums">{row.valor_aquisicao === null ? <span className="text-warning-foreground">Ausente</span> : money(row.valor_aquisicao)}</td><td className="pr-3"><span className={badge(row.matching_status)}>{row.matching_status}</span></td><td className="pr-3">{row.status_logistico ? <span className={badge(row.status_logistico)}>{row.status_logistico}</span> : <span className={badge(row.status_vinculo)}>{row.status_vinculo}</span>}</td><td className="max-w-44 truncate pr-3" title={row.fundamento}>{row.evidencia_familia || row.fundamento}</td><td>{date(row.data_vencimento)}</td></tr>)}
        </tbody></table></div>
        {!dashboard.logistica.rows.length && <p className="py-10 text-center text-muted-foreground">Nenhum snapshot logistico para os filtros informados.</p>}
      </CardContent>
    </Card>
  </div>
}

function percentValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 'Nao calculado'
  return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(Number(value))}%`
}

function ExposureView({ dashboard, operationId, onOperationId, simulation, pending, onSimulate }: {
  dashboard: ConciliacaoDashboard
  operationId: string
  onOperationId: (value: string) => void
  simulation: Record<string, unknown> | null
  pending: boolean
  onSimulate: () => void
}) {
  const execution = dashboard.exposicaoExecucao
  if (!execution) return <div className="space-y-4"><Card><CardHeader><CardTitle>Exposicao conhecida em transito</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Nenhum calculo compativel com a data operacional {date(dashboard.baseFinanceira?.dataOperacional)}, D-1 {date(dashboard.baseFinanceira?.dataD1)} e D-2 {date(dashboard.baseFinanceira?.dataD2)}. Valores ausentes nao foram convertidos em zero.</p>{dashboard.exposicaoExecucaoIncompativel && <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">Existe uma execucao da mesma data com referencias antigas ({date(dashboard.exposicaoExecucaoIncompativel.data_referencia_estoque)} / {date(dashboard.exposicaoExecucaoIncompativel.data_referencia_pl)}). Ela foi preservada apenas como historico e nao e o resultado atual.</p>}<PreviousExecution label="execucao de exposicao" value={dashboard.execucoesAnteriores.exposicao?.data_operacional} /></CardContent></Card></div>
  const neutralClassification = execution?.classificacao_limite || execution?.status || 'SEM_EXECUCAO'
  const cards = [
    ['PL D-2', money(execution?.patrimonio_liquido_d2)],
    ['Posicao D-1', money(execution?.valor_posicao_total)],
    ['Em transito no Estoque', money(execution?.valor_em_transito_estoque)],
    ['Overlay intraday em transito', money(execution?.overlay_em_transito)],
    ['Exposicao conhecida em transito', money(execution?.exposicao_em_transito_total)],
    ['Percentual', percentValue(execution?.percentual_exposicao)],
    ['Limite de referencia', percentValue(execution?.limite_referencia_pct)],
    ['Classificacao matematica', neutralClassification],
  ] as const
  return <div className="space-y-4">
    <Card>
      <CardHeader><CardTitle>Exposicao conhecida em transito</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-6">
        <div><span className="text-muted-foreground">Data operacional</span><p className="font-medium">{date(execution?.data_operacional)}</p></div>
        <div><span className="text-muted-foreground">Estoque ref. D-1</span><p className="font-medium">{date(execution?.data_referencia_estoque)}</p></div>
        <div><span className="text-muted-foreground">PL ref. D-2</span><p className="font-medium">{date(execution?.data_referencia_pl)}</p></div>
        <div><span className="text-muted-foreground">Logistica as-of</span><p className="font-medium">{execution?.logistica_as_of ? new Date(execution.logistica_as_of).toLocaleString('pt-BR') : 'Nao disponivel'}</p></div>
        <div><span className="text-muted-foreground">Overlay as-of</span><p className="font-medium">{execution?.overlay_as_of ? new Date(execution.overlay_as_of).toLocaleString('pt-BR') : 'Nao disponivel'}</p></div>
        <div><span className="text-muted-foreground">Regra</span><p className="font-medium">{execution?.regra_versao || 'Nao executada'}</p></div>
      </CardContent>
    </Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([label, value]) => <SummaryCard key={label} label={label} value={value} />)}
    </div>
    <Card>
      <CardHeader><CardTitle>Qualidade e categorias fora do numerador</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div><p className="text-xs text-muted-foreground">Indeterminada</p><p className="font-semibold">{execution?.quantidade_indeterminada || 0} · {money(execution?.valor_indeterminado)}</p></div>
        <div><p className="text-xs text-muted-foreground">Sem match</p><p className="font-semibold">{execution?.quantidade_sem_match || 0} · {money(execution?.valor_sem_match)}</p></div>
        <div><p className="text-xs text-muted-foreground">Valor ausente</p><p className="font-semibold">{execution?.quantidade_valor_aquisicao_ausente || 0}</p></div>
        <div><p className="text-xs text-muted-foreground">Operacoes nao incorporadas</p><p className="font-semibold">{execution?.quantidade_nao_incorporada || 0} · {money(execution?.operacoes_nao_incorporadas_valor)}</p></div>
        <div className="sm:col-span-2 xl:col-span-4"><p className="text-xs text-muted-foreground">Flags de qualidade</p><p className="font-medium">{execution?.flags_qualidade?.length ? execution.flags_qualidade.join(' · ') : 'Nenhuma flag registrada'}</p></div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Simular impacto</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Simulacao somente leitura. Nenhum status, remessa ou cessao e alterado.</p>
        <div className="flex flex-col gap-2 sm:flex-row"><Input value={operationId} onChange={(event) => onOperationId(event.target.value)} placeholder="UUID da operacao" /><Button variant="outline" disabled={pending || !/^[0-9a-f-]{36}$/i.test(operationId)} onClick={onSimulate}><Calculator /> Simular</Button></div>
        {simulation && <div className="grid gap-3 rounded-lg bg-muted p-3 text-sm sm:grid-cols-3">
          <div><span className="text-muted-foreground">Atual</span><p className="font-semibold">{percentValue(String(simulation.percentualAtual))} · {String(simulation.classificacaoAtual)}</p></div>
          <div><span className="text-muted-foreground">Adicional em transito</span><p className="font-semibold">{money(String(simulation.valorAdicionalEmTransito))}</p></div>
          <div><span className="text-muted-foreground">Projetado</span><p className="font-semibold">{percentValue(String(simulation.percentualProjetado))} · {String(simulation.classificacaoProjetada)}</p></div>
        </div>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Overlay intraday ({dashboard.exposicao.total})</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b text-xs uppercase text-muted-foreground"><tr><th className="py-2 pr-3">Operacao</th><th className="pr-3">NF</th><th className="pr-3">Valor aquisicao</th><th className="pr-3">Status logistico</th><th className="pr-3">Ja no estoque?</th><th className="pr-3">No numerador?</th><th>Motivo</th></tr></thead><tbody className="divide-y">
          {dashboard.exposicao.rows.map((row) => <tr key={row.id}><td className="py-3 pr-3"><Link className="font-mono text-xs text-primary hover:underline" href={`/gestor/operacoes/${row.operacao_id}`}>{row.operacao_id.slice(0, 8)}</Link></td><td className="pr-3"><Link className="font-mono text-xs text-primary hover:underline" href={`/gestor/notas-fiscais/${row.nota_fiscal_id}`}>{row.nota_fiscal_id.slice(0, 8)}</Link></td><td className="pr-3 tabular-nums">{row.valor_aquisicao == null ? 'Ausente' : money(row.valor_aquisicao)}</td><td className="pr-3"><span className={badge(row.status_logistico)}>{row.status_logistico}</span></td><td className="pr-3">{row.ja_incorporado_estoque ? 'Sim' : 'Nao'}</td><td className="pr-3">{row.incluido_no_numerador ? 'Sim' : 'Nao'}</td><td>{row.motivo}</td></tr>)}
        </tbody></table>
        {!dashboard.exposicao.rows.length && <p className="py-10 text-center text-muted-foreground">Nenhum item de overlay nesta execucao.</p>}
      </CardContent>
    </Card>
  </div>
}

function RiskView({ dashboard, onReview }: {
  dashboard: ConciliacaoDashboard
  onReview: (row: ConciliacaoDashboard['risco']['rows'][number]) => void
}) {
  const execution = dashboard.riscoExecucao
  const policy = dashboard.politicaDaData
  const policyLabel = policy.estado === 'APLICAVEL'
    ? `${policy.nome} · v${policy.versao}`
    : policy.estado === 'SEM_POLITICA_PADRAO'
      ? 'Sem politica padrao aplicavel ao fundo'
      : policy.estado === 'SEM_VERSAO_VIGENTE'
        ? 'Politica padrao sem versao vigente na data'
        : policy.estado === 'NAO_CONFIGURADA'
          ? 'Nenhuma politica ativa configurada'
          : 'Politica indisponivel'
  const limitLabel = policy.estado !== 'APLICAVEL'
    ? 'Nao avaliado'
    : !policy.controleExposicaoAtivo
      ? 'Controle de exposicao inativo'
      : policy.limitePct == null
        ? 'Limite indisponivel'
        : percentValue(policy.limitePct)
  if (!execution) return <div className="space-y-4"><Card><CardHeader><CardTitle>Avaliacao de risco da data</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4"><div><span className="text-muted-foreground">Data operacional</span><p className="font-medium">{date(dashboard.filtros.dataReferencia)}</p></div><div><span className="text-muted-foreground">Avaliacao</span><p className="font-medium">Nao executada para esta data</p></div><div><span className="text-muted-foreground">Politica</span><p className="font-medium">{policyLabel}</p></div><div><span className="text-muted-foreground">Limite</span><p className="font-medium">{limitLabel}</p></div><div className="sm:col-span-2 xl:col-span-4"><PreviousExecution label="avaliacao de risco" value={dashboard.execucoesAnteriores.risco?.data_operacional} /></div></CardContent></Card></div>
  const evaluatedAt = execution?.finalizado_em || execution?.created_at
  return <div className="space-y-4">
    <Card>
      <CardContent className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
        <div><span className="text-muted-foreground">Fundo</span><p className="font-medium">{dashboard.fundo.nome}</p></div>
        <div><span className="text-muted-foreground">Data operacional</span><p className="font-medium">{date(execution?.data_operacional || dashboard.filtros.dataReferencia)}</p></div>
        <div><span className="text-muted-foreground">Politica da avaliacao</span><p className="truncate text-xs" title={execution.politica_operacional_versao_id || policyLabel}>{execution.politica_operacional_versao_id ? policyLabel : `${policyLabel} · sem snapshot nesta execucao`}</p></div>
        <div><span className="text-muted-foreground">Regra</span><p className="font-medium">{execution?.regra_versao || 'Sem avaliacao'}</p></div>
        <div><span className="text-muted-foreground">Ultima avaliacao</span><p className="font-medium">{evaluatedAt ? new Date(evaluatedAt).toLocaleString('pt-BR') : 'Nao realizada'}</p></div>
      </CardContent>
    </Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryCard label="Decisao atual" value={execution?.decisao || (execution?.aplicavel === false ? 'NAO_APLICAVEL' : 'Sem avaliacao')} tone={execution?.decisao === 'BLOQUEADO' ? 'danger' : execution?.decisao === 'REVISAO_MANUAL' ? 'warning' : 'success'} />
      <SummaryCard label="PL D-2" value={execution?.patrimonio_liquido_d2 == null ? 'Indisponivel' : money(execution.patrimonio_liquido_d2)} />
      <SummaryCard label="Exposicao atual" value={execution?.exposicao_atual_pct == null ? 'Indeterminada' : percentValue(execution.exposicao_atual_pct)} />
      <SummaryCard label="Exposicao projetada" value={execution?.exposicao_projetada_pct == null ? 'Nao calculada' : percentValue(execution.exposicao_projetada_pct)} />
      <SummaryCard label="Limite" value={execution?.limite_pct == null ? 'Nao configurado' : percentValue(execution.limite_pct)} />
      <SummaryCard label="Em transito" value={execution?.exposicao_atual_valor == null ? 'Indisponivel' : money(execution.exposicao_atual_valor)} />
      <SummaryCard label="Indeterminadas" value={execution?.quantidade_indeterminada || 0} tone={execution?.quantidade_indeterminada ? 'warning' : 'success'} />
      <SummaryCard label="Sem match" value={execution?.quantidade_sem_match || 0} tone={execution?.quantidade_sem_match ? 'danger' : 'success'} />
      <SummaryCard label="Operacoes nao incorporadas" value={execution?.quantidade_operacao_nao_incorporada || 0} tone={execution?.quantidade_operacao_nao_incorporada ? 'danger' : 'success'} />
      <SummaryCard label="Revisoes pendentes" value={dashboard.risco.revisoesPendentes} tone={dashboard.risco.revisoesPendentes ? 'warning' : 'success'} />
      <SummaryCard label="Operacoes bloqueadas" value={dashboard.risco.operacoesBloqueadas} tone={dashboard.risco.operacoesBloqueadas ? 'danger' : 'success'} />
    </div>
    <Card>
      <CardHeader><CardTitle>Avaliacoes de risco ({dashboard.risco.total})</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {dashboard.risco.rows.map((row) => <div key={row.id} className="rounded-xl border border-border p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className={badge(row.decisao || row.status_tecnico)}>{row.decisao || row.status_tecnico}</span><span className="text-xs text-muted-foreground">{row.escopo} · {row.origem} · {row.regra_versao}</span></div>
              <p className="mt-2 text-sm">Atual: <strong>{row.exposicao_atual_pct == null ? 'indeterminada' : percentValue(row.exposicao_atual_pct)}</strong> · Projetada: <strong>{row.exposicao_projetada_pct == null ? 'nao calculada' : percentValue(row.exposicao_projetada_pct)}</strong> · Limite: <strong>{row.limite_pct == null ? 'nao configurado' : percentValue(row.limite_pct)}</strong></p>
              <p className="mt-1 text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString('pt-BR')} · assinatura {row.assinatura_inputs.slice(0, 12)}…</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">{row.operacao_id && <Button render={<Link href={`/gestor/operacoes/${row.operacao_id}`} />} nativeButton={false} size="sm" variant="outline">Ver operacao</Button>}{row.revisao?.status === 'PENDENTE' && <Button size="sm" onClick={() => onReview(row)}>Revisar</Button>}{row.revisao && row.revisao.status !== 'PENDENTE' && <span className={badge(row.revisao.status)}>{row.revisao.status}</span>}</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">{row.motivos.length ? row.motivos.map((reason) => <span key={reason.id} className={badge(reason.severidade)} title={JSON.stringify(reason.detalhes)}>{reason.codigo}{reason.quantidade != null ? ` (${reason.quantidade})` : ''}</span>) : <span className="text-sm text-muted-foreground">Nenhum motivo restritivo registrado.</span>}</div>
          <details className="mt-3 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">Snapshot historico da avaliacao</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><span className="text-muted-foreground">Snapshot P2.5</span><p className="break-all font-mono text-xs">{row.exposicao_execucao_id || 'Indisponivel'}</p></div>
              <div><span className="text-muted-foreground">PL D-2</span><p className="font-medium">{row.patrimonio_liquido_d2 == null ? 'Indisponivel' : money(row.patrimonio_liquido_d2)}</p></div>
              <div><span className="text-muted-foreground">Exposicao atual</span><p className="font-medium">{row.exposicao_atual_valor == null ? 'Indeterminada' : money(row.exposicao_atual_valor)}</p></div>
              <div><span className="text-muted-foreground">Operacao projetada</span><p className="font-medium">{row.operacao_valor_aquisicao == null ? 'Nao calculada' : money(row.operacao_valor_aquisicao)}</p></div>
              <div><span className="text-muted-foreground">Em transito na operacao</span><p className="font-medium">{row.operacao_valor_em_transito == null ? 'Nao calculado' : money(row.operacao_valor_em_transito)}</p></div>
              <div><span className="text-muted-foreground">Indeterminadas / sem match</span><p className="font-medium">{row.quantidade_indeterminada} / {row.quantidade_sem_match}</p></div>
              <div><span className="text-muted-foreground">Politica</span><p className="break-all font-mono text-xs">{row.politica_operacional_versao_id || 'Nao aplicavel'}</p></div>
              <div><span className="text-muted-foreground">Assinatura dos inputs</span><p className="break-all font-mono text-xs">{row.assinatura_inputs}</p></div>
            </div>
          </details>
        </div>)}
        {!dashboard.risco.rows.length && <p className="py-10 text-center text-muted-foreground">Nenhuma avaliacao de risco para os filtros informados.</p>}
      </CardContent>
    </Card>
  </div>
}

function Pagination({ dashboard, total }: { dashboard: ConciliacaoDashboard; total: number }) {
  const pages = Math.max(1, Math.ceil(total / dashboard.filtros.pageSize))
  if (pages <= 1) return null
  const href = (page: number) => {
    const params = new URLSearchParams({ tab: dashboard.filtros.tab, page: String(page), pageSize: String(dashboard.filtros.pageSize) })
    if (dashboard.filtros.dataReferencia) params.set('data', dashboard.filtros.dataReferencia)
    if (dashboard.filtros.status) params.set('status', dashboard.filtros.status)
    if (dashboard.filtros.metodo) params.set('metodo', dashboard.filtros.metodo)
    if (dashboard.filtros.q) params.set('q', dashboard.filtros.q)
    if (dashboard.filtros.cedente) params.set('cedente', dashboard.filtros.cedente)
    if (dashboard.filtros.sacado) params.set('sacado', dashboard.filtros.sacado)
    if (dashboard.filtros.notaFiscal) params.set('nf', dashboard.filtros.notaFiscal)
    if (dashboard.filtros.seuNumero) params.set('seuNumero', dashboard.filtros.seuNumero)
    if (dashboard.filtros.idRecebivel) params.set('idRecebivel', dashboard.filtros.idRecebivel)
    if (dashboard.filtros.vencimentoDe) params.set('vencimentoDe', dashboard.filtros.vencimentoDe)
    if (dashboard.filtros.vencimentoAte) params.set('vencimentoAte', dashboard.filtros.vencimentoAte)
    if (dashboard.filtros.riskReason) params.set('motivo', dashboard.filtros.riskReason)
    if (dashboard.filtros.riskOperation) params.set('operacao', dashboard.filtros.riskOperation)
    if (dashboard.filtros.riskPolicy) params.set('politica', dashboard.filtros.riskPolicy)
    if (dashboard.filtros.riskCreatedFrom) params.set('dataDe', dashboard.filtros.riskCreatedFrom)
    if (dashboard.filtros.riskCreatedTo) params.set('dataAte', dashboard.filtros.riskCreatedTo)
    return `/gestor/conciliacao?${params.toString()}`
  }
  return <div className="flex items-center justify-between text-sm text-muted-foreground"><span>Pagina {dashboard.filtros.page} de {pages}</span><div className="flex gap-2"><Button render={<Link href={href(Math.max(1, dashboard.filtros.page - 1))} />} nativeButton={false} variant="outline" disabled={dashboard.filtros.page <= 1}>Anterior</Button><Button render={<Link href={href(Math.min(pages, dashboard.filtros.page + 1))} />} nativeButton={false} variant="outline" disabled={dashboard.filtros.page >= pages}>Proxima</Button></div></div>
}
