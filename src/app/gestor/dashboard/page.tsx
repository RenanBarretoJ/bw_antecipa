'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { AlertTriangle, ArrowRight, Clock3, CreditCard, FileText, Receipt, TrendingUp, Truck, Users, Wallet } from 'lucide-react'
import Link from 'next/link'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { DataTableContainer, EmptyState, MetricCard, ResponsiveActions, StatusBadge } from '@/components/data-display/primitives'

interface GestorStats {
  totalCedentes: number
  cedentesAtivos: number
  docsPendentes: number
  opsAtivas: number
  opsSolicitadas: number
  opsInadimplentes: number
  volumeAtivo: number
  volumeMes: number
  saldoEscrowTotal: number
  nfsPendentes: number
  entregasEmTransito: number
  entregasComPendencia: number
  entregasEntregues: number
}

interface OperacaoRecente {
  id: string
  valor_bruto_total: number
  valor_liquido_desembolso: number
  status: string
  aceite_sacado_exigido: boolean | null
  aceite_sacado_status: string | null
  created_at: string
  cedentes: { razao_social: string }
}

function DashboardSkeleton() {
  return (
    <PageContainer className="space-y-6">
      <div className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-9 w-64" /><Skeleton className="h-4 w-80" /></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="rounded-xl border border-border bg-card p-5"><Skeleton className="h-4 w-24" /><Skeleton className="mt-3 h-8 w-28" /><Skeleton className="mt-2 h-3 w-20" /></div>)}
      </div>
    </PageContainer>
  )
}

