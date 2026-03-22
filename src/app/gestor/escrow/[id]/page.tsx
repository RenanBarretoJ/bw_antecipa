'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  ArrowLeft,
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  Calendar,
  Lock,
  TrendingUp,
} from 'lucide-react'

interface ContaEscrow {
  id: string
  identificador: string
  saldo_disponivel: number
  saldo_bloqueado: number
  status: string
  created_at: string
  cedentes: { razao_social: string; cnpj: string }
}

interface Movimento {
  id: string
  tipo: string
  descricao: string
  valor: number
  saldo_apos: number
  created_at: string
}

export default function EscrowDetalhePage() {
  const params = useParams()
  const contaId = params.id as string

  const [conta, setConta] = useState<ContaEscrow | null>(null)
  const [movimentos, setMovimentos] = useState<Movimento[]>([])
  const [loading, setLoading] = useState(true)
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const { data: c } = await supabase
        .from('contas_escrow')
        .select('id, identificador, saldo_disponivel, saldo_bloqueado, status, created_at, cedentes(razao_social, cnpj)')
        .eq('id', contaId)
        .single()

      if (c) {
        setConta(c as ContaEscrow)
        const { data: movs } = await supabase
          .from('movimentos_escrow')
          .select('id, tipo, descricao, valor, saldo_apos, created_at')
          .eq('conta_escrow_id', contaId)
          .order('created_at', { ascending: false })

        setMovimentos((movs || []) as Movimento[])
      }
      setLoading(false)
    }
    load()
  }, [contaId])

  const movsFiltrados = movimentos.filter((m) => {
    if (filtroTipo !== 'todos' && m.tipo !== filtroTipo) return false
    if (dataInicio && m.created_at.split('T')[0] < dataInicio) return false
    if (dataFim && m.created_at.split('T')[0] > dataFim) return false
    return true
  })

  const totalCreditos = movsFiltrados.filter((m) => m.tipo === 'credito').reduce((acc, m) => acc + m.valor, 0)
  const totalDebitos = movsFiltrados.filter((m) => m.tipo === 'debito').reduce((acc, m) => acc + m.valor, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!conta) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Conta escrow nao encontrada.</p>
        <Link href="/gestor/escrow" className="text-blue-600 mt-2 inline-block">Voltar</Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/gestor/escrow" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={16} /> Voltar
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{conta.identificador}</h1>
          <p className="text-gray-500">{conta.cedentes.razao_social} — {formatCNPJ(conta.cedentes.cnpj)}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
          conta.status === 'ativa' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
        }`}>
          {conta.status}
        </span>
      </div>

      {/* Saldos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={18} className="text-green-600" />
            <span className="text-xs text-gray-500">Disponivel</span>
          </div>
          <p className="text-2xl font-bold text-green-700">{formatCurrency(conta.saldo_disponivel)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-1">
            <Lock size={18} className="text-yellow-600" />
            <span className="text-xs text-gray-500">Bloqueado</span>
          </div>
          <p className="text-2xl font-bold text-yellow-700">{formatCurrency(conta.saldo_bloqueado)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={18} className="text-blue-600" />
            <span className="text-xs text-gray-500">Total</span>
          </div>
          <p className="text-2xl font-bold text-blue-700">{formatCurrency(conta.saldo_disponivel + conta.saldo_bloqueado)}</p>
        </div>
      </div>

      {/* Resumo periodo */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-green-50 rounded-xl p-4 flex items-center gap-3">
          <ArrowUpCircle size={24} className="text-green-600" />
          <div>
            <p className="text-xs text-green-600 font-medium">Creditos no periodo</p>
            <p className="text-xl font-bold text-green-700">{formatCurrency(totalCreditos)}</p>
          </div>
        </div>
        <div className="bg-red-50 rounded-xl p-4 flex items-center gap-3">
          <ArrowDownCircle size={24} className="text-red-600" />
          <div>
            <p className="text-xs text-red-600 font-medium">Debitos no periodo</p>
            <p className="text-xl font-bold text-red-700">{formatCurrency(totalDebitos)}</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-2 flex-1">
            <Calendar size={16} className="text-gray-400" />
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <span className="text-gray-400">ate</span>
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="todos">Todos</option>
            <option value="credito">Creditos</option>
            <option value="debito">Debitos</option>
          </select>
        </div>
      </div>

      {/* Tabela de movimentos */}
      {movsFiltrados.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
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
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">Saldo</th>
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
