import { connection } from 'next/server'
import Link from 'next/link'
import { ArrowRight, BarChart3, Briefcase, CreditCard, DollarSign, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { carregarDashboardConsultor } from '@/lib/analytics/loaders.server'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'

export default async function ConsultorDashboard() {
  await connection()
  const data = await carregarDashboardConsultor()

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div><h1 className="text-2xl font-bold">Dashboard do Consultor</h1><p className="text-sm text-muted-foreground">Visão geral da sua carteira e operações.</p></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Cedentes ativos', value: String(data.cedentesAtivos), detail: `de ${data.cedentesTotal} na carteira`, icon: Users },
          { label: 'Operações ativas', value: String(data.opsAtivas), detail: formatCurrency(data.volumeAtivo), icon: CreditCard },
          { label: 'Volume no mês', value: formatCurrency(data.volumeMes), detail: 'operações não canceladas', icon: BarChart3 },
          { label: 'Comissão estimada', value: formatCurrency(data.comissaoEstimada), detail: 'operações em andamento', icon: DollarSign },
        ].map((metric) => (
          <Card key={metric.label}><CardContent className="p-5"><div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><metric.icon className="size-4 text-primary" />{metric.label}</div><p className="text-2xl font-bold">{metric.value}</p><p className="text-xs text-muted-foreground">{metric.detail}</p></CardContent></Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Minha carteira</CardTitle><Link href="/consultor/carteira" className="inline-flex items-center gap-1 text-sm text-primary">Ver todos <ArrowRight className="size-4" /></Link></CardHeader>
          <CardContent className="divide-y">
            {data.carteiraRecente.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nenhum cedente vinculado.</p> : data.carteiraRecente.map((cedente) => (
              <div key={cedente.cedenteId} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0"><p className="truncate text-sm font-medium" title={cedente.razaoSocial}>{cedente.razaoSocial}</p><p className="text-xs text-muted-foreground">{formatCNPJ(cedente.cnpj)}</p></div>
                <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{cedente.status}</span><Badge variant={cedente.status === 'ativo' ? 'default' : 'outline'}>{cedente.comissaoPercentual}%</Badge></div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Operações recentes</CardTitle><Link href="/consultor/operacoes" className="inline-flex items-center gap-1 text-sm text-primary">Ver todas <ArrowRight className="size-4" /></Link></CardHeader>
          <CardContent className="divide-y">
            {data.operacoesRecentes.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma operação na carteira.</p> : data.operacoesRecentes.map((op) => (
              <Link key={op.id} href={`/consultor/operacoes/${op.id}`} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{op.cedenteNome}</p><p className="text-xs text-muted-foreground">{formatDate(op.createdAt)} · {op.status}</p></div>
                <p className="shrink-0 text-sm font-semibold">{formatCurrency(op.valorBruto)}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Minha carteira', href: '/consultor/carteira', icon: Briefcase },
          { label: 'Operações', href: '/consultor/operacoes', icon: CreditCard },
          { label: 'Relatórios', href: '/consultor/relatorios', icon: BarChart3 },
        ].map((item) => <Link key={item.href} href={item.href} className="flex items-center justify-between rounded-xl border bg-card p-4 font-medium hover:border-primary/30"><span className="flex items-center gap-2"><item.icon className="size-4 text-primary" />{item.label}</span><ArrowRight className="size-4" /></Link>)}
      </div>
    </div>
  )
}
