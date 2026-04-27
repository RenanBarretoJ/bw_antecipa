'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate, parseLocalDate } from '@/lib/utils'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Receipt,
  CheckSquare,
  AlertTriangle,
  Calendar,
  Building2,
  Wallet,
  Clock,
  ArrowRight,
  CreditCard,
} from 'lucide-react'

interface NfSacado {
  id: string
  numero_nf: string
  cnpj_emitente: string
  razao_social_emitente: string
  valor_bruto: number
  data_vencimento: string
  status: string
  cedente_id: string
}

interface OperacaoSacado {
  id: string
  valor_bruto_total: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: string
  cedentes: { razao_social: string; cnpj: string }
  contas_escrow: { identificador: string } | null
}

interface VencimentoDia {
  data: string
  nfs: NfSacado[]
  total: number
}

interface CedenteAgrupado {
  cnpj: string
  razao_social: string
  nfs: NfSacado[]
  totalDevido: number
  proximoVencimento: string
  contaEscrow: string | null
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

export default function SacadoDashboard() {
  const [nfs, setNfs] = useState<NfSacado[]>([])
  const [operacoes, setOperacoes] = useState<OperacaoSacado[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const { data: nfsData } = await supabase
        .from('notas_fiscais')
        .select('id, numero_nf, cnpj_emitente, razao_social_emitente, valor_bruto, data_vencimento, status, cedente_id')
        .in('status', ['em_antecipacao', 'aprovada', 'liquidada'])
        .order('data_vencimento', { ascending: true })

      setNfs((nfsData || []) as NfSacado[])

      const { data: opsData } = await supabase
        .from('operacoes')
        .select('id, valor_bruto_total, valor_liquido_desembolso, data_vencimento, status, cedentes(razao_social, cnpj), contas_escrow(identificador)')
        .in('status', ['em_andamento', 'liquidada', 'inadimplente'])
        .order('data_vencimento', { ascending: true })

      setOperacoes((opsData || []) as OperacaoSacado[])
      setLoading(false)
    }
    load()
  }, [])

  const cedenteMap = new Map<string, CedenteAgrupado>()
  const nfsAtivas = nfs.filter((n) => n.status === 'em_antecipacao')

  for (const nf of nfsAtivas) {
    const key = nf.cnpj_emitente
    if (!cedenteMap.has(key)) {
      const op = operacoes.find((o) => o.cedentes?.cnpj === nf.cnpj_emitente)
      cedenteMap.set(key, {
        cnpj: nf.cnpj_emitente,
        razao_social: nf.razao_social_emitente,
        nfs: [],
        totalDevido: 0,
        proximoVencimento: nf.data_vencimento,
        contaEscrow: op?.contas_escrow?.identificador || null,
      })
    }
    const c = cedenteMap.get(key)!
    c.nfs.push(nf)
    c.totalDevido += nf.valor_bruto
    if (nf.data_vencimento < c.proximoVencimento) {
      c.proximoVencimento = nf.data_vencimento
    }
  }
  const cedentesAgrupados = Array.from(cedenteMap.values())
    .sort((a, b) => a.proximoVencimento.localeCompare(b.proximoVencimento))

  const vencimentoMap = new Map<string, VencimentoDia>()
  for (const nf of nfsAtivas) {
    const data = nf.data_vencimento
    if (!vencimentoMap.has(data)) {
      vencimentoMap.set(data, { data, nfs: [], total: 0 })
    }
    const v = vencimentoMap.get(data)!
    v.nfs.push(nf)
    v.total += nf.valor_bruto
  }
  const vencimentos = Array.from(vencimentoMap.values())
    .sort((a, b) => a.data.localeCompare(b.data))

  const totalDevido = nfsAtivas.reduce((acc, n) => acc + n.valor_bruto, 0)
  const hoje = new Date().toISOString().split('T')[0]
  const vencimentosHoje = nfsAtivas.filter((n) => n.data_vencimento === hoje)
  const vencidos = nfsAtivas.filter((n) => n.data_vencimento < hoje)
  const proximos7d = nfsAtivas.filter((n) => {
    const venc = parseLocalDate(n.data_vencimento)
    const em7d = new Date()
    em7d.setDate(em7d.getDate() + 7)
    return venc >= parseLocalDate(hoje) && venc <= em7d
  })

  const getDiasAteVencimento = (data: string) => {
    return Math.ceil((parseLocalDate(data).getTime() - parseLocalDate(hoje).getTime()) / (1000 * 60 * 60 * 24))
  }

  const getVencimentoColor = (data: string) => {
    const dias = getDiasAteVencimento(data)
    if (dias <= 0) return 'border-destructive/30 bg-destructive/5'
    if (dias <= 5) return 'border-amber-300/50 bg-amber-50 dark:bg-amber-500/10'
    return 'border-emerald-300/50 bg-emerald-50 dark:bg-emerald-500/10'
  }

  const getVencimentoLabel = (data: string) => {
    const dias = getDiasAteVencimento(data)
    if (dias < 0) return `${Math.abs(dias)}d atrasado`
    if (dias === 0) return 'Hoje'
    if (dias === 1) return 'Amanha'
    return `em ${dias}d`
  }

  const getVencimentoBadge = (data: string): 'destructive' | 'outline' | 'secondary' => {
    const dias = getDiasAteVencimento(data)
    if (dias <= 0) return 'destructive'
    if (dias <= 5) return 'outline'
    return 'secondary'
  }

  if (loading) return <DashboardSkeleton />

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard do Sacado</h1>
        <p className="text-muted-foreground text-sm">Acompanhe seus pagamentos e vencimentos</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-500/20"><CreditCard size={16} className="text-blue-600 dark:text-blue-400" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total a Pagar</span>
            </div>
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">{formatCurrency(totalDevido)}</p>
            <p className="text-xs text-muted-foreground mt-1">{nfsAtivas.length} NF(s) ativas</p>
          </CardContent>
        </Card>

        <Card className={vencidos.length > 0 ? 'border-destructive/30 bg-destructive/5' : ''}>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className={`p-2 rounded-lg ${vencidos.length > 0 ? 'bg-destructive/15' : 'bg-red-100 dark:bg-red-500/20'}`}>
                <AlertTriangle size={16} className="text-destructive" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Vencidos</span>
            </div>
            <p className="text-2xl font-bold text-destructive tabular-nums">{vencidos.length}</p>
            {vencidos.length > 0 && (
              <p className="text-xs text-destructive/80 mt-1">{formatCurrency(vencidos.reduce((a, n) => a + n.valor_bruto, 0))}</p>
            )}
          </CardContent>
        </Card>

        <Card className={vencimentosHoje.length > 0 ? 'border-amber-300/50 bg-amber-50 dark:bg-amber-500/10' : ''}>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-500/20"><Calendar size={16} className="text-amber-600 dark:text-amber-400" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Vencem Hoje</span>
            </div>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">{vencimentosHoje.length}</p>
            {vencimentosHoje.length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{formatCurrency(vencimentosHoje.reduce((a, n) => a + n.valor_bruto, 0))}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-500/20"><Clock size={16} className="text-purple-600 dark:text-purple-400" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Proximos 7d</span>
            </div>
            <p className="text-2xl font-bold text-purple-700 dark:text-purple-400 tabular-nums">{proximos7d.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{formatCurrency(proximos7d.reduce((a, n) => a + n.valor_bruto, 0))}</p>
          </CardContent>
        </Card>
      </div>

      {/* Calendario de vencimentos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar size={20} className="text-primary" />
            Calendario de Vencimentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {vencimentos.length === 0 ? (
            <div className="text-center py-8">
              <Calendar size={32} className="text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">Nenhum vencimento pendente</p>
            </div>
          ) : (
            <div className="space-y-3">
              {vencimentos.map((v) => (
                <div key={v.data} className={`rounded-xl border p-4 ${getVencimentoColor(v.data)}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-foreground">{formatDate(v.data)}</span>
                      <Badge variant={getVencimentoBadge(v.data)}>
                        {getVencimentoLabel(v.data)}
                      </Badge>
                    </div>
                    <span className="font-bold text-foreground tabular-nums">{formatCurrency(v.total)}</span>
                  </div>
                  <div className="space-y-1.5">
                    {v.nfs.map((nf) => (
                      <div key={nf.id} className="flex items-center justify-between text-sm bg-card/60 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Receipt size={14} className="text-muted-foreground" />
                          <span className="font-medium">NF {nf.numero_nf}</span>
                          <span className="text-xs text-muted-foreground hidden sm:inline">— {nf.razao_social_emitente}</span>
                        </div>
                        <span className="font-medium tabular-nums">{formatCurrency(nf.valor_bruto)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagamentos por cedente */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 size={20} className="text-primary" />
            Pagamentos por Cedente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cedentesAgrupados.length === 0 ? (
            <div className="text-center py-8">
              <Building2 size={32} className="text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">Nenhum pagamento pendente</p>
            </div>
          ) : (
            <div className="space-y-4">
              {cedentesAgrupados.map((ced) => (
                <div key={ced.cnpj} className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-muted/50 px-5 py-4 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{ced.razao_social}</p>
                      <p className="text-xs text-muted-foreground font-mono">{formatCNPJ(ced.cnpj)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-foreground tabular-nums">{formatCurrency(ced.totalDevido)}</p>
                      <p className="text-xs text-muted-foreground">{ced.nfs.length} NF(s)</p>
                    </div>
                  </div>

                  {ced.contaEscrow && (
                    <div className="px-5 py-3 bg-primary/5 border-t border-primary/10 flex items-center gap-2">
                      <Wallet size={16} className="text-primary" />
                      <span className="text-sm text-primary">
                        Pagar na conta escrow: <strong className="font-mono">{ced.contaEscrow}</strong>
                      </span>
                    </div>
                  )}

                  <div className="divide-y divide-border/50">
                    {ced.nfs
                      .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))
                      .map((nf) => (
                        <div key={nf.id} className="px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                          <div className="flex items-center gap-3">
                            <Receipt size={16} className="text-muted-foreground" />
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">NF {nf.numero_nf}</span>
                              <Badge variant={getVencimentoBadge(nf.data_vencimento)}>
                                {getVencimentoLabel(nf.data_vencimento)}
                              </Badge>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold tabular-nums">{formatCurrency(nf.valor_bruto)}</p>
                            <p className="text-xs text-muted-foreground">{formatDate(nf.data_vencimento)}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Links rapidos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'NFs Recebidas', href: '/sacado/notas-fiscais', icon: Receipt, color: 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400' },
          { label: 'Aprovação de Cessão', href: '/sacado/aprovacao', icon: CheckSquare, color: 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400' },
          { label: 'Historico Pagamentos', href: '/sacado/pagamentos', icon: Wallet, color: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' },
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
