'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ } from '@/lib/utils'
import {
  BarChart3,
  DollarSign,
  TrendingUp,
  Users,
  Calendar,
} from 'lucide-react'

interface CarteiraCedente {
  cedente_id: string
  comissao_percentual: number
  cedentes: { razao_social: string; cnpj: string; status: string }
}

interface OperacaoResumo {
  id: string
  cedente_id: string
  valor_bruto_total: number
  valor_liquido_desembolso: number
  status: string
  created_at: string
  cedentes: { razao_social: string }
}

export default function RelatoriosConsultorPage() {
  const [carteira, setCarteira] = useState<CarteiraCedente[]>([])
  const [operacoes, setOperacoes] = useState<OperacaoResumo[]>([])
  const [loading, setLoading] = useState(true)
  const [mesSelected, setMesSelected] = useState(new Date().toISOString().substring(0, 7))

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const [carteiraRes, opsRes] = await Promise.all([
        supabase.from('consultor_cedentes')
          .select('cedente_id, comissao_percentual, cedentes(razao_social, cnpj, status)'),
        supabase.from('operacoes')
          .select('id, cedente_id, valor_bruto_total, valor_liquido_desembolso, status, created_at, cedentes(razao_social)')
          .in('status', ['em_andamento', 'liquidada'])
          .order('created_at', { ascending: false }),
      ])

      setCarteira((carteiraRes.data || []) as CarteiraCedente[])
      setOperacoes((opsRes.data || []) as OperacaoResumo[])
      setLoading(false)
    }
    load()
  }, [])

  // Filtrar por mes
  const opsMes = operacoes.filter((o) => o.created_at.substring(0, 7) === mesSelected)
  const volumeMes = opsMes.reduce((acc, o) => acc + o.valor_bruto_total, 0)

  // Comissao por cedente
  const comissaoPorCedente = carteira.map((c) => {
    const opsDosCedente = opsMes.filter((o) => o.cedente_id === c.cedente_id)
    const volumeCedente = opsDosCedente.reduce((acc, o) => acc + o.valor_liquido_desembolso, 0)
    const comissao = volumeCedente * c.comissao_percentual / 100
    const opsTotal = operacoes.filter((o) => o.cedente_id === c.cedente_id)
    const volumeTotal = opsTotal.reduce((acc, o) => acc + o.valor_bruto_total, 0)

    return {
      cedente: c.cedentes.razao_social,
      cnpj: c.cedentes.cnpj,
      status: c.cedentes.status,
      percentual: c.comissao_percentual,
      volumeMes: volumeCedente,
      comissaoMes: comissao,
      opsNoMes: opsDosCedente.length,
      volumeTotal,
    }
  }).sort((a, b) => b.comissaoMes - a.comissaoMes)

  const comissaoTotal = comissaoPorCedente.reduce((acc, c) => acc + c.comissaoMes, 0)
  const volumeAcumulado = operacoes.reduce((acc, o) => acc + o.valor_bruto_total, 0)

  // Gerar lista de meses disponiveis
  const mesesDisponiveis = [...new Set(operacoes.map((o) => o.created_at.substring(0, 7)))].sort().reverse()
  if (!mesesDisponiveis.includes(mesSelected)) {
    mesesDisponiveis.unshift(mesSelected)
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Relatorios e Comissoes</h1>
          <p className="text-gray-500">Performance da carteira e comissoes por periodo.</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-gray-400" />
          <select
            value={mesSelected}
            onChange={(e) => setMesSelected(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            {mesesDisponiveis.map((m) => (
              <option key={m} value={m}>
                {new Date(m + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPIs do periodo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-blue-100 rounded-lg"><BarChart3 size={18} className="text-blue-600" /></div>
            <span className="text-xs text-gray-500">Volume no Mes</span>
          </div>
          <p className="text-2xl font-bold text-blue-700">{formatCurrency(volumeMes)}</p>
          <p className="text-xs text-gray-400">{opsMes.length} operacao(es)</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-green-100 rounded-lg"><DollarSign size={18} className="text-green-600" /></div>
            <span className="text-xs text-gray-500">Comissao no Mes</span>
          </div>
          <p className="text-2xl font-bold text-green-700">{formatCurrency(comissaoTotal)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-purple-100 rounded-lg"><TrendingUp size={18} className="text-purple-600" /></div>
            <span className="text-xs text-gray-500">Volume Acumulado</span>
          </div>
          <p className="text-2xl font-bold text-purple-700">{formatCurrency(volumeAcumulado)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-amber-100 rounded-lg"><Users size={18} className="text-amber-600" /></div>
            <span className="text-xs text-gray-500">Cedentes Ativos</span>
          </div>
          <p className="text-2xl font-bold text-amber-700">{carteira.filter((c) => c.cedentes.status === 'ativo').length}</p>
        </div>
      </div>

      {/* Tabela de comissoes por cedente */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Comissoes por Cedente</h2>
        </div>
        {comissaoPorCedente.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500">Nenhum cedente na carteira.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Cedente</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Status</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">Vol. Mes</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Ops Mes</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">%</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">Comissao</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">Vol. Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {comissaoPorCedente.map((c) => (
                  <tr key={c.cnpj} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium">{c.cedente}</p>
                      <p className="text-xs text-gray-400">{formatCNPJ(c.cnpj)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        c.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}>{c.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium">{formatCurrency(c.volumeMes)}</td>
                    <td className="px-4 py-3 text-sm">{c.opsNoMes}</td>
                    <td className="px-4 py-3 text-sm font-medium">{c.percentual}%</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-green-700">{formatCurrency(c.comissaoMes)}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500">{formatCurrency(c.volumeTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50">
                  <td colSpan={5} className="px-4 py-3 text-sm font-bold text-gray-900">Total</td>
                  <td className="px-4 py-3 text-right text-lg font-bold text-green-700">{formatCurrency(comissaoTotal)}</td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-gray-700">{formatCurrency(volumeAcumulado)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Nota */}
      <div className="bg-amber-50 rounded-xl p-4 text-sm text-amber-800">
        <p className="font-medium mb-1">Nota</p>
        <p>Os valores de comissao sao estimados com base nas operacoes em andamento e liquidadas. Os valores finais sao confirmados pelo gestor.</p>
      </div>
    </div>
  )
}
