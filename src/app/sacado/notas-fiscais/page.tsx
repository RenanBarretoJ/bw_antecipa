'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import { Receipt, Search, Filter, CheckCircle, Clock, AlertCircle, Banknote } from 'lucide-react'

interface NfSacado {
  id: string
  numero_nf: string
  cnpj_emitente: string
  razao_social_emitente: string
  valor_bruto: number
  data_emissao: string
  data_vencimento: string
  status: string
}

const statusConfig: Record<string, { label: string; color: string }> = {
  aprovada: { label: 'Aprovada', color: 'bg-green-100 text-green-700' },
  em_antecipacao: { label: 'Cedida (Em Antecipacao)', color: 'bg-purple-100 text-purple-700' },
  liquidada: { label: 'Liquidada', color: 'bg-emerald-100 text-emerald-700' },
  cancelada: { label: 'Cancelada', color: 'bg-red-100 text-red-700' },
}

export default function NfsRecebidasSacadoPage() {
  const [nfs, setNfs] = useState<NfSacado[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('notas_fiscais')
        .select('id, numero_nf, cnpj_emitente, razao_social_emitente, valor_bruto, data_emissao, data_vencimento, status')
        .order('data_vencimento', { ascending: true })

      setNfs((data || []) as NfSacado[])
      setLoading(false)
    }
    load()
  }, [])

  const nfsFiltradas = nfs.filter((nf) => {
    if (filtroStatus !== 'todos' && nf.status !== filtroStatus) return false
    if (busca) {
      const term = busca.toLowerCase()
      return nf.numero_nf.includes(term) || nf.razao_social_emitente.toLowerCase().includes(term) || nf.cnpj_emitente.includes(term)
    }
    return true
  })

  const hoje = new Date().toISOString().split('T')[0]

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">NFs Recebidas</h1>
        <p className="text-gray-500">Notas fiscais emitidas contra voce.</p>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs font-medium text-blue-600">Total NFs</p>
          <p className="text-2xl font-bold text-blue-700">{nfs.length}</p>
        </div>
        <div className="bg-purple-50 rounded-xl p-4">
          <p className="text-xs font-medium text-purple-600">Cedidas</p>
          <p className="text-2xl font-bold text-purple-700">{nfs.filter((n) => n.status === 'em_antecipacao').length}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs font-medium text-green-600">Liquidadas</p>
          <p className="text-2xl font-bold text-green-700">{nfs.filter((n) => n.status === 'liquidada').length}</p>
        </div>
        <div className="bg-red-50 rounded-xl p-4">
          <p className="text-xs font-medium text-red-600">Vencidas</p>
          <p className="text-2xl font-bold text-red-700">{nfs.filter((n) => n.status === 'em_antecipacao' && n.data_vencimento < hoje).length}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Buscar por numero, cedente ou CNPJ..."
              value={busca} onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="todos">Todos</option>
            <option value="em_antecipacao">Cedidas (a pagar)</option>
            <option value="liquidada">Liquidadas</option>
            <option value="aprovada">Aprovadas</option>
          </select>
        </div>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : nfsFiltradas.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <Receipt size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Nenhuma NF encontrada.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">NF</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Cedente (Emitente)</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">Valor</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Emissao</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Vencimento</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {nfsFiltradas.map((nf) => {
                  const st = statusConfig[nf.status]
                  const vencido = nf.status === 'em_antecipacao' && nf.data_vencimento < hoje
                  return (
                    <tr key={nf.id} className={`hover:bg-gray-50 ${vencido ? 'bg-red-50/50' : ''}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">{nf.numero_nf}</td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-900">{nf.razao_social_emitente}</p>
                        <p className="text-xs text-gray-400">{formatCNPJ(nf.cnpj_emitente)}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">{formatCurrency(nf.valor_bruto)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDate(nf.data_emissao)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-sm font-medium ${vencido ? 'text-red-700' : 'text-gray-600'}`}>
                          {formatDate(nf.data_vencimento)}
                        </span>
                        {vencido && <span className="ml-1 text-xs text-red-600">(vencido)</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st?.color || 'bg-gray-100 text-gray-600'}`}>
                          {st?.label || nf.status}
                        </span>
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
