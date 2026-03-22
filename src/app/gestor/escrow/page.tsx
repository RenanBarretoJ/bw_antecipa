'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  Wallet,
  Eye,
  Search,
  TrendingUp,
  Lock,
  CheckCircle,
  XCircle,
  AlertCircle,
} from 'lucide-react'

interface ContaEscrowGestor {
  id: string
  identificador: string
  saldo_disponivel: number
  saldo_bloqueado: number
  status: string
  created_at: string
  cedentes: {
    razao_social: string
    cnpj: string
  }
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  ativa: { label: 'Ativa', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  bloqueada: { label: 'Bloqueada', color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle },
  encerrada: { label: 'Encerrada', color: 'bg-red-100 text-red-700', icon: XCircle },
}

export default function EscrowGestorPage() {
  const [contas, setContas] = useState<ContaEscrowGestor[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('contas_escrow')
        .select('id, identificador, saldo_disponivel, saldo_bloqueado, status, created_at, cedentes(razao_social, cnpj)')
        .order('created_at', { ascending: false })

      setContas((data || []) as ContaEscrowGestor[])
      setLoading(false)
    }
    load()
  }, [])

  const contasFiltradas = contas.filter((c) => {
    if (!busca) return true
    const term = busca.toLowerCase()
    return (
      c.identificador.toLowerCase().includes(term) ||
      c.cedentes.razao_social.toLowerCase().includes(term) ||
      c.cedentes.cnpj.includes(term)
    )
  })

  const saldoTotal = contas.reduce((acc, c) => acc + c.saldo_disponivel, 0)
  const saldoBloqueadoTotal = contas.reduce((acc, c) => acc + c.saldo_bloqueado, 0)
  const contasAtivas = contas.filter((c) => c.status === 'ativa').length

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Contas Escrow</h1>
        <p className="text-gray-500">Visao consolidada de todas as contas escrow.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet size={18} className="text-blue-600" />
            <span className="text-xs text-gray-500">Total Contas</span>
          </div>
          <p className="text-2xl font-bold">{contas.length}</p>
          <p className="text-xs text-green-600 mt-1">{contasAtivas} ativas</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={18} className="text-green-600" />
            <span className="text-xs text-gray-500">Saldo Disponivel Total</span>
          </div>
          <p className="text-2xl font-bold text-green-700">{formatCurrency(saldoTotal)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={18} className="text-yellow-600" />
            <span className="text-xs text-gray-500">Saldo Bloqueado Total</span>
          </div>
          <p className="text-2xl font-bold text-yellow-700">{formatCurrency(saldoBloqueadoTotal)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet size={18} className="text-purple-600" />
            <span className="text-xs text-gray-500">Volume Custodiado</span>
          </div>
          <p className="text-2xl font-bold text-purple-700">{formatCurrency(saldoTotal + saldoBloqueadoTotal)}</p>
        </div>
      </div>

      {/* Busca */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por identificador, razao social ou CNPJ..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : contasFiltradas.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <Wallet size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Nenhuma conta escrow encontrada.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Identificador</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Cedente</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">Disponivel</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">Bloqueado</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Criada em</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {contasFiltradas.map((conta) => {
                  const st = statusConfig[conta.status] || statusConfig.ativa
                  const StIcon = st.icon
                  return (
                    <tr key={conta.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-sm">{conta.identificador}</td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{conta.cedentes.razao_social}</p>
                        <p className="text-xs text-gray-400">{formatCNPJ(conta.cedentes.cnpj)}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-green-700">
                        {formatCurrency(conta.saldo_disponivel)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium text-yellow-700">
                        {formatCurrency(conta.saldo_bloqueado)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>
                          <StIcon size={12} />
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDate(conta.created_at)}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/gestor/escrow/${conta.id}`}
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                        >
                          <Eye size={14} /> Extrato
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
