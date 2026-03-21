'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FileCheck, Receipt, Banknote, Wallet } from 'lucide-react'

interface DashboardStats {
  documentosEnviados: number
  nfsCadastradas: number
  operacoesAtivas: number
  saldoDisponivel: number
}

export default function CedenteDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    documentosEnviados: 0,
    nfsCadastradas: 0,
    operacoesAtivas: 0,
    saldoDisponivel: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadStats = async () => {
      const supabase = createClient()

      const [documentos, nfs, operacoes, escrow] = await Promise.all([
        supabase.from('documentos').select('id', { count: 'exact', head: true }),
        supabase.from('notas_fiscais').select('id', { count: 'exact', head: true }),
        supabase.from('operacoes').select('id', { count: 'exact', head: true }).in('status', ['solicitada', 'em_analise', 'aprovada', 'em_andamento']),
        supabase.from('contas_escrow').select('saldo_disponivel').single(),
      ])

      setStats({
        documentosEnviados: documentos.count || 0,
        nfsCadastradas: nfs.count || 0,
        operacoesAtivas: operacoes.count || 0,
        saldoDisponivel: Number((escrow.data as { saldo_disponivel: number } | null)?.saldo_disponivel || 0),
      })
      setLoading(false)
    }

    loadStats()
  }, [])

  const cards = [
    { label: 'Documentos Enviados', value: stats.documentosEnviados, icon: FileCheck, color: 'bg-blue-500' },
    { label: 'Notas Fiscais', value: stats.nfsCadastradas, icon: Receipt, color: 'bg-purple-500' },
    { label: 'Operacoes Ativas', value: stats.operacoesAtivas, icon: Banknote, color: 'bg-amber-500' },
    {
      label: 'Saldo Disponivel',
      value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.saldoDisponivel),
      icon: Wallet,
      color: 'bg-emerald-500',
    },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Meu Dashboard</h1>

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
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Proximos Passos</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            Complete seu cadastro com todos os documentos obrigatorios
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <div className="w-2 h-2 rounded-full bg-purple-500" />
            Cadastre suas notas fiscais para solicitar antecipacao
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            Acompanhe suas operacoes e saldo escrow
          </div>
        </div>
      </div>
    </div>
  )
}
