'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Users, FileText, CreditCard, Wallet } from 'lucide-react'

interface DashboardStats {
  totalCedentes: number
  documentosPendentes: number
  operacoesAtivas: number
  saldoEscrowTotal: number
}

export default function GestorDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalCedentes: 0,
    documentosPendentes: 0,
    operacoesAtivas: 0,
    saldoEscrowTotal: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadStats = async () => {
      const supabase = createClient()

      const [cedentes, documentos, operacoes, escrow] = await Promise.all([
        supabase.from('cedentes').select('id', { count: 'exact', head: true }),
        supabase.from('documentos').select('id', { count: 'exact', head: true }).in('status', ['enviado', 'em_analise']),
        supabase.from('operacoes').select('id', { count: 'exact', head: true }).in('status', ['solicitada', 'em_analise', 'aprovada', 'em_andamento']),
        supabase.from('contas_escrow').select('saldo_disponivel'),
      ])

      setStats({
        totalCedentes: cedentes.count || 0,
        documentosPendentes: documentos.count || 0,
        operacoesAtivas: operacoes.count || 0,
        saldoEscrowTotal: ((escrow.data || []) as Array<{ saldo_disponivel: number }>).reduce((sum, c) => sum + Number(c.saldo_disponivel), 0),
      })
      setLoading(false)
    }

    loadStats()
  }, [])

  const cards = [
    { label: 'Cedentes Cadastrados', value: stats.totalCedentes, icon: Users, color: 'bg-blue-500' },
    { label: 'Documentos Pendentes', value: stats.documentosPendentes, icon: FileText, color: 'bg-amber-500' },
    { label: 'Operacoes Ativas', value: stats.operacoesAtivas, icon: CreditCard, color: 'bg-purple-500' },
    {
      label: 'Saldo Escrow Total',
      value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.saldoEscrowTotal),
      icon: Wallet,
      color: 'bg-emerald-500',
    },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard do Gestor</h1>

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
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Cedentes Pendentes</h2>
          <p className="text-gray-500 text-sm">Nenhum cedente pendente.</p>
        </div>
      </div>
    </div>
  )
}