export default function GestorDashboard() {
  const [stats, setStats] = useState<GestorStats>({
    totalCedentes: 0, cedentesAtivos: 0, docsPendentes: 0,
    opsAtivas: 0, opsSolicitadas: 0, opsInadimplentes: 0,
    volumeAtivo: 0, volumeMes: 0, saldoEscrowTotal: 0, nfsPendentes: 0,
    entregasEmTransito: 0, entregasComPendencia: 0, entregasEntregues: 0,
  })
  const [opsRecentes, setOpsRecentes] = useState<OperacaoRecente[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const [cedentes, docs, ops, escrow, nfs, entregas] = await Promise.all([
        supabase.from('cedentes').select('id, status'),
        supabase.from('documentos').select('id, status').in('status', ['enviado', 'em_analise']),
        supabase.from('operacoes').select('id, valor_bruto_total, valor_liquido_desembolso, status, created_at, aceite_sacado_exigido, aceite_sacado_status, cedentes(razao_social)').order('created_at', { ascending: false }),
        supabase.from('contas_escrow').select('saldo_disponivel, saldo_bloqueado'),
        supabase.from('notas_fiscais').select('id', { count: 'exact', head: true }).in('status', ['submetida', 'em_analise']),
        supabase.from('nota_fiscal_entregas').select('id, status_entrega').neq('status_entrega', 'nao_aplicavel'),
      ])

      const cedsData = (cedentes.data || []) as Array<{ id: string; status: string }>
      const opsData = (ops.data || []) as OperacaoRecente[]
      const escrowData = (escrow.data || []) as Array<{ saldo_disponivel: number; saldo_bloqueado: number }>
      const entregasData = (entregas.data || []) as Array<{ id: string; status_entrega: string }>
      const mesAtual = new Date().toISOString().substring(0, 7)
      const opsAtivas = opsData.filter((o) => o.status === 'em_andamento')
      const opsMes = opsData.filter((o) => o.created_at.substring(0, 7) === mesAtual && !['cancelada', 'reprovada'].includes(o.status))

      const opsProntasAnalise = opsData.filter((o) => ['solicitada', 'em_analise'].includes(o.status) && (o.aceite_sacado_exigido === false || o.aceite_sacado_status === 'dispensado' || o.aceite_sacado_status === 'aceito'))
      setStats({
        totalCedentes: cedsData.length,
        cedentesAtivos: cedsData.filter((c) => c.status === 'ativo').length,
        docsPendentes: (docs.data || []).length,
        opsAtivas: opsAtivas.length,
        opsSolicitadas: opsProntasAnalise.length,
        opsInadimplentes: opsData.filter((o) => o.status === 'inadimplente').length,
        volumeAtivo: opsAtivas.reduce((total, operation) => total + operation.valor_liquido_desembolso, 0),
        volumeMes: opsMes.reduce((total, operation) => total + operation.valor_bruto_total, 0),
        saldoEscrowTotal: escrowData.reduce((total, account) => total + account.saldo_disponivel + account.saldo_bloqueado, 0),
        nfsPendentes: nfs.count || 0,
        entregasEmTransito: entregasData.filter((entrega) => entrega.status_entrega === 'em_transito' || entrega.status_entrega === 'aguardando_validacao').length,
        entregasComPendencia: entregasData.filter((entrega) => entrega.status_entrega === 'entrega_com_pendencia').length,
        entregasEntregues: entregasData.filter((entrega) => entrega.status_entrega === 'entregue').length,
      })
      setOpsRecentes(opsData.slice(0, 8))
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <DashboardSkeleton />

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        title="Dashboard do Gestor"
        description="Acompanhe a operação, os cedentes e os pontos que precisam de atenção."
        eyebrow="Visão geral"
        action={<ResponsiveActions><Link href="/gestor/cedentes" className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Ver cedentes</Link><Link href="/gestor/operacoes" className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80">Operações</Link></ResponsiveActions>}
      />

      {(stats.opsInadimplentes > 0 || stats.opsSolicitadas > 0 || stats.docsPendentes > 0) && (
        <div className="grid gap-3 md:grid-cols-3">
          {stats.opsInadimplentes > 0 && <Link href="/gestor/operacoes" className="group rounded-xl border border-destructive/45 bg-destructive/15 p-4 transition-colors hover:bg-destructive/20"><div className="flex items-start gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-destructive/20 text-destructive"><AlertTriangle size={18} /></span><div><p className="text-sm font-semibold text-destructive">{stats.opsInadimplentes} inadimplente(s)</p><p className="mt-1 text-xs text-destructive/85">Atenção urgente <ArrowRight size={12} className="ml-1 inline transition-transform group-hover:translate-x-0.5" /></p></div></div></Link>}
          {stats.opsSolicitadas > 0 && <Link href="/gestor/operacoes" className="group rounded-xl border border-warning/60 bg-warning/20 p-4 transition-colors hover:bg-warning/30"><div className="flex items-start gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-warning/30 text-warning-foreground"><Clock3 size={18} /></span><div><p className="text-sm font-semibold text-warning-foreground">{stats.opsSolicitadas} aguardando análise</p><p className="mt-1 text-xs text-warning-foreground/85">Abrir fila de operações <ArrowRight size={12} className="ml-1 inline" /></p></div></div></Link>}
          {stats.docsPendentes > 0 && <Link href="/gestor/cedentes" className="group rounded-xl border border-info/50 bg-info/20 p-4 transition-colors hover:bg-info/30"><div className="flex items-start gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-info/30 text-info-foreground"><FileText size={18} /></span><div><p className="text-sm font-semibold text-info-foreground">{stats.docsPendentes} documento(s) pendente(s)</p><p className="mt-1 text-xs text-info-foreground/85">Revisar cedentes <ArrowRight size={12} className="ml-1 inline" /></p></div></div></Link>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Cedentes" value={stats.totalCedentes} description={`${stats.cedentesAtivos} ativos`} icon={Users} tone="info" />
        <MetricCard label="Operações ativas" value={stats.opsAtivas} description={formatCurrency(stats.volumeAtivo)} icon={CreditCard} tone="primary" />
        <MetricCard label="Volume no mês" value={formatCurrency(stats.volumeMes)} description="Operações não canceladas" icon={TrendingUp} tone="success" />
        <MetricCard label="Saldo em escrow" value={formatCurrency(stats.saldoEscrowTotal)} description={`${stats.nfsPendentes} NF(s) pendente(s)`} icon={Wallet} tone="warning" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Entregas em acompanhamento" value={stats.entregasEmTransito} description="Em trânsito ou aguardando validação" icon={Truck} tone="primary" />
        <MetricCard label="Entregas com pendência" value={stats.entregasComPendencia} description="CT-e/canhoto vencido ou apontamento manual" icon={AlertTriangle} tone="warning" />
        <MetricCard label="Entregas confirmadas" value={stats.entregasEntregues} description="CT-e e canhoto aprovados" icon={Receipt} tone="success" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-base font-semibold">Operações recentes</p><p className="text-sm text-muted-foreground">Últimos registros da operação</p></div><Link href="/gestor/operacoes" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80">Ver todas <ArrowRight size={14} /></Link></div>
          <DataTableContainer>
            {opsRecentes.length === 0 ? <EmptyState title="Nenhuma operação" description="Quando houver operações registradas, elas aparecerão aqui." icon={CreditCard} /> : <div className="divide-y divide-border">{opsRecentes.map((op) => <Link key={op.id} href={`/gestor/operacoes/${op.id}`} className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/40"><div className="min-w-0"><p className="truncate text-sm font-medium">{op.cedentes.razao_social}</p><div className="mt-1 flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">{formatDate(op.created_at)}</span><StatusBadge status={op.status} /><span className="text-xs text-muted-foreground">{op.aceite_sacado_exigido === false || op.aceite_sacado_status === 'dispensado' ? 'Aceite dispensado pela política' : `Aceite: ${op.aceite_sacado_status || 'pendente'}`}</span></div></div><p className="shrink-0 text-sm font-semibold tabular-nums">{formatCurrency(op.valor_bruto_total)}</p></Link>)}</div>}
          </DataTableContainer>
        </section>

        <section><div className="mb-3"><p className="text-base font-semibold">Acessos rápidos</p><p className="text-sm text-muted-foreground">Atalhos para rotinas do gestor</p></div><div className="grid gap-2">{[
          { label: 'Cedentes', href: '/gestor/cedentes', icon: Users, desc: `${stats.totalCedentes} cadastrados`, tone: 'bg-info/20 text-info-foreground' },
          { label: 'Notas fiscais', href: '/gestor/notas-fiscais', icon: Receipt, desc: `${stats.nfsPendentes} pendentes`, tone: 'bg-primary/10 text-primary' },
          { label: 'Operações', href: '/gestor/operacoes', icon: CreditCard, desc: `${stats.opsSolicitadas} aguardando`, tone: 'bg-warning/20 text-warning-foreground' },
          { label: 'Contas escrow', href: '/gestor/escrow', icon: Wallet, desc: formatCurrency(stats.saldoEscrowTotal), tone: 'bg-success/20 text-success-foreground' },
          { label: 'Auditoria', href: '/gestor/auditoria', icon: FileText, desc: 'Logs completos', tone: 'bg-muted text-muted-foreground' },
        ].map((item) => <Link key={item.href} href={item.href} className="group flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-md"><span className="flex min-w-0 items-center gap-3"><span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${item.tone}`}><item.icon size={17} /></span><span className="min-w-0"><span className="block text-sm font-medium">{item.label}</span><span className="block truncate text-xs text-muted-foreground">{item.desc}</span></span></span><ArrowRight size={16} className="text-muted-foreground/80 transition-colors group-hover:text-primary" /></Link>)}</div></section>
      </div>
    </PageContainer>
  )
}
