'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Receipt, CheckSquare, History, AlertTriangle } from 'lucide-react'

interface DashboardStats {
  nfsRecebidas: number
  cessoesPendentes: number
  pagamentosRealizados: number
  vencimentosProximos: number
}

export default function SacadoDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    nfsRecebidas: 0,
    cessoesPendentes: 0,
    pagamentosRealizados: 0,
    vencimentosProximos: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadStats = async () => {
      const supabase = createClient()

      const [nfs, operacoesPendentes, operacoesLiquidadas] = await Promise.all([
        supabase.from('notas_fiscais').select('id', { count: 'exact', head: true }),
        supabase.from('operacoes').select('id', { count: 'exact', head: true }).in('status', ['aprovada', 'em_andamento']),
        supabase.from('operacoes').select('id', { count: 'exact', head: true }).eq('status', 'liquidada'),
      ])

      setStats({
        nfsRecebidas: nfs.count || 0,
        cessoesPendentes: operacoesPendentes.count || 0,
        pagamentosRealizados: operacoesLiquidadas.count || 0,
        vencimentosProximos: 0,
      })
      setLoading(false)
    }

    loadStats()
  }, [])

  const cards = [
    { label: 'NFs Recebidas', value: stats.nfsRecebidas, icon: Receipt, color: 'bg-blue-500' },
    { label: 'Cessoes Pendentes', value: stats.cessoesPendentes, icon: CheckSquare, color: 'bg-amber-500' },
    { label: 'Pagamentos Realizados', value: stats.pagamentosRealizados, icon: History, color: 'bg-emerald-500' },
    { label: 'Vencimentos Proximos', value: stats.vencimentosProximos, icon: AlertTriangle, color: 'bg-red-500' },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard do Sacado</h1>

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

      <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Ultimas NFs Recebidas</h2>
        <p className="text-gray-500 text-sm">Nenhuma nota fiscal encontrada.</p>
      </div>
    </div>
  )
}
