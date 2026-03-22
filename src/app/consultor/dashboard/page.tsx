'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  Briefcase,
  CreditCard,
  BarChart3,
  TrendingUp,
  ArrowRight,
  Receipt,
  Wallet,
  DollarSign,
} from 'lucide-react'

interface CarteiraCedente {
  cedente_id: string
  comissao_percentual: number
  cedentes: {
    razao_social: string
    cnpj: string
    status: string
  }
}

interface OperacaoRecente {
  id: string
  valor_bruto_total: number
  valor_liquido_desembolso: number
  taxa_desconto: number
  status: string
  created_at: string
  cedentes: { razao_social: string }
}

export default function ConsultorDashboard() {
  const [carteira, setCarteira] = useState<CarteiraCedente[]>([])
  const [operacoes, setOperacoes] = useState<OperacaoRecente[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const [carteiraRes, opsRes] = await Promise.all([
        supabase.from('consultor_cedentes')
          .select('cedente_id, comissao_percentual, cedentes(razao_social, cnpj, status)'),
        supabase.from('operacoes')
          .select('id, valor_bruto_total, valor_liquido_desembolso, taxa_desconto, status, created_at, cedentes(razao_social)')
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      setCarteira((carteiraRes.data || []) as CarteiraCedente[])
      setOperacoes((opsRes.data || []) as OperacaoRecente[])
      setLoading(false)
    }
    load()
  }, [])

  // KPIs
  const cedentesAtivos = carteira.filter((c) => c.cedentes.status === 'ativo').length
  const opsAtivas = operacoes.filter((o) => ['em_andamento', 'solicitada', 'em_analise'].includes(o.status))
  const volumeMes = operacoes
    .filter((o) => {
      const mesAtual = new Date().toISOString().substring(0, 7)
      return o.created_at.substring(0, 7) === mesAtual && o.status !== 'cancelada' && o.status !== 'reprovada'
    })
    .reduce((acc, o) => acc + o.valor_bruto_total, 0)

  // Comissao estimada — soma de (valor_liquido * comissao%) para operacoes em_andamento
  const comissaoEstimada = operacoes
    .filter((o) => o.status === 'em_andamento')
    .reduce((acc, o) => {
      const cedCarteira = carteira.find((c) => c.cedentes.razao_social === o.cedentes.razao_social)
      const pct = cedCarteira?.comissao_percentual || 0
      return acc + (o.valor_liquido_desembolso * pct / 100)
    }, 0)

  const statusLabels: Record<string, { label: string; color: string }> = {
    solicitada: { label: 'Solicitada', color: 'bg-blue-100 text-blue-700' },
    em_analise: { label: 'Em Analise', color: 'bg-yellow-100 text-yellow-700' },
    em_andamento: { label: 'Em Andamento', color: 'bg-purple-100 text-purple-700' },
    liquidada: { label: 'Liquidada', color: 'bg-green-100 text-green-700' },
    reprovada: { label: 'Reprovada', color: 'bg-red-100 text-red-700' },
    cancelada: { label: 'Cancelada', color: 'bg-gray-100 text-gray-600' },
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard do Consultor</h1>
        <p className="text-gray-500">Visao geral da sua carteira e operacoes.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-amber-100 rounded-lg"><Briefcase size={18} className="text-amber-600" /></div>
            <span className="text-xs text-gray-500">Cedentes Ativos</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{cedentesAtivos}</p>
          <p className="text-xs text-gray-400 mt-1">de {carteira.length} na carteira</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-blue-100 rounded-lg"><CreditCard size={18} className="text-blue-600" /></div>
            <span className="text-xs text-gray-500">Operacoes Ativas</span>
          </div>
          <p className="text-2xl font-bold text-blue-700">{opsAtivas.length}</p>
          <p className="text-xs text-gray-400 mt-1">{formatCurrency(opsAtivas.reduce((a, o) => a + o.valor_bruto_total, 0))}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-purple-100 rounded-lg"><BarChart3 size={18} className="text-purple-600" /></div>
            <span className="text-xs text-gray-500">Volume no Mes</span>
          </div>
          <p className="text-2xl font-bold text-purple-700">{formatCurrency(volumeMes)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-green-100 rounded-lg"><DollarSign size={18} className="text-green-600" /></div>
            <span className="text-xs text-gray-500">Comissao Estimada</span>
          </div>
          <p className="text-2xl font-bold text-green-700">{formatCurrency(comissaoEstimada)}</p>
          <p className="text-xs text-gray-400 mt-1">operacoes ativas</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cedentes da carteira */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Minha Carteira</h2>
            <Link href="/consultor/carteira" className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
              Ver todos <ArrowRight size={14} />
            </Link>
          </div>

          {carteira.length === 0 ? (
            <p className="text-gray-500 text-sm">Nenhum cedente vinculado a sua carteira.</p>
          ) : (
            <div className="space-y-3">
              {carteira.slice(0, 5).map((c) => (
                <div key={c.cedente_id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{c.cedentes.razao_social}</p>
                    <p className="text-xs text-gray-400">{formatCNPJ(c.cedentes.cnpj)}</p>
                  </div>
                  <div className="text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      c.cedentes.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {c.cedentes.status}
                    </span>
                    <p className="text-xs text-gray-400 mt-1">Comissao: {c.comissao_percentual}%</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Operacoes recentes */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Operacoes Recentes</h2>
            <Link href="/consultor/operacoes" className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
              Ver todas <ArrowRight size={14} />
            </Link>
          </div>

          {operacoes.length === 0 ? (
            <p className="text-gray-500 text-sm">Nenhuma operacao encontrada.</p>
          ) : (
            <div className="space-y-3">
              {operacoes.slice(0, 5).map((op) => {
                const st = statusLabels[op.status]
                return (
                  <div key={op.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{op.cedentes.razao_social}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">{formatDate(op.created_at)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${st?.color || 'bg-gray-100'}`}>
                          {st?.label || op.status}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm font-bold">{formatCurrency(op.valor_bruto_total)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Links rapidos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        <Link href="/consultor/carteira" className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:border-amber-300 transition-colors group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg"><Briefcase size={18} className="text-amber-600" /></div>
              <span className="font-medium text-gray-900">Minha Carteira</span>
            </div>
            <ArrowRight size={18} className="text-gray-300 group-hover:text-amber-500" />
          </div>
        </Link>
        <Link href="/consultor/operacoes" className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:border-blue-300 transition-colors group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg"><CreditCard size={18} className="text-blue-600" /></div>
              <span className="font-medium text-gray-900">Operacoes</span>
            </div>
            <ArrowRight size={18} className="text-gray-300 group-hover:text-blue-500" />
          </div>
        </Link>
        <Link href="/consultor/relatorios" className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:border-purple-300 transition-colors group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg"><BarChart3 size={18} className="text-purple-600" /></div>
              <span className="font-medium text-gray-900">Relatorios</span>
            </div>
            <ArrowRight size={18} className="text-gray-300 group-hover:text-purple-500" />
          </div>
        </Link>
      </div>
    </div>
  )
}
