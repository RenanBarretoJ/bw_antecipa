'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  FileCheck,
  Receipt,
  Banknote,
  Wallet,
  ArrowRight,
  AlertTriangle,
  Plus,
  TrendingUp,
  Loader2,
} from 'lucide-react'

interface CedenteStats {
  saldoDisponivel: number
  saldoBloqueado: number
  contaEscrow: string | null
  habilitarEscrow: boolean
  nfsAprovadas: number
  nfsTotal: number
  opsAtivas: number
  opsPendentes: number
  volumeAtivo: number
  docsReprovados: number
}

interface OperacaoRecente {
  id: string
  valor_bruto_total: number
  valor_liquido_desembolso: number
  status: string
  data_vencimento: string
  created_at: string
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  solicitada: { label: 'Solicitada', variant: 'secondary' },
  em_analise: { label: 'Em Analise', variant: 'outline' },
  em_andamento: { label: 'Em Andamento', variant: 'default' },
  liquidada: { label: 'Liquidada', variant: 'secondary' },
  reprovada: { label: 'Reprovada', variant: 'destructive' },
}

function DashboardSkeleton() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-44" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}><CardContent className="pt-5"><Skeleton className="h-10 w-32 mb-2" /><Skeleton className="h-4 w-20" /></CardContent></Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card><CardContent className="pt-5 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</CardContent></Card>
        <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      </div>
    </div>
  )
}

