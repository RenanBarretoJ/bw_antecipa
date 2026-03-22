'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { Wallet, Eye, Search } from 'lucide-react'

interface ContaEscrowConsultor {
  id: string
  identificador: string
  saldo_disponivel: number
  saldo_bloqueado: number
  status: string
  created_at: string
  cedentes: { razao_social: string; cnpj: string }
}

export default function EscrowConsultorPage() {
  const [contas, setContas] = useState<ContaEscrowConsultor[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('contas_escrow')
        .select('id, identificador, saldo_disponivel, saldo_bloqueado, status, created_at, cedentes(razao_social, cnpj)')
        .order('created_at', { ascending: false })

      setContas((data || []) as ContaEscrowConsultor[])
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

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Extratos Escrow</h1>
        <p className="text-gray-500">Visualizacao dos extratos dos cedentes da carteira (somente leitura).</p>
      </div>

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
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {contasFiltradas.map((conta) => (
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
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        conta.status === 'ativa' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {conta.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/consultor/escrow/${conta.id}`}
                        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                      >
                        <Eye size={14} /> Ver extrato
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
