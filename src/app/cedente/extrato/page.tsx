'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  Calendar,
  Search,
  TrendingUp,
  Lock,
} from 'lucide-react'

interface ContaEscrow {
  id: string
  identificador: string
  saldo_disponivel: number
  saldo_bloqueado: number
  status: string
  created_at: string
}

interface Movimento {
  id: string
  tipo: string
  descricao: string
  valor: number
  saldo_apos: number
  created_at: string
}

export default function ExtratoCedentePage() {
  const [conta, setConta] = useState<ContaEscrow | null>(null)
  const [movimentos, setMovimentos] = useState<Movimento[]>([])
  const [loading, setLoading] = useState(true)
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      // Buscar conta escrow do cedente (via RLS)
      const { data: contas } = await supabase
        .from('contas_escrow')
        .select('id, identificador, saldo_disponivel, saldo_bloqueado, status, created_at')
        .limit(1)

      if (contas && contas.length > 0) {
        const c = contas[0] as ContaEscrow
        setConta(c)

        // Buscar movimentos
        const { data: movs } = await supabase
          .from('movimentos_escrow')
          .select('id, tipo, descricao, valor, saldo_apos, created_at')
          .eq('conta_escrow_id', c.id)
          .order('created_at', { ascending: false })

        setMovimentos((movs || []) as Movimento[])
      }

      setLoading(false)
    }
    load()
  }, [])

  // Filtrar movimentos
  const movsFiltrados = movimentos.filter((m) => {
    if (filtroTipo !== 'todos' && m.tipo !== filtroTipo) return false
    if (dataInicio) {
      const movDate = m.created_at.split('T')[0]
      if (movDate < dataInicio) return false
    }
    if (dataFim) {
      const movDate = m.created_at.split('T')[0]
      if (movDate > dataFim) return false
    }
    return true
  })

  const totalCreditos = movsFiltrados
    .filter((m) => m.tipo === 'credito')
    .reduce((acc, m) => acc + m.valor, 0)
  const totalDebitos = movsFiltrados
    .filter((m) => m.tipo === 'debito')
    .reduce((acc, m) => acc + m.valor, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!conta) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <Wallet size={48} className="mx-auto text-gray-300 mb-3" />
        <p className="text-gray-500">Sua conta escrow ainda nao foi criada.</p>
        <p className="text-sm text-gray-400 mt-1">Ela sera criada automaticamente apos a aprovacao do seu cadastro.</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Extrato da Conta Escrow</h1>
        <p className="text-gray-500 font-mono">{conta.identificador}</p>
      </div>

      {/* Saldos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-100 rounded-lg">
              <Wallet size={20} className="text-green-600" />
            </div>
            <span className="text-sm text-gray-500">Saldo Disponivel</span>
          </div>
          <p className="text-3xl font-bold text-green-700">{formatCurrency(conta.saldo_disponivel)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <Lock size={20} className="text-yellow-600" />
            </div>
            <span className="text-sm text-gray-500">Saldo Bloqueado</span>
          </div>
          <p className="text-3xl font-bold text-yellow-700">{formatCurrency(conta.saldo_bloqueado)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-100 rounded-lg">
              <TrendingUp size={20} className="text-blue-600" />
            </div>
            <span className="text-sm text-gray-500">Saldo Total</span>
          </div>
          <p className="text-3xl font-bold text-blue-700">
            {formatCurrency(conta.saldo_disponivel + conta.saldo_bloqueado)}
          </p>
        </div>
      </div>

      {/* Resumo do periodo */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-green-50 rounded-xl p-4 flex items-center gap-3">
          <ArrowUpCircle size={24} className="text-green-600" />
          <div>
            <p className="text-xs text-green-600 font-medium">Total Creditos</p>
            <p className="text-xl font-bold text-green-700">{formatCurrency(totalCreditos)}</p>
          </div>
        </div>
        <div className="bg-red-50 rounded-xl p-4 flex items-center gap-3">
          <ArrowDownCircle size={24} className="text-red-600" />
          <div>
            <p className="text-xs text-red-600 font-medium">Total Debitos</p>
            <p className="text-xl font-bold text-red-700">{formatCurrency(totalDebitos)}</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-2 flex-1">
            <Calendar size={16} className="text-gray-400" />
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Data inicio"
            />
            <span className="text-gray-400">ate</span>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Data fim"
            />
          </div>
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="todos">Todos</option>
            <option value="credito">Creditos</option>
            <option value="debito">Debitos</option>
          </select>
        </div>
      </div>

      {/* Movimentos */}
      {movsFiltrados.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <Search size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Nenhum movimento encontrado.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Data</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Tipo</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Descricao</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">Valor</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">Saldo Apos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movsFiltrados.map((mov) => (
                  <tr key={mov.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(mov.created_at).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      {mov.tipo === 'credito' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                          <ArrowUpCircle size={12} /> Credito
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                          <ArrowDownCircle size={12} /> Debito
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{mov.descricao}</td>
                    <td className={`px-4 py-3 text-sm text-right font-bold ${
                      mov.tipo === 'credito' ? 'text-green-700' : 'text-red-700'
                    }`}>
                      {mov.tipo === 'credito' ? '+' : '-'}{formatCurrency(mov.valor)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600 font-medium">
                      {formatCurrency(mov.saldo_apos)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
