'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  Briefcase,
  Search,
  Eye,
  CheckCircle,
  Clock,
  XCircle,
  TrendingUp,
} from 'lucide-react'

interface CarteiraCedente {
  cedente_id: string
  comissao_percentual: number
  created_at: string
  cedentes: {
    razao_social: string
    cnpj: string
    status: string
    created_at: string
    nome_fantasia: string | null
  }
}

interface OperacaoResumoCedente {
  cedente_id: string
  valor_bruto_total: number
  status: string
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  pendente: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  em_analise: { label: 'Em Analise', color: 'bg-blue-100 text-blue-700', icon: Clock },
  ativo: { label: 'Ativo', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  reprovado: { label: 'Reprovado', color: 'bg-red-100 text-red-700', icon: XCircle },
  bloqueado: { label: 'Bloqueado', color: 'bg-red-100 text-red-700', icon: XCircle },
}

export default function CarteiraConsultorPage() {
  const [carteira, setCarteira] = useState<CarteiraCedente[]>([])
  const [operacoes, setOperacoes] = useState<OperacaoResumoCedente[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const [carteiraRes, opsRes] = await Promise.all([
        supabase.from('consultor_cedentes')
          .select('cedente_id, comissao_percentual, created_at, cedentes(razao_social, cnpj, status, created_at, nome_fantasia)')
          .order('created_at', { ascending: false }),
        supabase.from('operacoes')
          .select('cedente_id, valor_bruto_total, status')
          .in('status', ['em_andamento', 'liquidada']),
      ])

      setCarteira((carteiraRes.data || []) as CarteiraCedente[])
      setOperacoes((opsRes.data || []) as OperacaoResumoCedente[])
      setLoading(false)
    }
    load()
  }, [])

  const getVolumeCedente = (cedenteId: string) => {
    return operacoes
      .filter((o) => o.cedente_id === cedenteId)
      .reduce((acc, o) => acc + o.valor_bruto_total, 0)
  }

  const getOpsAtivasCedente = (cedenteId: string) => {
    return operacoes.filter((o) => o.cedente_id === cedenteId && o.status === 'em_andamento').length
  }

  const carteiraFiltrada = carteira.filter((c) => {
    if (!busca) return true
    const term = busca.toLowerCase()
    return c.cedentes.razao_social.toLowerCase().includes(term) ||
      c.cedentes.cnpj.includes(term) ||
      (c.cedentes.nome_fantasia || '').toLowerCase().includes(term)
  })

  const volumeTotal = carteira.reduce((acc, c) => acc + getVolumeCedente(c.cedente_id), 0)

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Minha Carteira</h1>
        <p className="text-gray-500">Cedentes vinculados sob sua responsabilidade.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-amber-50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <Briefcase size={18} className="text-amber-600" />
            <span className="text-xs text-amber-600">Total Cedentes</span>
          </div>
          <p className="text-2xl font-bold text-amber-700">{carteira.length}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={18} className="text-green-600" />
            <span className="text-xs text-green-600">Ativos</span>
          </div>
          <p className="text-2xl font-bold text-green-700">{carteira.filter((c) => c.cedentes.status === 'ativo').length}</p>
        </div>
        <div className="bg-purple-50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={18} className="text-purple-600" />
            <span className="text-xs text-purple-600">Volume Total</span>
          </div>
          <p className="text-2xl font-bold text-purple-700">{formatCurrency(volumeTotal)}</p>
        </div>
      </div>

      {/* Busca */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Buscar cedente..." value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : carteiraFiltrada.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <Briefcase size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Nenhum cedente na carteira.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {carteiraFiltrada.map((c) => {
            const st = statusConfig[c.cedentes.status]
            const StIcon = st?.icon || Clock
            const volume = getVolumeCedente(c.cedente_id)
            const opsAtivas = getOpsAtivasCedente(c.cedente_id)

            return (
              <div key={c.cedente_id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <p className="font-semibold text-gray-900 text-lg">{c.cedentes.razao_social}</p>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${st?.color || 'bg-gray-100'}`}>
                        <StIcon size={12} />
                        {st?.label || c.cedentes.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500 text-xs">CNPJ</span>
                        <p className="font-mono">{formatCNPJ(c.cedentes.cnpj)}</p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Nome Fantasia</span>
                        <p>{c.cedentes.nome_fantasia || '—'}</p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Volume Operado</span>
                        <p className="font-bold">{formatCurrency(volume)}</p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Ops Ativas</span>
                        <p className="font-medium">{opsAtivas}</p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Comissao</span>
                        <p className="font-medium text-green-700">{c.comissao_percentual}%</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
