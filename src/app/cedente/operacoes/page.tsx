'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cancelarOperacao } from '@/lib/actions/operacao'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  Plus,
  Eye,
  XCircle,
  Clock,
  CheckCircle,
  AlertCircle,
  Banknote,
  Search,
  Filter,
} from 'lucide-react'

interface OperacaoRecord {
  id: string
  valor_bruto_total: number
  taxa_desconto: number
  prazo_dias: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: string
  created_at: string
  motivo_reprovacao: string | null
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  solicitada: { label: 'Solicitada', color: 'bg-blue-100 text-blue-700', icon: Clock },
  em_analise: { label: 'Em Analise', color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle },
  aprovada: { label: 'Aprovada', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  em_andamento: { label: 'Em Andamento', color: 'bg-purple-100 text-purple-700', icon: Banknote },
  liquidada: { label: 'Liquidada', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  inadimplente: { label: 'Inadimplente', color: 'bg-red-100 text-red-700', icon: AlertCircle },
  reprovada: { label: 'Reprovada', color: 'bg-red-100 text-red-700', icon: XCircle },
  cancelada: { label: 'Cancelada', color: 'bg-gray-100 text-gray-600', icon: XCircle },
}

export default function OperacoesCedentePage() {
  const [ops, setOps] = useState<OperacaoRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const loadOps = async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('operacoes')
      .select('id, valor_bruto_total, taxa_desconto, prazo_dias, valor_liquido_desembolso, data_vencimento, status, created_at, motivo_reprovacao')
      .order('created_at', { ascending: false })

    setOps((data || []) as OperacaoRecord[])
    setLoading(false)
  }

  useEffect(() => { loadOps() }, [])

  const handleCancel = async (id: string) => {
    setCancelling(id)
    const result = await cancelarOperacao(id)
    if (result?.success) {
      setMessage(result.message || 'Cancelada.')
      await loadOps()
    } else {
      setMessage(result?.message || 'Erro.')
    }
    setCancelling(null)
  }

  const opsFiltradas = filtroStatus === 'todos' ? ops : ops.filter((o) => o.status === filtroStatus)

  const valorAtivo = ops
    .filter((o) => o.status === 'em_andamento')
    .reduce((acc, o) => acc + o.valor_liquido_desembolso, 0)

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Minhas Operacoes</h1>
          <p className="text-gray-500">Acompanhe suas solicitacoes de antecipacao.</p>
        </div>
        <Link
          href="/cedente/operacoes/nova"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          <Plus size={16} />
          Nova Solicitacao
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs font-medium text-blue-600">Total</p>
          <p className="text-2xl font-bold text-blue-700">{ops.length}</p>
        </div>
        <div className="bg-yellow-50 rounded-xl p-4">
          <p className="text-xs font-medium text-yellow-600">Pendentes</p>
          <p className="text-2xl font-bold text-yellow-700">{ops.filter((o) => o.status === 'solicitada' || o.status === 'em_analise').length}</p>
        </div>
        <div className="bg-purple-50 rounded-xl p-4">
          <p className="text-xs font-medium text-purple-600">Em Andamento</p>
          <p className="text-2xl font-bold text-purple-700">{ops.filter((o) => o.status === 'em_andamento').length}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs font-medium text-green-600">Valor Ativo</p>
          <p className="text-2xl font-bold text-green-700">{formatCurrency(valorAtivo)}</p>
        </div>
      </div>

      {message && (
        <div className="mb-4 p-3 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200">{message}</div>
      )}

      {/* Filtro */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="relative">
          <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white appearance-none"
          >
            <option value="todos">Todos</option>
            <option value="solicitada">Solicitadas</option>
            <option value="em_andamento">Em Andamento</option>
            <option value="liquidada">Liquidadas</option>
            <option value="reprovada">Reprovadas</option>
            <option value="cancelada">Canceladas</option>
          </select>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : opsFiltradas.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <Banknote size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Nenhuma operacao encontrada.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {opsFiltradas.map((op) => {
            const status = statusConfig[op.status] || statusConfig.solicitada
            const StatusIcon = status.icon
            const canCancel = op.status === 'solicitada' || op.status === 'em_analise'

            return (
              <div key={op.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-sm font-mono text-gray-400">#{op.id.substring(0, 8)}</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                        <StatusIcon size={12} />
                        {status.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500 text-xs">Valor Bruto</span>
                        <p className="font-bold">{formatCurrency(op.valor_bruto_total)}</p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Taxa</span>
                        <p className="font-medium">{op.taxa_desconto > 0 ? `${op.taxa_desconto}% a.m.` : 'A definir'}</p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Prazo</span>
                        <p className="font-medium">{op.prazo_dias} dias</p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Valor Liquido</span>
                        <p className="font-bold text-green-700">{formatCurrency(op.valor_liquido_desembolso)}</p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Vencimento</span>
                        <p className="font-medium">{formatDate(op.data_vencimento)}</p>
                      </div>
                    </div>
                    {op.motivo_reprovacao && (
                      <p className="mt-2 text-sm text-red-600">Motivo: {op.motivo_reprovacao}</p>
                    )}
                  </div>
                  <div className="flex gap-2 ml-4">
                    {canCancel && (
                      <button
                        onClick={() => handleCancel(op.id)}
                        disabled={cancelling === op.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50"
                      >
                        <XCircle size={14} />
                        {cancelling === op.id ? 'Cancelando...' : 'Cancelar'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  Criada em {formatDate(op.created_at)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
