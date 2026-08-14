'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GitCompareArrows, Link2, Play, Search, Truck, Unlink } from 'lucide-react'
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
  pesquisarNotasParaMatchingAction,
  revogarMatchManualAction,
} from '@/lib/actions/conciliacao'
import { cn } from '@/lib/utils'
import type { ConciliacaoDashboard, ConciliacaoTab, MatchingViewRow } from '@/lib/rlx/conciliacao/loaders.server'

const tabs: Array<{ id: ConciliacaoTab; label: string }> = [
  { id: 'visao-geral', label: 'Visao geral' },
  { id: 'matching', label: 'Matching' },
  { id: 'conciliacao', label: 'Conciliacao' },
  { id: 'logistica', label: 'Logistica' },
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
  const numeric = Number(value || 0)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numeric)
}

function date(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
}

function badge(status: string) {
  const ok = ['MATCH_FORTE', 'MANTIDO_CORRETO', 'ENTRADA_INCORPORADA', 'SAIDA_REFLETIDA', 'CONCLUIDA'].includes(status)
  const warning = ['AMBIGUO', 'BASE_INCOMPLETA', 'PROCESSANDO', 'EM_TRANSITO', 'INDETERMINADA'].includes(status)
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

  const matchingCoverage = dashboard.matchingExecucao?.total_registros
    ? Math.round((dashboard.matchingExecucao.matched / dashboard.matchingExecucao.total_registros) * 100)
    : 0
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
          <p className="text-muted-foreground">Matching auditavel entre os titulos RLX e as NFs, seguido da reconciliacao financeira D-2/D-1.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending || !dashboard.filtros.dataReferencia} onClick={() => run(() => executarMatchingAction({ dataReferencia: dashboard.filtros.dataReferencia }))}>
            <Play /> Executar matching
          </Button>
          <Button disabled={pending || !dashboard.filtros.dataReferencia} onClick={() => run(() => executarConciliacaoAction({ dataReferencia: dashboard.filtros.dataReferencia }))}>
            <GitCompareArrows /> Executar conciliacao
          </Button>
          <Button variant="outline" disabled={pending || !dashboard.filtros.dataReferencia} onClick={() => run(() => executarPosicaoLogisticaAction({ dataReferencia: dashboard.filtros.dataReferencia }))}>
            <Truck /> Atualizar logistica
          </Button>
        </div>
      </header>

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
              {['MATCH_FORTE', 'AMBIGUO', 'NAO_CONCILIADO', 'CONFLITO', 'MANTIDO_CORRETO', 'ENTRADA_INCORPORADA', 'ENTRADA_NAO_INCORPORADA', 'SAIDA_REFLETIDA', 'SAIDA_SEM_LIQUIDACAO', 'LIQUIDADO_AINDA_NO_ESTOQUE', 'DIVERGENCIA_VALOR', 'ENTREGUE', 'EM_TRANSITO', 'INDETERMINADA', 'SEM_MATCH_FINANCEIRO_NF'].map((item) => <option key={item}>{item}</option>)}
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
        </CardContent>
      </Card>

      {dashboard.filtros.tab === 'visao-geral' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Cobertura do matching" value={`${matchingCoverage}%`} tone={matchingCoverage >= 90 ? 'success' : 'warning'} />
            <SummaryCard label="Conciliacoes corretas" value={correct} tone="success" />
            <SummaryCard label="Divergencias" value={divergences} tone={divergences ? 'danger' : 'success'} />
            <SummaryCard label="Ambiguos / nao conciliados" value={(dashboard.matchingExecucao?.ambiguos || 0) + (dashboard.matchingExecucao?.nao_conciliados || 0)} tone="warning" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Execucao de matching</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Data</span><p className="font-medium">{date(dashboard.matchingExecucao?.data_referencia)}</p></div>
                <div><span className="text-muted-foreground">Status</span><p><span className={badge(dashboard.matchingExecucao?.status || 'SEM_EXECUCAO')}>{dashboard.matchingExecucao?.status || 'Sem execucao'}</span></p></div>
                <div><span className="text-muted-foreground">Regra</span><p className="font-medium">{dashboard.matchingExecucao?.regra_versao || '—'}</p></div>
                <div><span className="text-muted-foreground">Titulos</span><p className="font-medium tabular-nums">{dashboard.matchingExecucao?.total_registros || 0}</p></div>
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

      {(dashboard.filtros.tab === 'matching' || dashboard.filtros.tab === 'excecoes') && (
        <MatchingTable rows={dashboard.matching.rows} total={dashboard.matching.total} onManual={openManual} onRevoke={(row) => { setRevokeRow(row); setReason(''); setTotp('') }} />
      )}
      {(dashboard.filtros.tab === 'conciliacao' || dashboard.filtros.tab === 'excecoes') && (
        <ReconciliationTable rows={dashboard.conciliacao.rows} total={dashboard.conciliacao.total} />
      )}
      {(dashboard.filtros.tab === 'logistica' || dashboard.filtros.tab === 'excecoes') && (
        <LogisticsView dashboard={dashboard} />
      )}

      <Pagination dashboard={dashboard} total={dashboard.filtros.tab === 'logistica' ? dashboard.logistica.total : dashboard.filtros.tab === 'conciliacao' ? dashboard.conciliacao.total : dashboard.filtros.tab === 'matching' ? dashboard.matching.total : Math.max(dashboard.matching.total, dashboard.conciliacao.total, dashboard.logistica.total)} />

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
  const cards = [
    ['Posicao total', execution?.total_posicoes || 0, execution?.valor_total_aquisicao],
    ['Matched', execution?.posicoes_matched || 0, execution?.valor_matched],
    ['Sem match', execution?.posicoes_sem_match || 0, execution?.valor_sem_match],
    ['Entregue', execution?.posicoes_entregues || 0, execution?.valor_entregue],
    ['Em transito', execution?.posicoes_em_transito || 0, execution?.valor_em_transito],
    ['Indeterminada', execution?.posicoes_indeterminadas || 0, execution?.valor_indeterminado],
  ] as const
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {cards.map(([label, count, value]) => <Card size="sm" key={label}><CardContent><p className="text-xs uppercase text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{count}</p><p className="text-xs font-medium tabular-nums text-muted-foreground">{value === null || value === undefined ? 'Valor nao informado' : money(value)}</p></CardContent></Card>)}
    </div>
    <Card>
      <CardHeader><CardTitle>Posicao logistica ({dashboard.logistica.total})</CardTitle></CardHeader>
      <CardContent>
        {execution && <div className="mb-4 grid gap-2 rounded-lg bg-muted p-3 text-sm sm:grid-cols-3"><div><span className="text-muted-foreground">Estoque</span><p className="font-mono text-xs">{execution.estoque_importacao_id.slice(0, 8)}</p></div><div><span className="text-muted-foreground">Logistica as-of</span><p>{new Date(execution.logistica_as_of).toLocaleString('pt-BR')}</p></div><div><span className="text-muted-foreground">Regra</span><p>{execution.regra_versao}</p></div></div>}
        <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="border-b text-xs uppercase text-muted-foreground"><tr><th className="py-2 pr-3">Titulo / NF</th><th className="pr-3">Cedente</th><th className="pr-3">Sacado</th><th className="pr-3">Aquisicao</th><th className="pr-3">Matching</th><th className="pr-3">Logistica</th><th className="pr-3">Evidencia</th><th>Vencimento</th></tr></thead><tbody className="divide-y">
          {dashboard.logistica.rows.map((row) => <tr key={row.id}><td className="max-w-48 truncate py-3 pr-3" title={row.id_recebivel || row.seu_numero || ''}><p className="font-mono text-xs">{row.id_recebivel || row.seu_numero || row.numero_documento || '—'}</p>{row.nota_fiscal_id ? <Link className="text-xs font-medium text-primary hover:underline" href={`/gestor/notas-fiscais/${row.nota_fiscal_id}`}>Ver NF</Link> : <Link className="text-xs font-medium text-primary hover:underline" href={currentQuery(dashboard, 'matching')}>Resolver matching</Link>}</td><td className="max-w-44 truncate pr-3" title={row.cedente_nome || ''}>{row.cedente_nome || '—'}</td><td className="max-w-44 truncate pr-3" title={row.sacado_nome || ''}>{row.sacado_nome || '—'}</td><td className="pr-3 tabular-nums">{row.valor_aquisicao === null ? <span className="text-warning-foreground">Ausente</span> : money(row.valor_aquisicao)}</td><td className="pr-3"><span className={badge(row.matching_status)}>{row.matching_status}</span></td><td className="pr-3">{row.status_logistico ? <span className={badge(row.status_logistico)}>{row.status_logistico}</span> : <span className={badge(row.status_vinculo)}>{row.status_vinculo}</span>}</td><td className="max-w-44 truncate pr-3" title={row.fundamento}>{row.evidencia_familia || row.fundamento}</td><td>{date(row.data_vencimento)}</td></tr>)}
        </tbody></table></div>
        {!dashboard.logistica.rows.length && <p className="py-10 text-center text-muted-foreground">Nenhum snapshot logistico para os filtros informados.</p>}
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
    return `/gestor/conciliacao?${params.toString()}`
  }
  return <div className="flex items-center justify-between text-sm text-muted-foreground"><span>Pagina {dashboard.filtros.page} de {pages}</span><div className="flex gap-2"><Button render={<Link href={href(Math.max(1, dashboard.filtros.page - 1))} />} nativeButton={false} variant="outline" disabled={dashboard.filtros.page <= 1}>Anterior</Button><Button render={<Link href={href(Math.min(pages, dashboard.filtros.page + 1))} />} nativeButton={false} variant="outline" disabled={dashboard.filtros.page >= pages}>Proxima</Button></div></div>
}
