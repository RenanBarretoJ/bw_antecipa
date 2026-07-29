import Link from 'next/link'
import { connection } from 'next/server'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar,
  CheckSquare,
  Clock,
  CreditCard,
  Receipt,
  Wallet,
} from 'lucide-react'
import { carregarDashboardSacado } from '@/lib/sacado/portal-loaders.server'
import { formatCNPJ, formatCurrency, formatDate, parseLocalDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function diasAteVencimento(data: string, hoje: string) {
  return Math.ceil(
    (parseLocalDate(data).getTime() - parseLocalDate(hoje).getTime())
      / (1000 * 60 * 60 * 24),
  )
}

function labelVencimento(data: string, hoje: string) {
  const dias = diasAteVencimento(data, hoje)
  if (dias < 0) return `${Math.abs(dias)}d atrasado`
  if (dias === 0) return 'Hoje'
  if (dias === 1) return 'Amanha'
  return `em ${dias}d`
}

function corVencimento(data: string, hoje: string) {
  const dias = diasAteVencimento(data, hoje)
  if (dias <= 0) return 'border-destructive/30 bg-destructive/5'
  if (dias <= 5) return 'border-warning/60 bg-warning/20'
  return 'border-success/50 bg-success/15'
}

export default async function SacadoDashboard() {
  await connection()
  const dashboard = await carregarDashboardSacado()
  const hoje = new Date().toISOString().slice(0, 10)
  const { indicadores } = dashboard
  const vencimentosPorData = Array.from(
    dashboard.proximosVencimentos.reduce((grupos, item) => {
      const grupo = grupos.get(item.vencimentoEm) || {
        data: item.vencimentoEm,
        itens: [],
        total: 0,
      }
      grupo.itens.push(item)
      grupo.total += item.valor
      grupos.set(item.vencimentoEm, grupo)
      return grupos
    }, new Map<string, {
      data: string
      itens: typeof dashboard.proximosVencimentos
      total: number
    }>()),
  ).map(([, grupo]) => grupo)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard do Sacado</h1>
        <p className="text-sm text-muted-foreground">Acompanhe seus pagamentos e vencimentos</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardContent className="pt-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="rounded-lg bg-primary/20 p-2"><CreditCard size={16} className="text-primary" /></div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total a Pagar</span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-primary">{formatCurrency(indicadores.totalDevido)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{indicadores.nfsAtivas} NF(s) ativas</p>
        </CardContent></Card>

        <Card className={indicadores.vencidas > 0 ? 'border-destructive/30 bg-destructive/5' : ''}>
          <CardContent className="pt-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-lg bg-destructive/20 p-2"><AlertTriangle size={16} className="text-destructive" /></div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Vencidos</span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-destructive">{indicadores.vencidas}</p>
            {indicadores.vencidas > 0 && <p className="mt-1 text-xs text-destructive/80">{formatCurrency(indicadores.valorVencido)}</p>}
          </CardContent>
        </Card>

        <Card className={indicadores.vencemHoje > 0 ? 'border-warning/60 bg-warning/20' : ''}>
          <CardContent className="pt-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-lg bg-warning/20 p-2"><Calendar size={16} className="text-warning-foreground" /></div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Vencem Hoje</span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-warning-foreground">{indicadores.vencemHoje}</p>
            {indicadores.vencemHoje > 0 && <p className="mt-1 text-xs text-warning-foreground">{formatCurrency(indicadores.valorVenceHoje)}</p>}
          </CardContent>
        </Card>

        <Card><CardContent className="pt-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="rounded-lg bg-info/20 p-2"><Clock size={16} className="text-info-foreground" /></div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Proximos 7d</span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-info-foreground">{indicadores.proximos7Dias}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(indicadores.valorProximos7Dias)}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2">
          <Calendar size={20} className="text-primary" />
          Calendario de Vencimentos
        </CardTitle></CardHeader>
        <CardContent>
          {vencimentosPorData.length === 0 ? (
            <div className="py-8 text-center">
              <Calendar size={32} className="mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Nenhum vencimento pendente</p>
            </div>
          ) : (
            <div className="space-y-3">
              {vencimentosPorData.map((grupo) => {
                const dias = diasAteVencimento(grupo.data, hoje)
                return (
                  <div
                    key={grupo.data}
                    className={`rounded-xl border p-4 ${corVencimento(grupo.data, hoje)}`}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-foreground">
                          {formatDate(grupo.data)}
                        </span>
                        <Badge variant={dias <= 0 ? 'destructive' : dias <= 5 ? 'outline' : 'secondary'}>
                          {labelVencimento(grupo.data, hoje)}
                        </Badge>
                      </div>
                      <span className="font-bold tabular-nums text-foreground">
                        {formatCurrency(grupo.total)}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {grupo.itens.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between rounded-lg bg-card/60 px-3 py-2 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Receipt size={14} className="shrink-0 text-muted-foreground" />
                            <span className="shrink-0 font-medium">NF {item.numero}</span>
                            <span
                              className="hidden truncate text-xs text-muted-foreground sm:inline"
                              title={item.cedenteNome}
                            >
                              — {item.cedenteNome}
                            </span>
                          </div>
                          <span className="shrink-0 font-medium tabular-nums">
                            {formatCurrency(item.valor)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {dashboard.proximosVencimentos.length === 8 && (
            <p className="mt-3 text-xs text-muted-foreground">Exibindo os 8 vencimentos mais proximos.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2">
          <Building2 size={20} className="text-primary" />
          Pagamentos por Cedente
        </CardTitle></CardHeader>
        <CardContent>
          {dashboard.cedentesEmAberto.length === 0 ? (
            <div className="py-8 text-center">
              <Building2 size={32} className="mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Nenhum pagamento pendente</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {dashboard.cedentesEmAberto.map((item) => (
                <div key={item.cedenteId} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold" title={item.nome}>{item.nome}</p>
                    <p className="font-mono text-xs text-muted-foreground">{formatCNPJ(item.cnpj)}</p>
                    {item.contaEscrow && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-primary">
                        <Wallet size={12} /> Conta escrow: <strong className="font-mono">{item.contaEscrow}</strong>
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold tabular-nums">{formatCurrency(item.totalDevido)}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantidadeNfs} NF(s) · {item.quantidadeOperacoes} operacao(oes)
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'NFs Recebidas', href: '/sacado/notas-fiscais', icon: Receipt, color: 'bg-primary/20 text-primary' },
          { label: 'Aprovacao de Cessao', href: '/sacado/aprovacao', icon: CheckSquare, color: 'bg-warning/20 text-warning-foreground' },
          { label: 'Historico Pagamentos', href: '/sacado/pagamentos', icon: Wallet, color: 'bg-success/20 text-success-foreground' },
        ].map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="group cursor-pointer transition-all hover:ring-2 hover:ring-primary/20">
              <CardContent className="flex items-center justify-between py-5">
                <div className="flex items-center gap-3">
                  <div className={`rounded-lg p-2 ${item.color}`}><item.icon size={18} /></div>
                  <span className="font-medium text-foreground">{item.label}</span>
                </div>
                <ArrowRight size={18} className="text-muted-foreground/80 transition-colors group-hover:text-primary" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
