'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Users,
  FileText,
  CreditCard,
  Wallet,
  AlertTriangle,
  TrendingUp,
  Receipt,
  ArrowRight,
  Clock,
} from 'lucide-react'

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
}

interface OperacaoRecente {
  id: string
  valor_bruto_total: number
  status: string
  created_at: string
  cedentes: { razao_social: string }
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  solicitada: { label: 'Solicitada', variant: 'secondary' },
  em_andamento: { label: 'Em Andamento', variant: 'default' },
  liquidada: { label: 'Liquidada', variant: 'secondary' },
  inadimplente: { label: 'Inadimplente', variant: 'destructive' },
  reprovada: { label: 'Reprovada', variant: 'destructive' },
  cancelada: { label: 'Cancelada', variant: 'outline' },
}

function DashboardSkeleton() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <Card key={i}><CardContent className="pt-5"><Skeleton className="h-8 w-24 mb-1" /><Skeleton className="h-4 w-16" /></CardContent></Card>)}
      </div>
    </div>
  )
}

export default function GestorDashboard() {
  const [stats, setStats] = useState<GestorStats>({
    totalCedentes: 0, cedentesAtivos: 0, docsPendentes: 0,
    opsAtivas: 0, opsSolicitadas: 0, opsInadimplentes: 0,
    volumeAtivo: 0, volumeMes: 0, saldoEscrowTotal: 0, nfsPendentes: 0,
  })
  const [opsRecentes, setOpsRecentes] = useState<OperacaoRecente[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const [cedentes, docs, ops, escrow, nfs] = await Promise.all([
        supabase.from('cedentes').select('id, status'),
        supabase.from('documentos').select('id, status').in('status', ['enviado', 'em_analise']),
        supabase.from('operacoes').select('id, valor_bruto_total, valor_liquido_desembolso, status, created_at, cedentes(razao_social)').order('created_at', { ascending: false }),
        supabase.from('contas_escrow').select('saldo_disponivel, saldo_bloqueado'),
        supabase.from('notas_fiscais').select('id', { count: 'exact', head: true }).in('status', ['submetida', 'em_analise']),
      ])

      const cedsData = (cedentes.data || []) as Array<{ id: string; status: string }>
      const opsData = (ops.data || []) as Array<{
        id: string; valor_bruto_total: number; valor_liquido_desembolso: number;
        status: string; created_at: string; cedentes: { razao_social: string }
      }>
      const escrowData = (escrow.data || []) as Array<{ saldo_disponivel: number; saldo_bloqueado: number }>

      const mesAtual = new Date().toISOString().substring(0, 7)
      const opsAtivas = opsData.filter((o) => o.status === 'em_andamento')
      const opsMes = opsData.filter((o) => o.created_at.substring(0, 7) === mesAtual && !['cancelada', 'reprovada'].includes(o.status))

      setStats({
        totalCedentes: cedsData.length,
        cedentesAtivos: cedsData.filter((c) => c.status === 'ativo').length,
        docsPendentes: (docs.data || []).length,
        opsAtivas: opsAtivas.length,
        opsSolicitadas: opsData.filter((o) => o.status === 'solicitada').length,
        opsInadimplentes: opsData.filter((o) => o.status === 'inadimplente').length,
        volumeAtivo: opsAtivas.reduce((a, o) => a + o.valor_liquido_desembolso, 0),
        volumeMes: opsMes.reduce((a, o) => a + o.valor_bruto_total, 0),
        saldoEscrowTotal: escrowData.reduce((a, e) => a + e.saldo_disponivel + e.saldo_bloqueado, 0),
        nfsPendentes: nfs.count || 0,
      })
      setOpsRecentes(opsData.slice(0, 8) as OperacaoRecente[])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <DashboardSkeleton />

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard do Gestor</h1>
        <p className="text-muted-foreground text-sm">Visao geral do sistema</p>
      </div>

      {/* Alertas */}
      {(stats.opsInadimplentes > 0 || stats.opsSolicitadas > 0 || stats.docsPendentes > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {stats.opsInadimplentes > 0 && (
            <Link href="/gestor/operacoes">
              <Card className="border-destructive/30 bg-destructive/5 hover:bg-destructive/10 transition-colors cursor-pointer">
                <CardContent className="flex items-center gap-3 py-4">
                  <div className="p-2 rounded-lg bg-destructive/10"><AlertTriangle size={18} className="text-destructive" /></div>
                  <div>
                    <p className="font-semibold text-destructive text-sm">{stats.opsInadimplentes} inadimplente(s)</p>
                    <p className="text-xs text-destructive/70">Atencao urgente</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )}
          {stats.opsSolicitadas > 0 && (
            <Link href="/gestor/operacoes">
              <Card className="border-amber-300/50 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/15 transition-colors cursor-pointer">
                <CardContent className="flex items-center gap-3 py-4">
                  <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-500/20"><Clock size={18} className="text-amber-600 dark:text-amber-400" /></div>
                  <div>
                    <p className="font-semibold text-amber-700 dark:text-amber-400 text-sm">{stats.opsSolicitadas} aguardando analise</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )}
          {stats.docsPendentes > 0 && (
            <Link href="/gestor/cedentes">
              <Card className="border-blue-300/50 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/15 transition-colors cursor-pointer">
                <CardContent className="flex items-center gap-3 py-4">
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-500/20"><FileText size={18} className="text-blue-600 dark:text-blue-400" /></div>
                  <div>
                    <p className="font-semibold text-blue-700 dark:text-blue-400 text-sm">{stats.docsPendentes} doc(s) para analisar</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-500/20"><Users size={16} className="text-blue-600 dark:text-blue-400" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cedentes</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">{stats.totalCedentes}</p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400">{stats.cedentesAtivos} ativos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-500/20"><CreditCard size={16} className="text-purple-600 dark:text-purple-400" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ops Ativas</span>
            </div>
            <p className="text-2xl font-bold text-purple-700 dark:text-purple-400 tabular-nums">{stats.opsAtivas}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(stats.volumeAtivo)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-500/20"><TrendingUp size={16} className="text-emerald-600 dark:text-emerald-400" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Volume Mes</span>
            </div>
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{formatCurrency(stats.volumeMes)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-500/20"><Wallet size={16} className="text-amber-600 dark:text-amber-400" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Custodia</span>
            </div>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">{formatCurrency(stats.saldoEscrowTotal)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Operacoes recentes */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Operacoes Recentes</CardTitle>
            <Link href="/gestor/operacoes" className="text-sm text-primary hover:text-primary/80 flex items-center gap-1 font-medium">
              Ver todas <ArrowRight size={14} />
            </Link>
          </CardHeader>
          <CardContent>
            {opsRecentes.length === 0 ? (
              <div className="text-center py-8">
                <CreditCard size={32} className="text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">Nenhuma operacao</p>
              </div>
            ) : (
              <div className="space-y-1">
                {opsRecentes.map((op) => {
                  const st = statusConfig[op.status]
                  return (
                    <Link key={op.id} href={`/gestor/operacoes/${op.id}`}
                      className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0 hover:bg-muted/50 -mx-2 px-2 rounded-md transition-colors">
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
                    </Link>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Links rapidos */}
        <div className="space-y-3">
          {[
            { label: 'Cedentes', href: '/gestor/cedentes', icon: Users, color: 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400', desc: `${stats.totalCedentes} cadastrados` },
            { label: 'Notas Fiscais', href: '/gestor/notas-fiscais', icon: Receipt, color: 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400', desc: `${stats.nfsPendentes} pendentes` },
            { label: 'Operacoes', href: '/gestor/operacoes', icon: CreditCard, color: 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400', desc: `${stats.opsSolicitadas} aguardando` },
            { label: 'Contas Escrow', href: '/gestor/escrow', icon: Wallet, color: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400', desc: formatCurrency(stats.saldoEscrowTotal) },
            { label: 'Auditoria', href: '/gestor/auditoria', icon: FileText, color: 'bg-gray-100 dark:bg-gray-500/20 text-gray-600 dark:text-gray-400', desc: 'Logs completos' },
          ].map((item) => (
            <Link key={item.href} href={item.href}>
              <Card className="hover:ring-2 hover:ring-primary/20 transition-all cursor-pointer group">
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${item.color}`}><item.icon size={18} /></div>
                    <div>
                      <span className="font-medium text-foreground">{item.label}</span>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                  <ArrowRight size={18} className="text-muted-foreground/40 group-hover:text-primary transition-colors" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
