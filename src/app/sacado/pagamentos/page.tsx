'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { confirmarPagamento } from '@/lib/actions/sacado'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import {
  Wallet,
  CheckCircle,
  Clock,
  AlertTriangle,
  Send,
  Search,
  Filter,
} from 'lucide-react'

interface OperacaoSacado {
  id: string
  valor_bruto_total: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: string
  created_at: string
  cedentes: { razao_social: string; cnpj: string }
  contas_escrow: { identificador: string } | null
}

const statusConfig: Record<string, { label: string; color: string }> = {
  em_andamento: { label: 'A pagar', color: 'bg-yellow-100 text-yellow-700' },
  liquidada: { label: 'Pago', color: 'bg-green-100 text-green-700' },
  inadimplente: { label: 'Inadimplente', color: 'bg-red-100 text-red-700' },
}

export default function HistoricoPagamentosPage() {
  const [operacoes, setOperacoes] = useState<OperacaoSacado[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('todos')
  const [busca, setBusca] = useState('')
  const [sending, setSending] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const loadOps = async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('operacoes')
      .select('id, valor_bruto_total, valor_liquido_desembolso, data_vencimento, status, created_at, cedentes(razao_social, cnpj), contas_escrow(identificador)')
      .in('status', ['em_andamento', 'liquidada', 'inadimplente'])
      .order('data_vencimento', { ascending: true })

    setOperacoes((data || []) as OperacaoSacado[])
    setLoading(false)
  }

  useEffect(() => { loadOps() }, [])

  const handleConfirmarPagamento = async (opId: string) => {
    setSending(opId)
    setMessage('')
    const result = await confirmarPagamento(opId)
    setMessage(result?.message || '')
    setSending(null)
    if (result?.success) await loadOps()
  }

  const opsFiltradas = operacoes.filter((op) => {
    if (filtro !== 'todos' && op.status !== filtro) return false
    if (busca) {
      const term = busca.toLowerCase()
      return op.cedentes.razao_social.toLowerCase().includes(term) || op.cedentes.cnpj.includes(term)
    }
    return true
  })

  const hoje = new Date().toISOString().split('T')[0]
  const totalAPagar = operacoes.filter((o) => o.status === 'em_andamento').reduce((a, o) => a + o.valor_bruto_total, 0)
  const totalPago = operacoes.filter((o) => o.status === 'liquidada').reduce((a, o) => a + o.valor_bruto_total, 0)

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Historico de Pagamentos</h1>
        <p className="text-gray-500">Acompanhe e confirme pagamentos das operacoes.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-yellow-50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={18} className="text-yellow-600" />
            <span className="text-xs text-yellow-600">Total a Pagar</span>
          </div>
          <p className="text-2xl font-bold text-yellow-700">{formatCurrency(totalAPagar)}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={18} className="text-green-600" />
            <span className="text-xs text-green-600">Total Pago</span>
          </div>
          <p className="text-2xl font-bold text-green-700">{formatCurrency(totalPago)}</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={18} className="text-blue-600" />
            <span className="text-xs text-blue-600">Total Operacoes</span>
          </div>
          <p className="text-2xl font-bold text-blue-700">{operacoes.length}</p>
        </div>
      </div>

      {message && (
        <div className="mb-4 p-3 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200">{message}</div>
      )}

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Buscar por cedente..."
              value={busca} onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="todos">Todos</option>
            <option value="em_andamento">A pagar</option>
            <option value="liquidada">Pagos</option>
            <option value="inadimplente">Inadimplentes</option>
          </select>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : opsFiltradas.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <Wallet size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Nenhuma operacao encontrada.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {opsFiltradas.map((op) => {
            const st = statusConfig[op.status]
            const vencido = op.status === 'em_andamento' && op.data_vencimento < hoje
            const isSending = sending === op.id

            return (
              <div key={op.id} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${
                vencido ? 'border-red-300' : 'border-gray-200'
              }`}>
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-sm font-mono text-gray-400">#{op.id.substring(0, 8)}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st?.color || 'bg-gray-100'}`}>
                          {st?.label || op.status}
                        </span>
                        {vencido && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            <AlertTriangle size={12} /> Vencido
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500 text-xs">Cedente</span>
                          <p className="font-medium">{op.cedentes.razao_social}</p>
                          <p className="text-xs text-gray-400">{formatCNPJ(op.cedentes.cnpj)}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Valor</span>
                          <p className="font-bold text-lg">{formatCurrency(op.valor_bruto_total)}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Vencimento</span>
                          <p className={`font-medium ${vencido ? 'text-red-700' : ''}`}>{formatDate(op.data_vencimento)}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Conta Escrow</span>
                          <p className="font-mono text-sm">{op.contas_escrow?.identificador || '—'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Botao informar pagamento */}
                    {op.status === 'em_andamento' && (
                      <button
                        onClick={() => handleConfirmarPagamento(op.id)}
                        disabled={isSending}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium ml-4 shrink-0"
                      >
                        <Send size={16} />
                        {isSending ? 'Enviando...' : 'Informar Pagamento'}
                      </button>
                    )}
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
