'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
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
  CheckCircle,
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

  const statusLabels: Record<string, { label: string; color: string }> = {
    solicitada: { label: 'Solicitada', color: 'bg-blue-100 text-blue-700' },
    em_andamento: { label: 'Em Andamento', color: 'bg-purple-100 text-purple-700' },
    liquidada: { label: 'Liquidada', color: 'bg-green-100 text-green-700' },
    inadimplente: { label: 'Inadimplente', color: 'bg-red-100 text-red-700' },
    reprovada: { label: 'Reprovada', color: 'bg-red-100 text-red-700' },
    cancelada: { label: 'Cancelada', color: 'bg-gray-100 text-gray-600' },
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard do Gestor</h1>
        <p className="text-gray-500">Visao geral do sistema.</p>
      </div>

      {/* Alertas */}
      {(stats.opsInadimplentes > 0 || stats.opsSolicitadas > 0 || stats.docsPendentes > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          {stats.opsInadimplentes > 0 && (
            <Link href="/gestor/operacoes" className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 hover:bg-red-100">
              <AlertTriangle size={20} className="text-red-600" />
              <div>
                <p className="font-bold text-red-700">{stats.opsInadimplentes} operacao(es) inadimplente(s)</p>
                <p className="text-xs text-red-600">Requer atencao urgente</p>
              </div>
            </Link>
          )}
          {stats.opsSolicitadas > 0 && (
            <Link href="/gestor/operacoes" className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center gap-3 hover:bg-yellow-100">
              <Clock size={20} className="text-yellow-600" />
              <div>
                <p className="font-bold text-yellow-700">{stats.opsSolicitadas} operacao(es) aguardando analise</p>
              </div>
            </Link>
          )}
          {stats.docsPendentes > 0 && (
            <Link href="/gestor/cedentes" className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3 hover:bg-blue-100">
              <FileText size={20} className="text-blue-600" />
              <div>
                <p className="font-bold text-blue-700">{stats.docsPendentes} documento(s) para analisar</p>
              </div>
            </Link>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Users size={18} className="text-blue-600" />
            <span className="text-xs text-gray-500">Cedentes</span>
          </div>
          <p className="text-2xl font-bold">{stats.totalCedentes}</p>
          <p className="text-xs text-green-600">{stats.cedentesAtivos} ativos</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard size={18} className="text-purple-600" />
            <span className="text-xs text-gray-500">Ops Ativas</span>
          </div>
          <p className="text-2xl font-bold text-purple-700">{stats.opsAtivas}</p>
          <p className="text-xs text-gray-400">{formatCurrency(stats.volumeAtivo)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={18} className="text-green-600" />
            <span className="text-xs text-gray-500">Volume Mes</span>
          </div>
          <p className="text-2xl font-bold text-green-700">{formatCurrency(stats.volumeMes)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet size={18} className="text-amber-600" />
            <span className="text-xs text-gray-500">Custodia Escrow</span>
          </div>
          <p className="text-2xl font-bold text-amber-700">{formatCurrency(stats.saldoEscrowTotal)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Operacoes recentes */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Operacoes Recentes</h2>
            <Link href="/gestor/operacoes" className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
              Ver todas <ArrowRight size={14} />
            </Link>
          </div>
          {opsRecentes.length === 0 ? (
            <p className="text-gray-500 text-sm">Nenhuma operacao.</p>
          ) : (
            <div className="space-y-2">
              {opsRecentes.map((op) => {
                const st = statusLabels[op.status]
                return (
                  <Link key={op.id} href={`/gestor/operacoes/${op.id}`}
                    className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded">
                    <div>
                      <p className="text-sm font-medium">{op.cedentes.razao_social}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">{formatDate(op.created_at)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${st?.color || 'bg-gray-100'}`}>
                          {st?.label || op.status}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm font-bold">{formatCurrency(op.valor_bruto_total)}</p>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Links rapidos */}
        <div className="space-y-3">
          {[
            { label: 'Cedentes', href: '/gestor/cedentes', icon: Users, color: 'bg-blue-100 text-blue-600', desc: `${stats.totalCedentes} cadastrados` },
            { label: 'Notas Fiscais', href: '/gestor/notas-fiscais', icon: Receipt, color: 'bg-purple-100 text-purple-600', desc: `${stats.nfsPendentes} pendentes` },
            { label: 'Operacoes', href: '/gestor/operacoes', icon: CreditCard, color: 'bg-amber-100 text-amber-600', desc: `${stats.opsSolicitadas} aguardando` },
            { label: 'Contas Escrow', href: '/gestor/escrow', icon: Wallet, color: 'bg-green-100 text-green-600', desc: formatCurrency(stats.saldoEscrowTotal) },
            { label: 'Auditoria', href: '/gestor/auditoria', icon: FileText, color: 'bg-gray-100 text-gray-600', desc: 'Logs completos' },
          ].map((item) => (
            <Link key={item.href} href={item.href}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center justify-between hover:border-blue-300 transition-colors group">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${item.color}`}><item.icon size={18} /></div>
                <div>
                  <span className="font-medium text-gray-900">{item.label}</span>
                  <p className="text-xs text-gray-400">{item.desc}</p>
                </div>
              </div>
              <ArrowRight size={18} className="text-gray-300 group-hover:text-blue-500" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
