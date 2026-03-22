'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  Search,
  Filter,
  Eye,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  XCircle,
  Upload,
  Banknote,
} from 'lucide-react'

interface NfGestorRecord {
  id: string
  numero_nf: string
  cnpj_emitente: string
  razao_social_emitente: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  data_emissao: string
  data_vencimento: string
  status: string
  created_at: string
  cedente_id: string
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  rascunho: { label: 'Rascunho', color: 'bg-gray-100 text-gray-600', icon: FileText },
  submetida: { label: 'Submetida', color: 'bg-blue-100 text-blue-700', icon: Upload },
  em_analise: { label: 'Em Analise', color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle },
  aprovada: { label: 'Aprovada', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  em_antecipacao: { label: 'Em Antecipacao', color: 'bg-purple-100 text-purple-700', icon: Banknote },
  liquidada: { label: 'Liquidada', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  cancelada: { label: 'Cancelada/Reprovada', color: 'bg-red-100 text-red-700', icon: XCircle },
}

export default function NotasFiscaisGestorPage() {
  const [nfs, setNfs] = useState<NfGestorRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<string>('submetida')
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('notas_fiscais')
        .select('id, numero_nf, cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, data_emissao, data_vencimento, status, created_at, cedente_id')
        .order('created_at', { ascending: false })

      setNfs((data || []) as NfGestorRecord[])
      setLoading(false)
    }
    load()
  }, [])

  const nfsFiltradas = nfs.filter((nf) => {
    if (filtroStatus !== 'todos' && nf.status !== filtroStatus) return false
    if (busca) {
      const term = busca.toLowerCase()
      return (
        nf.numero_nf.toLowerCase().includes(term) ||
        nf.razao_social_emitente.toLowerCase().includes(term) ||
        nf.cnpj_emitente.includes(term) ||
        nf.razao_social_destinatario.toLowerCase().includes(term) ||
        nf.cnpj_destinatario.includes(term)
      )
    }
    return true
  })

  const pendentes = nfs.filter((n) => n.status === 'submetida' || n.status === 'em_analise').length
  const aprovadas = nfs.filter((n) => n.status === 'aprovada').length
  const valorTotal = nfs.filter((n) => n.status !== 'cancelada').reduce((acc, n) => acc + n.valor_bruto, 0)

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Notas Fiscais</h1>
        <p className="text-gray-500">Analise e gerencie as NFs dos cedentes.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-yellow-50 rounded-xl p-4">
          <p className="text-xs font-medium text-yellow-600">Pendentes de Analise</p>
          <p className="text-2xl font-bold text-yellow-700 mt-1">{pendentes}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs font-medium text-green-600">Aprovadas</p>
          <p className="text-2xl font-bold text-green-700 mt-1">{aprovadas}</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs font-medium text-blue-600">Total de NFs</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{nfs.length}</p>
        </div>
        <div className="bg-purple-50 rounded-xl p-4">
          <p className="text-xs font-medium text-purple-600">Valor Total</p>
          <p className="text-2xl font-bold text-purple-700 mt-1">{formatCurrency(valorTotal)}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por numero, CNPJ ou razao social..."
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
              className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
            >
              <option value="todos">Todos</option>
              <option value="submetida">Submetidas (pendentes)</option>
              <option value="em_analise">Em Analise</option>
              <option value="aprovada">Aprovadas</option>
              <option value="em_antecipacao">Em Antecipacao</option>
              <option value="liquidada">Liquidadas</option>
              <option value="cancelada">Canceladas/Reprovadas</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : nfsFiltradas.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <FileText size={48} className="mx-auto text-gray-300 mb-3" />
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
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Sacado (Destinatario)</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Valor</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Vencimento</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {nfsFiltradas.map((nf) => {
                  const status = statusConfig[nf.status] || statusConfig.rascunho
                  const StatusIcon = status.icon
                  return (
                    <tr key={nf.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{nf.numero_nf || '—'}</td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-900">{nf.razao_social_emitente}</p>
                        <p className="text-xs text-gray-400">{formatCNPJ(nf.cnpj_emitente)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-900">{nf.razao_social_destinatario || '—'}</p>
                        <p className="text-xs text-gray-400">
                          {nf.cnpj_destinatario ? formatCNPJ(nf.cnpj_destinatario) : '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {nf.valor_bruto > 0 ? formatCurrency(nf.valor_bruto) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {nf.data_vencimento ? formatDate(nf.data_vencimento) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                          <StatusIcon size={12} />
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/gestor/notas-fiscais/${nf.id}`}
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                        >
                          <Eye size={14} />
                          Analisar
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
