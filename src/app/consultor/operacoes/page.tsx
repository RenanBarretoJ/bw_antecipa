'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import {
  CreditCard,
  Search,
  Filter,
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  Banknote,
} from 'lucide-react'

interface OperacaoConsultor {
  id: string
  valor_bruto_total: number
  taxa_desconto: number
  prazo_dias: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: string
  created_at: string
  cedentes: { razao_social: string; cnpj: string }
}

const statusConfig: Record<string, { label: string; color: string }> = {
  solicitada: { label: 'Solicitada', color: 'bg-blue-100 text-blue-700' },
  em_analise: { label: 'Em Analise', color: 'bg-yellow-100 text-yellow-700' },
  em_andamento: { label: 'Em Andamento', color: 'bg-purple-100 text-purple-700' },
  liquidada: { label: 'Liquidada', color: 'bg-green-100 text-green-700' },
  inadimplente: { label: 'Inadimplente', color: 'bg-red-100 text-red-700' },
  reprovada: { label: 'Reprovada', color: 'bg-red-100 text-red-700' },
  cancelada: { label: 'Cancelada', color: 'bg-gray-100 text-gray-600' },
}

export default function OperacoesConsultorPage() {
  const [operacoes, setOperacoes] = useState<OperacaoConsultor[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('operacoes')
        .select('id, valor_bruto_total, taxa_desconto, prazo_dias, valor_liquido_desembolso, data_vencimento, status, created_at, cedentes(razao_social, cnpj)')
        .order('created_at', { ascending: false })

      setOperacoes((data || []) as OperacaoConsultor[])
      setLoading(false)
    }
    load()
  }, [])

  const opsFiltradas = operacoes.filter((op) => {
    if (filtroStatus !== 'todos' && op.status !== filtroStatus) return false
    if (busca) {
      const term = busca.toLowerCase()
      return op.cedentes.razao_social.toLowerCase().includes(term) || op.cedentes.cnpj.includes(term)
    }
    return true
  })

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Operacoes</h1>
        <p className="text-gray-500">Visualizacao das operacoes dos cedentes da carteira (somente leitura).</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Buscar por cedente..." value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="todos">Todos</option>
            <option value="em_andamento">Em Andamento</option>
            <option value="liquidada">Liquidadas</option>
            <option value="solicitada">Solicitadas</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : opsFiltradas.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <CreditCard size={48} className="mx-auto text-gray-300 mb-3" />
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
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">Bruto</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Taxa</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">Liquido</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Vencimento</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {opsFiltradas.map((op) => {
                  const st = statusConfig[op.status]
                  return (
                    <tr key={op.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-sm text-gray-500">{op.id.substring(0, 8)}</td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium">{op.cedentes.razao_social}</p>
                        <p className="text-xs text-gray-400">{formatCNPJ(op.cedentes.cnpj)}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium">{formatCurrency(op.valor_bruto_total)}</td>
                      <td className="px-4 py-3 text-sm">{op.taxa_desconto > 0 ? `${op.taxa_desconto}%` : '—'}</td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-green-700">{formatCurrency(op.valor_liquido_desembolso)}</td>
                      <td className="px-4 py-3 text-sm">{formatDate(op.data_vencimento)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st?.color || 'bg-gray-100'}`}>
                          {st?.label || op.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDate(op.created_at)}</td>
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
