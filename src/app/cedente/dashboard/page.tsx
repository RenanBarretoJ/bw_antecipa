'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  FileCheck,
  Receipt,
  Banknote,
  Wallet,
  ArrowRight,
  AlertTriangle,
  Clock,
  Plus,
  TrendingUp,
} from 'lucide-react'

interface CedenteStats {
  saldoDisponivel: number
  saldoBloqueado: number
  contaEscrow: string | null
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

export default function CedenteDashboard() {
  const [stats, setStats] = useState<CedenteStats>({
    saldoDisponivel: 0, saldoBloqueado: 0, contaEscrow: null,
    nfsAprovadas: 0, nfsTotal: 0, opsAtivas: 0, opsPendentes: 0,
    volumeAtivo: 0, docsReprovados: 0,
  })
  const [opsRecentes, setOpsRecentes] = useState<OperacaoRecente[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const [escrow, nfs, ops, docs] = await Promise.all([
        supabase.from('contas_escrow').select('saldo_disponivel, saldo_bloqueado, identificador').limit(1),
        supabase.from('notas_fiscais').select('id, status'),
        supabase.from('operacoes')
          .select('id, valor_bruto_total, valor_liquido_desembolso, status, data_vencimento, created_at')
          .order('created_at', { ascending: false }),
        supabase.from('documentos').select('id, status').eq('status', 'reprovado'),
      ])

      const escrowData = (escrow.data || []) as Array<{ saldo_disponivel: number; saldo_bloqueado: number; identificador: string }>
      const nfsData = (nfs.data || []) as Array<{ id: string; status: string }>
      const opsData = (ops.data || []) as OperacaoRecente[]

      const opsAtivas = opsData.filter((o) => o.status === 'em_andamento')
      const opsPendentes = opsData.filter((o) => o.status === 'solicitada' || o.status === 'em_analise')

      setStats({
        saldoDisponivel: escrowData[0]?.saldo_disponivel || 0,
        saldoBloqueado: escrowData[0]?.saldo_bloqueado || 0,
        contaEscrow: escrowData[0]?.identificador || null,
        nfsAprovadas: nfsData.filter((n) => n.status === 'aprovada').length,
        nfsTotal: nfsData.length,
        opsAtivas: opsAtivas.length,
        opsPendentes: opsPendentes.length,
        volumeAtivo: opsAtivas.reduce((a, o) => a + o.valor_liquido_desembolso, 0),
        docsReprovados: (docs.data || []).length,
      })
      setOpsRecentes(opsData.slice(0, 5))
      setLoading(false)
    }
    load()
  }, [])

  const statusLabels: Record<string, { label: string; color: string }> = {
    solicitada: { label: 'Solicitada', color: 'bg-blue-100 text-blue-700' },
    em_analise: { label: 'Em Analise', color: 'bg-yellow-100 text-yellow-700' },
    em_andamento: { label: 'Em Andamento', color: 'bg-purple-100 text-purple-700' },
    liquidada: { label: 'Liquidada', color: 'bg-green-100 text-green-700' },
    reprovada: { label: 'Reprovada', color: 'bg-red-100 text-red-700' },
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          {stats.contaEscrow && (
            <p className="text-sm text-gray-500">Conta Escrow: <span className="font-mono">{stats.contaEscrow}</span></p>
          )}
        </div>
        <Link href="/cedente/operacoes/nova"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
          <Plus size={16} /> Nova Antecipacao
        </Link>
      </div>

      {/* Alertas */}
      {stats.docsReprovados > 0 && (
        <Link href="/cedente/documentos" className="mb-6 block bg-red-50 border border-red-200 rounded-xl p-4 hover:bg-red-100">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-red-600" />
            <p className="font-medium text-red-700">{stats.docsReprovados} documento(s) reprovado(s) — reenvie para continuar</p>
          </div>
        </Link>
      )}

      {/* Saldo Escrow */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-green-100 rounded-lg"><Wallet size={18} className="text-green-600" /></div>
            <span className="text-xs text-gray-500">Saldo Disponivel</span>
          </div>
          <p className="text-3xl font-bold text-green-700">{formatCurrency(stats.saldoDisponivel)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-purple-100 rounded-lg"><TrendingUp size={18} className="text-purple-600" /></div>
            <span className="text-xs text-gray-500">Volume Ativo</span>
          </div>
          <p className="text-3xl font-bold text-purple-700">{formatCurrency(stats.volumeAtivo)}</p>
          <p className="text-xs text-gray-400 mt-1">{stats.opsAtivas} operacao(es)</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-blue-100 rounded-lg"><Receipt size={18} className="text-blue-600" /></div>
            <span className="text-xs text-gray-500">NFs Disponiveis</span>
          </div>
          <p className="text-3xl font-bold text-blue-700">{stats.nfsAprovadas}</p>
          <p className="text-xs text-gray-400 mt-1">de {stats.nfsTotal} total</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Operacoes recentes */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Operacoes Recentes</h2>
            <Link href="/cedente/operacoes" className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
              Ver todas <ArrowRight size={14} />
            </Link>
          </div>
          {opsRecentes.length === 0 ? (
            <p className="text-gray-500 text-sm">Nenhuma operacao ainda.</p>
          ) : (
            <div className="space-y-2">
              {opsRecentes.map((op) => {
                const st = statusLabels[op.status]
                return (
                  <div key={op.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-gray-400">#{op.id.substring(0, 8)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${st?.color || 'bg-gray-100'}`}>
                          {st?.label || op.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">Venc: {formatDate(op.data_vencimento)}</p>
                    </div>
                    <p className="text-sm font-bold">{formatCurrency(op.valor_bruto_total)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Links rapidos */}
        <div className="space-y-3">
          {[
            { label: 'Meus Documentos', href: '/cedente/documentos', icon: FileCheck, color: 'bg-blue-100 text-blue-600' },
            { label: 'Minhas NFs', href: '/cedente/notas-fiscais', icon: Receipt, color: 'bg-purple-100 text-purple-600' },
            { label: 'Minhas Operacoes', href: '/cedente/operacoes', icon: Banknote, color: 'bg-amber-100 text-amber-600' },
            { label: 'Extrato Escrow', href: '/cedente/extrato', icon: Wallet, color: 'bg-green-100 text-green-600' },
          ].map((item) => (
            <Link key={item.href} href={item.href}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center justify-between hover:border-blue-300 transition-colors group">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${item.color}`}><item.icon size={18} /></div>
                <span className="font-medium text-gray-900">{item.label}</span>
              </div>
              <ArrowRight size={18} className="text-gray-300 group-hover:text-blue-500" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
