'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Search, Eye } from 'lucide-react'
import Link from 'next/link'
import { formatCNPJ, formatDate } from '@/lib/utils'

interface CedenteRow {
  id: string
  cnpj: string
  razao_social: string
  status: string
  created_at: string
}

const statusBadge: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: 'bg-gray-100 text-gray-700' },
  em_analise: { label: 'Em Analise', color: 'bg-yellow-100 text-yellow-700' },
  ativo: { label: 'Ativo', color: 'bg-green-100 text-green-700' },
  reprovado: { label: 'Reprovado', color: 'bg-red-100 text-red-700' },
  bloqueado: { label: 'Bloqueado', color: 'bg-red-100 text-red-700' },
}

export default function GestorCedentesPage() {
  const [cedentes, setCedentes] = useState<CedenteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('')
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('cedentes')
        .select('id, cnpj, razao_social, status, created_at')
        .order('created_at', { ascending: false })

      setCedentes((data || []) as CedenteRow[])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = cedentes.filter((c) => {
    if (filtroStatus && c.status !== filtroStatus) return false
    if (busca) {
      const q = busca.toLowerCase()
      return c.cnpj.includes(q) || c.razao_social.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Cedentes</h1>

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por CNPJ ou razao social..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <select
            className="px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
          >
            <option value="">Todos os status</option>
            <option value="pendente">Pendente</option>
            <option value="em_analise">Em Analise</option>
            <option value="ativo">Ativo</option>
            <option value="reprovado">Reprovado</option>
          </select>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">CNPJ</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Razao Social</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Data Cadastro</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Acoes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="text-center py-8 text-gray-500">Carregando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-gray-500">Nenhum cedente encontrado.</td></tr>
            ) : (
              filtered.map((c) => {
                const badge = statusBadge[c.status] || statusBadge.pendente
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-mono text-gray-700">{formatCNPJ(c.cnpj)}</td>
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">{c.razao_social}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{formatDate(c.created_at)}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${badge.color}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/gestor/cedentes/${c.id}`}
                        className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
                        <Eye size={16} /> Ver detalhes
                      </Link>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
