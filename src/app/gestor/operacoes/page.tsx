'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  Eye,
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  Banknote,
  Filter,
  Search,
} from 'lucide-react'

interface OperacaoGestor {
  id: string
  valor_bruto_total: number
  taxa_desconto: number
  prazo_dias: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: string
  created_at: string
  cedentes: {
    razao_social: string
    cnpj: string
  }
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

export default function OperacoesGestorPage() {
  const [ops, setOps] = useState<OperacaoGestor[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('solicitada')
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('operacoes')
        .select('id, valor_bruto_total, taxa_desconto, prazo_dias, valor_liquido_desembolso, data_vencimento, status, created_at, cedentes(razao_social, cnpj)')
        .order('created_at', { ascending: false })

      setOps((data || []) as OperacaoGestor[])
      setLoading(false)
    }
    load()
  }, [])

  const opsFiltradas = ops.filter((op) => {
    if (filtroStatus !== 'todos' && op.status !== filtroStatus) return false
    if (busca) {
      const term = busca.toLowerCase()
      return (
        op.cedentes.razao_social.toLowerCase().includes(term) ||
        op.cedentes.cnpj.includes(term) ||
        op.id.includes(term)
      )
    }
    return true
  })

  const pendentes = ops.filter((o) => o.status === 'solicitada' || o.status === 'em_analise').length
  const volumeAtivo = ops
    .filter((o) => o.status === 'em_andamento')
    .reduce((acc, o) => acc + o.valor_liquido_desembolso, 0)

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Operacoes</h1>
        <p className="text-gray-500">Gerencie as solicitacoes de antecipacao.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-yellow-50 rounded-xl p-4">
          <p className="text-xs font-medium text-yellow-600">Pendentes</p>
          <p className="text-2xl font-bold text-yellow-700">{pendentes}</p>
        </div>
        <div className="bg-purple-50 rounded-xl p-4">
          <p className="text-xs font-medium text-purple-600">Em Andamento</p>
          <p className="text-2xl font-bold text-purple-700">{ops.filter((o) => o.status === 'em_andamento').length}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs font-medium text-green-600">Volume Ativo</p>
          <p className="text-2xl font-bold text-green-700">{formatCurrency(volumeAtivo)}</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs font-medium text-blue-600">Total Operacoes</p>
          <p className="text-2xl font-bold text-blue-700">{ops.length}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por cedente, CNPJ ou ID..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white appearance-none"
            >
              <option value="todos">Todos</option>
              <option value="solicitada">Solicitadas (pendentes)</option>
              <option value="em_andamento">Em Andamento</option>
              <option value="liquidada">Liquidadas</option>
              <option value="inadimplente">Inadimplentes</option>
              <option value="reprovada">Reprovadas</option>
              <option value="cancelada">Canceladas</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tabela */}
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">ID</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Cedente</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Valor Bruto</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Taxa</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Prazo</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Liquido</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {opsFiltradas.map((op) => {
                  const status = statusConfig[op.status] || statusConfig.solicitada
                  const StatusIcon = status.icon
                  return (
                    <tr key={op.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-sm text-gray-500">{op.id.substring(0, 8)}</td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{op.cedentes.razao_social}</p>
                        <p className="text-xs text-gray-400">{formatCNPJ(op.cedentes.cnpj)}</p>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">{formatCurrency(op.valor_bruto_total)}</td>
                      <td className="px-4 py-3 text-sm">{op.taxa_desconto > 0 ? `${op.taxa_desconto}%` : '—'}</td>
                      <td className="px-4 py-3 text-sm">{op.prazo_dias}d</td>
                      <td className="px-4 py-3 text-sm font-bold text-green-700">{formatCurrency(op.valor_liquido_desembolso)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                          <StatusIcon size={12} />
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/gestor/operacoes/${op.id}`}
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                        >
                          <Eye size={14} />
                          {op.status === 'solicitada' ? 'Analisar' : 'Ver'}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
