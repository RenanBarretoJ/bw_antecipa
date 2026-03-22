'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Briefcase,
  CreditCard,
  BarChart3,
  ArrowRight,
  Wallet,
  DollarSign,
} from 'lucide-react'

interface CarteiraCedente {
  cedente_id: string
  comissao_percentual: number
  cedentes: {
    razao_social: string
    cnpj: string
    status: string
  }
}

interface OperacaoRecente {
  id: string
  valor_bruto_total: number
  valor_liquido_desembolso: number
  taxa_desconto: number
  status: string
  created_at: string
  cedentes: { razao_social: string }
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  solicitada: { label: 'Solicitada', variant: 'secondary' },
  em_analise: { label: 'Em Analise', variant: 'outline' },
  em_andamento: { label: 'Em Andamento', variant: 'default' },
  liquidada: { label: 'Liquidada', variant: 'secondary' },
  reprovada: { label: 'Reprovada', variant: 'destructive' },
  cancelada: { label: 'Cancelada', variant: 'outline' },
}

function DashboardSkeleton() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Skeleton className="h-8 w-52" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <Card key={i}><CardContent className="pt-5"><Skeleton className="h-8 w-24 mb-1" /><Skeleton className="h-4 w-16" /></CardContent></Card>)}
      </div>
    </div>
  )
}

export default function ConsultorDashboard() {
  const [carteira, setCarteira] = useState<CarteiraCedente[]>([])
  const [operacoes, setOperacoes] = useState<OperacaoRecente[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const [carteiraRes, opsRes] = await Promise.all([
        supabase.from('consultor_cedentes')
          .select('cedente_id, comissao_percentual, cedentes(razao_social, cnpj, status)'),
        supabase.from('operacoes')
          .select('id, valor_bruto_total, valor_liquido_desembolso, taxa_desconto, status, created_at, cedentes(razao_social)')
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      setCarteira((carteiraRes.data || []) as CarteiraCedente[])
      setOperacoes((opsRes.data || []) as OperacaoRecente[])
      setLoading(false)
    }
    load()
  }, [])

  const cedentesAtivos = carteira.filter((c) => c.cedentes.status === 'ativo').length
  const opsAtivas = operacoes.filter((o) => ['em_andamento', 'solicitada', 'em_analise'].includes(o.status))
  const volumeMes = operacoes
    .filter((o) => {
      const mesAtual = new Date().toISOString().substring(0, 7)
      return o.created_at.substring(0, 7) === mesAtual && o.status !== 'cancelada' && o.status !== 'reprovada'
    })
    .reduce((acc, o) => acc + o.valor_bruto_total, 0)

  const comissaoEstimada = operacoes
    .filter((o) => o.status === 'em_andamento')
    .reduce((acc, o) => {
      const cedCarteira = carteira.find((c) => c.cedentes.razao_social === o.cedentes.razao_social)
      const pct = cedCarteira?.comissao_percentual || 0
      return acc + (o.valor_liquido_desembolso * pct / 100)
    }, 0)

  if (loading) return <DashboardSkeleton />

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard do Consultor</h1>
        <p className="text-muted-foreground text-sm">Visao geral da sua carteira e operacoes</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-500/20"><Briefcase size={16} className="text-amber-600 dark:text-amber-400" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cedentes</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">{cedentesAtivos}</p>
            <p className="text-xs text-muted-foreground mt-1">de {carteira.length} na carteira</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-500/20"><CreditCard size={16} className="text-blue-600 dark:text-blue-400" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ops Ativas</span>
            </div>
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">{opsAtivas.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{formatCurrency(opsAtivas.reduce((a, o) => a + o.valor_bruto_total, 0))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-500/20"><BarChart3 size={16} className="text-purple-600 dark:text-purple-400" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Volume Mes</span>
            </div>
            <p className="text-2xl font-bold text-purple-700 dark:text-purple-400 tabular-nums">{formatCurrency(volumeMes)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-500/20"><DollarSign size={16} className="text-emerald-600 dark:text-emerald-400" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Comissao Est.</span>
            </div>
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{formatCurrency(comissaoEstimada)}</p>
            <p className="text-xs text-muted-foreground mt-1">operacoes ativas</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Carteira */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Minha Carteira</CardTitle>
            <Link href="/consultor/carteira" className="text-sm text-primary hover:text-primary/80 flex items-center gap-1 font-medium">
              Ver todos <ArrowRight size={14} />
            </Link>
          </CardHeader>
          <CardContent>
            {carteira.length === 0 ? (
              <div className="text-center py-8">
                <Briefcase size={32} className="text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">Nenhum cedente vinculado</p>
              </div>
            ) : (
              <div className="space-y-1">
                {carteira.slice(0, 5).map((c) => (
                  <div key={c.cedente_id} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
                    <div>
                      <p className="text-sm font-medium">{c.cedentes.razao_social}</p>
                      <p className="text-xs text-muted-foreground font-mono">{formatCNPJ(c.cedentes.cnpj)}</p>
                    </div>
                    <div className="text-right flex items-center gap-3">
                      <Badge variant={c.cedentes.status === 'ativo' ? 'secondary' : 'outline'}>
                        {c.cedentes.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground tabular-nums">{c.comissao_percentual}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Operacoes recentes */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Operacoes Recentes</CardTitle>
            <Link href="/consultor/operacoes" className="text-sm text-primary hover:text-primary/80 flex items-center gap-1 font-medium">
              Ver todas <ArrowRight size={14} />
            </Link>
          </CardHeader>
          <CardContent>
            {operacoes.length === 0 ? (
              <div className="text-center py-8">
                <CreditCard size={32} className="text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">Nenhuma operacao encontrada</p>
              </div>
            ) : (
              <div className="space-y-1">
                {operacoes.slice(0, 5).map((op) => {
                  const st = statusConfig[op.status]
                  return (
                    <div key={op.id} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
                      <div>
                        <p className="text-sm font-medium">{op.cedentes.razao_social}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">{formatDate(op.created_at)}</span>
                          <Badge variant={st?.variant || 'secondary'}>
                            {st?.label || op.status}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm font-bold tabular-nums">{formatCurrency(op.valor_bruto_total)}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Links rapidos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Minha Carteira', href: '/consultor/carteira', icon: Briefcase, color: 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400' },
          { label: 'Operacoes', href: '/consultor/operacoes', icon: CreditCard, color: 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400' },
          { label: 'Relatorios', href: '/consultor/relatorios', icon: BarChart3, color: 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400' },
        ].map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="hover:ring-2 hover:ring-primary/20 transition-all cursor-pointer group">
              <CardContent className="flex items-center justify-between py-5">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${item.color}`}><item.icon size={18} /></div>
                  <span className="font-medium text-foreground">{item.label}</span>
                </div>
                <ArrowRight size={18} className="text-muted-foreground/40 group-hover:text-primary transition-colors" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
