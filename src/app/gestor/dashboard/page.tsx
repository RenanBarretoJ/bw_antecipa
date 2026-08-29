import { connection } from 'next/server'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  CreditCard,
  FileText,
  Receipt,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from 'lucide-react'
import { DataTableContainer, EmptyState, MetricCard, StatusBadge } from '@/components/data-display/primitives'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { carregarDashboardGestor } from '@/lib/analytics/loaders.server'
import { formatCurrency, formatDate } from '@/lib/utils'

export default async function GestorDashboard() {
  await connection()
  const stats = await carregarDashboardGestor()

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        eyebrow="Visão geral"
        title={`Dashboard — ${stats.fundo.nome}`}
        description="Acompanhe a operação, os cedentes e os pontos que precisam de atenção no fundo ativo."
        action={(
          <div className="flex gap-2">
            <Link href="/gestor/cedentes" className="inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted">Ver cedentes</Link>
            <Link href="/gestor/operacoes" className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Operações</Link>
          </div>
        )}
      />

      {(stats.opsInadimplentes > 0 || stats.opsSolicitadas > 0 || stats.docsPendentes > 0) && (
        <div className="grid gap-3 md:grid-cols-3">
          {stats.opsInadimplentes > 0 && (
            <Link href="/gestor/operacoes" className="rounded-xl border border-destructive/45 bg-destructive/15 p-4">
              <div className="flex gap-3"><AlertTriangle className="text-destructive" /><div><p className="font-semibold text-destructive">{stats.opsInadimplentes} inadimplente(s)</p><p className="text-xs text-destructive/85">Atenção urgente</p></div></div>
            </Link>
          )}
          {stats.opsSolicitadas > 0 && (
            <Link href="/gestor/operacoes" className="rounded-xl border border-warning/60 bg-warning/20 p-4">
              <div className="flex gap-3"><Clock3 className="text-warning-foreground" /><div><p className="font-semibold">{stats.opsSolicitadas} aguardando análise</p><p className="text-xs text-muted-foreground">Abrir fila de operações</p></div></div>
            </Link>
          )}
          {stats.docsPendentes > 0 && (
            <Link href="/gestor/cedentes" className="rounded-xl border border-info/50 bg-info/20 p-4">
              <div className="flex gap-3"><FileText className="text-info-foreground" /><div><p className="font-semibold">{stats.docsPendentes} documento(s) pendente(s)</p><p className="text-xs text-muted-foreground">Revisar cedentes</p></div></div>
            </Link>
          )}
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
          <div className="mb-3 flex items-center justify-between">
            <div><p className="font-semibold">Operações recentes</p><p className="text-sm text-muted-foreground">Últimos oito registros do fundo</p></div>
            <Link href="/gestor/operacoes" className="inline-flex items-center gap-1 text-sm font-medium text-primary">Ver todas <ArrowRight size={14} /></Link>
          </div>
          <DataTableContainer>
            {stats.operacoesRecentes.length === 0 ? (
              <EmptyState title="Nenhuma operação" description="Quando houver operações, elas aparecerão aqui." icon={CreditCard} />
            ) : (
              <div className="divide-y">
                {stats.operacoesRecentes.map((op) => (
                  <Link key={op.id} href={`/gestor/operacoes/${op.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-muted/40">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{op.cedenteNome}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">{formatDate(op.createdAt)}</span>
                        <StatusBadge status={op.status} />
                        <span className="text-xs text-muted-foreground">
                          {op.aceiteSacadoExigido === false || op.aceiteSacadoStatus === 'dispensado'
                            ? 'Aceite dispensado pela política'
                            : `Aceite: ${op.aceiteSacadoStatus || 'pendente'}`}
                        </span>
                      </div>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{formatCurrency(op.valorBruto)}</p>
                  </Link>
                ))}
              </div>
            )}
          </DataTableContainer>
        </section>

        <section>
          <div className="mb-3"><p className="font-semibold">Acessos rápidos</p><p className="text-sm text-muted-foreground">Rotinas do fundo ativo</p></div>
          <div className="grid gap-2">
            {[
              { label: 'Cedentes', href: '/gestor/cedentes', icon: Users, value: `${stats.totalCedentes} cadastrados` },
              { label: 'Notas fiscais', href: '/gestor/notas-fiscais', icon: Receipt, value: `${stats.nfsPendentes} pendentes` },
              { label: 'Operações', href: '/gestor/operacoes', icon: CreditCard, value: `${stats.opsSolicitadas} aguardando` },
              { label: 'Contas escrow', href: '/gestor/escrow', icon: Wallet, value: formatCurrency(stats.saldoEscrowTotal) },
              { label: 'Auditoria', href: '/gestor/auditoria', icon: FileText, value: 'Logs completos' },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 hover:border-primary/30">
                <span className="flex min-w-0 items-center gap-3"><item.icon className="size-5 text-primary" /><span><span className="block text-sm font-medium">{item.label}</span><span className="block truncate text-xs text-muted-foreground">{item.value}</span></span></span>
                <ArrowRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </PageContainer>
  )
}
