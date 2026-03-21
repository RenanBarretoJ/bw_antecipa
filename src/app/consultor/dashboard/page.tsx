'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Briefcase, CreditCard, BarChart3, TrendingUp } from 'lucide-react'

interface DashboardStats {
  cedentesCarteira: number
  operacoesAtivas: number
  volumeTotal: number
  ticketMedio: number
}

export default function ConsultorDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    cedentesCarteira: 0,
    operacoesAtivas: 0,
    volumeTotal: 0,
    ticketMedio: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadStats = async () => {
      const supabase = createClient()

      const [cedentes, operacoes] = await Promise.all([
        supabase.from('cedentes').select('id', { count: 'exact', head: true }),
        supabase.from('operacoes').select('valor_bruto_total, status'),
      ])

      const ops = (operacoes.data || []) as Array<{ valor_bruto_total: number; status: string }>
      const ativas = ops.filter((o) =>
        ['solicitada', 'em_analise', 'aprovada', 'em_andamento'].includes(o.status)
      )
      const volumeTotal = ops.reduce((sum, o) => sum + Number(o.valor_bruto_total), 0)

      setStats({
        cedentesCarteira: cedentes.count || 0,
        operacoesAtivas: ativas.length,
        volumeTotal,
        ticketMedio: ops.length ? volumeTotal / ops.length : 0,
      })
      setLoading(false)
    }

    loadStats()
  }, [])

  const cards = [
    { label: 'Cedentes na Carteira', value: stats.cedentesCarteira, icon: Briefcase, color: 'bg-amber-500' },
    { label: 'Operacoes Ativas', value: stats.operacoesAtivas, icon: CreditCard, color: 'bg-blue-500' },
    {
      label: 'Volume Total',
      value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.volumeTotal),
      icon: BarChart3,
      color: 'bg-purple-500',
    },
    {
      label: 'Ticket Medio',
      value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.ticketMedio),
      icon: TrendingUp,
      color: 'bg-emerald-500',
    },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard do Consultor</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {loading ? '...' : card.value}
                  </p>
                </div>
                <div className={`w-12 h-12 ${card.color} rounded-lg flex items-center justify-center`}>
                  <Icon size={24} className="text-white" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Operacoes Recentes</h2>
          <p className="text-gray-500 text-sm">Nenhuma operacao encontrada.</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Cedentes da Carteira</h2>
          <p className="text-gray-500 text-sm">Nenhum cedente encontrado.</p>
        </div>
      </div>
    </div>
  )
}