export default function CedenteDashboard() {
  const [stats, setStats] = useState<CedenteStats>({
    saldoDisponivel: 0, saldoBloqueado: 0, contaEscrow: null, habilitarEscrow: false,
    nfsAprovadas: 0, nfsTotal: 0, opsAtivas: 0, opsPendentes: 0,
    volumeAtivo: 0, docsReprovados: 0,
  })
  const [opsRecentes, setOpsRecentes] = useState<OperacaoRecente[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const [escrow, nfs, ops, docs, cedenteRow] = await Promise.all([
        supabase.from('contas_escrow').select('saldo_disponivel, saldo_bloqueado, identificador').limit(1),
        supabase.from('notas_fiscais').select('id, status'),
        supabase.from('operacoes')
          .select('id, valor_bruto_total, valor_liquido_desembolso, status, data_vencimento, created_at')
          .order('created_at', { ascending: false }),
        supabase.from('documentos').select('id, tipo, representante_id, versao, status').order('versao', { ascending: false }),
        supabase.from('cedentes').select('habilitar_escrow').limit(1).single(),
      ])

      const escrowData = (escrow.data || []) as Array<{ saldo_disponivel: number; saldo_bloqueado: number; identificador: string }>
      const nfsData = (nfs.data || []) as Array<{ id: string; status: string }>
      const opsData = (ops.data || []) as OperacaoRecente[]
      const docsData = (docs.data || []) as Array<{ id: string; tipo: string; representante_id: string | null; versao: number; status: string }>

      // Versão mais recente por (tipo, representante_id)
      const latestDocs = Object.values(
        docsData.reduce<Record<string, typeof docsData[0]>>((acc, d) => {
          const k = `${d.tipo}_${d.representante_id ?? 'null'}`
          if (!acc[k] || d.versao > acc[k].versao) acc[k] = d
          return acc
        }, {})
      )

      const opsAtivas = opsData.filter((o) => o.status === 'em_andamento')
      const opsPendentes = opsData.filter((o) => o.status === 'solicitada' || o.status === 'em_analise')

      setStats({
        saldoDisponivel: escrowData[0]?.saldo_disponivel || 0,
        saldoBloqueado: escrowData[0]?.saldo_bloqueado || 0,
        contaEscrow: escrowData[0]?.identificador || null,
        habilitarEscrow: (cedenteRow.data as { habilitar_escrow: boolean } | null)?.habilitar_escrow ?? false,
        nfsAprovadas: nfsData.filter((n) => n.status === 'aprovada').length,
        nfsTotal: nfsData.length,
        opsAtivas: opsAtivas.length,
        opsPendentes: opsPendentes.length,
        volumeAtivo: opsAtivas.reduce((a, o) => a + o.valor_liquido_desembolso, 0),
        docsReprovados: latestDocs.filter((d) => d.status === 'reprovado').length,
      })
      setOpsRecentes(opsData.slice(0, 5))
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <DashboardSkeleton />

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          {stats.contaEscrow && (
            <p className="text-sm text-muted-foreground mt-0.5">
              Conta Escrow: <span className="font-mono text-foreground/70">{stats.contaEscrow}</span>
            </p>
          )}
        </div>
        <Link href="/cedente/operacoes/nova">
          <Button className="gap-2">
            <Plus size={16} /> Nova Antecipacao
          </Button>
        </Link>
      </div>

      {/* Alerta documentos reprovados */}
      {stats.docsReprovados > 0 && (
        <Link href="/cedente/documentos" className="block">
          <Card className="border-destructive/30 bg-destructive/5 hover:bg-destructive/10 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 py-4">
              <div className="p-2 rounded-lg bg-destructive/10">
                <AlertTriangle size={20} className="text-destructive" />
              </div>
              <div>
                <p className="font-semibold text-destructive">{stats.docsReprovados} documento(s) reprovado(s)</p>
                <p className="text-sm text-destructive/70">Reenvie para continuar operando</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-500/20">
                <Wallet size={18} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Saldo Disponivel</span>
            </div>
            <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{formatCurrency(stats.saldoDisponivel)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-500/20">
                <TrendingUp size={18} className="text-purple-600 dark:text-purple-400" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Volume Ativo</span>
            </div>
            <p className="text-3xl font-bold text-purple-700 dark:text-purple-400 tabular-nums">{formatCurrency(stats.volumeAtivo)}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats.opsAtivas} operacao(es)</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-500/20">
                <Receipt size={18} className="text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">NFs Disponiveis</span>
            </div>
            <p className="text-3xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">{stats.nfsAprovadas}</p>
            <p className="text-xs text-muted-foreground mt-1">de {stats.nfsTotal} total</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Operacoes recentes */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Operacoes Recentes</CardTitle>
            <Link href="/cedente/operacoes" className="text-sm text-primary hover:text-primary/80 flex items-center gap-1 font-medium">
              Ver todas <ArrowRight size={14} />
            </Link>
          </CardHeader>
          <CardContent>
            {opsRecentes.length === 0 ? (
              <div className="text-center py-8">
                <Receipt size={32} className="text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">Nenhuma operacao ainda</p>
                <Link href="/cedente/operacoes/nova">
                  <Button variant="outline" size="sm" className="mt-3 gap-1.5">
                    <Plus size={14} /> Criar primeira
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-1">
                {opsRecentes.map((op) => {
                  const st = statusConfig[op.status]
                  return (
                    <div key={op.id} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground">#{op.id.substring(0, 8)}</span>
                          <Badge variant={st?.variant || 'secondary'}>
                            {st?.label || op.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">Venc: {formatDate(op.data_vencimento)}</p>
                      </div>
                      <p className="text-sm font-bold tabular-nums">{formatCurrency(op.valor_bruto_total)}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Links rapidos */}
        <div className="space-y-3">
          {[
            { label: 'Meus Documentos', href: '/cedente/documentos', icon: FileCheck, color: 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400' },
            { label: 'Minhas NFs', href: '/cedente/notas-fiscais', icon: Receipt, color: 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400' },
            { label: 'Minhas Operacoes', href: '/cedente/operacoes', icon: Banknote, color: 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400' },
            ...(stats.habilitarEscrow ? [{ label: 'Extrato Escrow', href: '/cedente/extrato', icon: Wallet, color: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' }] : []),
          ].map((item) => (
            <Link key={item.href} href={item.href}>
              <Card className="hover:ring-2 hover:ring-primary/20 transition-all cursor-pointer group">
                <CardContent className="flex items-center justify-between py-4">
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
    </div>
  )
}
