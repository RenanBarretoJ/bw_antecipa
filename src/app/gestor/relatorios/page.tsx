'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ } from '@/lib/utils'
import {
  BarChart3,
  TrendingUp,
  Users,
  CreditCard,
  Calendar,
  DollarSign,
  AlertTriangle,
} from 'lucide-react'

interface OperacaoResumo {
  id: string
  cedente_id: string
  valor_bruto_total: number
  valor_liquido_desembolso: number
  taxa_desconto: number
  status: string
  created_at: string
  data_vencimento: string
  cedentes: { razao_social: string; cnpj: string }
}

interface CedenteResumo {
  id: string
  razao_social: string
  cnpj: string
  status: string
}

export default function RelatoriosGestorPage() {
  const [operacoes, setOperacoes] = useState<OperacaoResumo[]>([])
  const [cedentes, setCedentes] = useState<CedenteResumo[]>([])
  const [loading, setLoading] = useState(true)
  const [mesSelected, setMesSelected] = useState(new Date().toISOString().substring(0, 7))

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const [opsRes, cedsRes] = await Promise.all([
        supabase.from('operacoes')
          .select('id, cedente_id, valor_bruto_total, valor_liquido_desembolso, taxa_desconto, status, created_at, data_vencimento, cedentes(razao_social, cnpj)')
          .order('created_at', { ascending: false }),
        supabase.from('cedentes')
          .select('id, razao_social, cnpj, status'),
      ])

      setOperacoes((opsRes.data || []) as OperacaoResumo[])
      setCedentes((cedsRes.data || []) as CedenteResumo[])
      setLoading(false)
    }
    load()
  }, [])

  // Filtrar por mes
  const opsMes = operacoes.filter((o) => o.created_at.substring(0, 7) === mesSelected)
  const opsValidas = opsMes.filter((o) => !['cancelada', 'reprovada'].includes(o.status))

  // KPIs do mes
  const volumeBrutoMes = opsValidas.reduce((a, o) => a + o.valor_bruto_total, 0)
  const volumeLiquidoMes = opsValidas.reduce((a, o) => a + o.valor_liquido_desembolso, 0)
  const receitaMes = volumeBrutoMes - volumeLiquidoMes
  const opsAtivasMes = opsValidas.filter((o) => o.status === 'em_andamento').length
  const opsLiquidadasMes = opsValidas.filter((o) => o.status === 'liquidada').length
  const opsInadimplentesMes = opsValidas.filter((o) => o.status === 'inadimplente').length
  const taxaMedia = opsValidas.length > 0
    ? opsValidas.reduce((a, o) => a + o.taxa_desconto, 0) / opsValidas.length
    : 0

  // Por cedente
  const volumePorCedente = cedentes
    .filter((c) => c.status === 'ativo')
    .map((c) => {
      const opsDosCedente = operacoes.filter((o) => o.cedente_id === c.id && !['cancelada', 'reprovada'].includes(o.status))
      const opsMesCedente = opsDosCedente.filter((o) => o.created_at.substring(0, 7) === mesSelected)
      return {
        razao_social: c.razao_social,
        cnpj: c.cnpj,
        volumeTotal: opsDosCedente.reduce((a, o) => a + o.valor_bruto_total, 0),
        volumeMes: opsMesCedente.reduce((a, o) => a + o.valor_bruto_total, 0),
        opsTotal: opsDosCedente.length,
        opsMes: opsMesCedente.length,
        inadimplentes: opsDosCedente.filter((o) => o.status === 'inadimplente').length,
      }
    })
    .sort((a, b) => b.volumeTotal - a.volumeTotal)

  // Meses disponiveis
  const mesesDisponiveis = [...new Set(operacoes.map((o) => o.created_at.substring(0, 7)))].sort().reverse()
  if (!mesesDisponiveis.includes(mesSelected)) mesesDisponiveis.unshift(mesSelected)

  // Totais gerais
  const volumeTotalGeral = operacoes
    .filter((o) => !['cancelada', 'reprovada'].includes(o.status))
    .reduce((a, o) => a + o.valor_bruto_total, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Relatorios</h1>
          <p className="text-gray-500">Visao gerencial de operacoes e performance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-gray-400" />
          <select value={mesSelected} onChange={(e) => setMesSelected(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            {mesesDisponiveis.map((m) => (
              <option key={m} value={m}>
                {new Date(m + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-blue-100 rounded-lg"><BarChart3 size={18} className="text-blue-600" /></div>
            <span className="text-xs text-gray-500">Volume Bruto (Mes)</span>
          </div>
          <p className="text-2xl font-bold text-blue-700">{formatCurrency(volumeBrutoMes)}</p>
          <p className="text-xs text-gray-400">{opsValidas.length} operacao(es)</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-green-100 rounded-lg"><DollarSign size={18} className="text-green-600" /></div>
            <span className="text-xs text-gray-500">Receita (Mes)</span>
          </div>
          <p className="text-2xl font-bold text-green-700">{formatCurrency(receitaMes)}</p>
          <p className="text-xs text-gray-400">Taxa media: {taxaMedia.toFixed(2)}% a.m.</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-purple-100 rounded-lg"><TrendingUp size={18} className="text-purple-600" /></div>
            <span className="text-xs text-gray-500">Volume Total Acumulado</span>
          </div>
          <p className="text-2xl font-bold text-purple-700">{formatCurrency(volumeTotalGeral)}</p>
          <p className="text-xs text-gray-400">{operacoes.filter((o) => !['cancelada', 'reprovada'].includes(o.status)).length} operacoes</p>
        </div>
        <div className={`rounded-xl shadow-sm border p-5 ${opsInadimplentesMes > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-red-100 rounded-lg"><AlertTriangle size={18} className="text-red-600" /></div>
            <span className="text-xs text-gray-500">Inadimplencia</span>
          </div>
          <p className="text-2xl font-bold text-red-700">{opsInadimplentesMes}</p>
          <p className="text-xs text-gray-400">{opsLiquidadasMes} liquidadas no mes</p>
        </div>
      </div>

      {/* Resumo por status */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Solicitadas', count: opsMes.filter((o) => o.status === 'solicitada').length, color: 'bg-blue-50 text-blue-700' },
          { label: 'Em Andamento', count: opsAtivasMes, color: 'bg-purple-50 text-purple-700' },
          { label: 'Liquidadas', count: opsLiquidadasMes, color: 'bg-green-50 text-green-700' },
          { label: 'Reprovadas', count: opsMes.filter((o) => o.status === 'reprovada').length, color: 'bg-red-50 text-red-700' },
          { label: 'Canceladas', count: opsMes.filter((o) => o.status === 'cancelada').length, color: 'bg-gray-50 text-gray-700' },
        ].map((item) => (
          <div key={item.label} className={`rounded-xl p-3 text-center ${item.color}`}>
            <p className="text-2xl font-bold">{item.count}</p>
            <p className="text-xs">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Tabela por cedente */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Volume por Cedente</h2>
        </div>
        {volumePorCedente.length === 0 ? (
          <div className="p-12 text-center"><p className="text-gray-500">Nenhum cedente ativo.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Cedente</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">Vol. Mes</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Ops Mes</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">Vol. Total</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Ops Total</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Inadimp.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {volumePorCedente.map((c) => (
                  <tr key={c.cnpj} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium">{c.razao_social}</p>
                      <p className="text-xs text-gray-400">{formatCNPJ(c.cnpj)}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium">{formatCurrency(c.volumeMes)}</td>
                    <td className="px-4 py-3 text-sm">{c.opsMes}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold">{formatCurrency(c.volumeTotal)}</td>
                    <td className="px-4 py-3 text-sm">{c.opsTotal}</td>
                    <td className="px-4 py-3">
                      {c.inadimplentes > 0 ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{c.inadimplentes}</span>
                      ) : (
                        <span className="text-sm text-gray-400">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50">
                  <td className="px-4 py-3 font-bold text-sm">Total</td>
                  <td className="px-4 py-3 text-right font-bold text-sm">{formatCurrency(volumeBrutoMes)}</td>
                  <td className="px-4 py-3 font-bold text-sm">{opsValidas.length}</td>
                  <td className="px-4 py-3 text-right font-bold text-sm">{formatCurrency(volumeTotalGeral)}</td>
                  <td className="px-4 py-3 font-bold text-sm">{operacoes.filter((o) => !['cancelada', 'reprovada'].includes(o.status)).length}</td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
