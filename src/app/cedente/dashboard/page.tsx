import { connection } from 'next/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, ArrowRight, Banknote, FileCheck, Plus, Receipt, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { carregarDashboardCedente } from '@/lib/analytics/loaders.server'
import { formatCurrency, formatDate } from '@/lib/utils'

const statusLabel: Record<string, string> = {
  solicitada: 'Solicitada',
  em_analise: 'Em análise',
  em_andamento: 'Em andamento',
  liquidada: 'Liquidada',
  reprovada: 'Reprovada',
  cancelada: 'Cancelada',
  inadimplente: 'Inadimplente',
}

export default async function CedenteDashboard() {
  await connection()
  const stats = await carregarDashboardCedente()
  if (!stats) redirect('/cedente/cadastro')

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Dashboard</h1><p className="text-muted-foreground">{stats.contaEscrow ? <>Conta Escrow: <span className="font-mono">{stats.contaEscrow}</span></> : 'Visão geral das suas antecipações.'}</p></div>
        <Link href="/cedente/operacoes/nova" className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"><Plus className="size-4" /> Nova solicitação</Link>
      </div>

      {stats.docsReprovados > 0 && (
        <Link href="/cedente/documentos" className="flex items-center justify-between rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <span className="flex items-center gap-3"><AlertTriangle className="text-destructive" /><span><span className="block font-semibold">{stats.docsReprovados} documento(s) precisam de ajuste</span><span className="text-sm text-muted-foreground">Revise os documentos reprovados.</span></span></span>
          <ArrowRight className="size-4" />
        </Link>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-5"><div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="size-4" /> Saldo disponível</div><p className="text-2xl font-bold text-success-foreground">{formatCurrency(stats.saldoDisponivel)}</p><p className="text-xs text-muted-foreground">{stats.contaEscrow ?? (stats.habilitarEscrow ? 'Conta em configuração' : 'Escrow não habilitado')}</p></CardContent></Card>
        <Card><CardContent className="p-5"><div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><Banknote className="size-4" /> Volume ativo</div><p className="text-2xl font-bold">{formatCurrency(stats.volumeAtivo)}</p><p className="text-xs text-muted-foreground">{stats.opsAtivas} operação(ões) em andamento</p></CardContent></Card>
        <Card><CardContent className="p-5"><div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><FileCheck className="size-4" /> Notas fiscais</div><p className="text-2xl font-bold">{stats.nfsAprovadas}</p><p className="text-xs text-muted-foreground">de {stats.nfsTotal} aprovadas</p></CardContent></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle>Operações recentes</CardTitle><p className="text-sm text-muted-foreground">Últimas cinco solicitações do fundo selecionado.</p></div>
            <Link href="/cedente/operacoes" className="text-sm font-medium text-primary">Ver todas</Link>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {stats.operacoesRecentes.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground"><Receipt className="mx-auto mb-2 size-8 opacity-40" />Nenhuma operação cadastrada.</div>
            ) : stats.operacoesRecentes.map((op) => (
              <Link key={op.id} href={`/cedente/operacoes/${op.id}`} className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-muted/40">
                <div><div className="flex items-center gap-2"><span className="font-mono text-xs">#{op.id.slice(0, 8)}</span><Badge variant="secondary">{statusLabel[op.status] ?? op.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{formatDate(op.createdAt)} · vence em {formatDate(op.dataVencimento)}</p></div>
                <p className="font-semibold tabular-nums">{formatCurrency(op.valorBruto)}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
        <div className="grid gap-3">
          {[
            { label: 'Meus documentos', href: '/cedente/documentos', icon: FileCheck },
            { label: 'Minhas NFs', href: '/cedente/notas-fiscais', icon: Receipt },
            { label: 'Minhas operações', href: '/cedente/operacoes', icon: Banknote },
            ...(stats.habilitarEscrow ? [{ label: 'Extrato Escrow', href: '/cedente/extrato', icon: Wallet }] : []),
          ].map((item) => (
            <Link key={item.href} href={item.href} className="flex items-center justify-between rounded-xl border bg-card p-4 font-medium hover:border-primary/30">
              <span className="flex items-center gap-3"><item.icon className="size-5 text-primary" />{item.label}</span><ArrowRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
