'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  Receipt,
  CheckSquare,
  AlertTriangle,
  Calendar,
  Building2,
  Wallet,
  Clock,
  ArrowRight,
  CreditCard,
} from 'lucide-react'

interface NfSacado {
  id: string
  numero_nf: string
  cnpj_emitente: string
  razao_social_emitente: string
  valor_bruto: number
  data_vencimento: string
  status: string
  cedente_id: string
}

interface OperacaoSacado {
  id: string
  valor_bruto_total: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: string
  cedentes: { razao_social: string; cnpj: string }
  contas_escrow: { identificador: string } | null
}

interface VencimentoDia {
  data: string
  nfs: NfSacado[]
  total: number
}

interface CedenteAgrupado {
  cnpj: string
  razao_social: string
  nfs: NfSacado[]
  totalDevido: number
  proximoVencimento: string
  contaEscrow: string | null
}

export default function SacadoDashboard() {
  const [nfs, setNfs] = useState<NfSacado[]>([])
  const [operacoes, setOperacoes] = useState<OperacaoSacado[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      // NFs destinadas a este sacado (via RLS)
      const { data: nfsData } = await supabase
        .from('notas_fiscais')
        .select('id, numero_nf, cnpj_emitente, razao_social_emitente, valor_bruto, data_vencimento, status, cedente_id')
        .in('status', ['em_antecipacao', 'aprovada', 'liquidada'])
        .order('data_vencimento', { ascending: true })

      setNfs((nfsData || []) as NfSacado[])

      // Operacoes vinculadas ao sacado (via RLS)
      const { data: opsData } = await supabase
        .from('operacoes')
        .select('id, valor_bruto_total, valor_liquido_desembolso, data_vencimento, status, cedentes(razao_social, cnpj), contas_escrow(identificador)')
        .in('status', ['em_andamento', 'liquidada', 'inadimplente'])
        .order('data_vencimento', { ascending: true })

      setOperacoes((opsData || []) as OperacaoSacado[])
      setLoading(false)
    }
    load()
  }, [])

  // Agrupar por cedente
  const cedenteMap = new Map<string, CedenteAgrupado>()
  const nfsAtivas = nfs.filter((n) => n.status === 'em_antecipacao')

  for (const nf of nfsAtivas) {
    const key = nf.cnpj_emitente
    if (!cedenteMap.has(key)) {
      // Encontrar conta escrow do cedente via operacoes
      const op = operacoes.find((o) => o.cedentes?.cnpj === nf.cnpj_emitente)
      cedenteMap.set(key, {
        cnpj: nf.cnpj_emitente,
        razao_social: nf.razao_social_emitente,
        nfs: [],
        totalDevido: 0,
        proximoVencimento: nf.data_vencimento,
        contaEscrow: op?.contas_escrow?.identificador || null,
      })
    }
    const c = cedenteMap.get(key)!
    c.nfs.push(nf)
    c.totalDevido += nf.valor_bruto
    if (nf.data_vencimento < c.proximoVencimento) {
      c.proximoVencimento = nf.data_vencimento
    }
  }
  const cedentesAgrupados = Array.from(cedenteMap.values())
    .sort((a, b) => a.proximoVencimento.localeCompare(b.proximoVencimento))

  // Agrupar NFs ativas por data de vencimento (calendario)
  const vencimentoMap = new Map<string, VencimentoDia>()
  for (const nf of nfsAtivas) {
    const data = nf.data_vencimento
    if (!vencimentoMap.has(data)) {
      vencimentoMap.set(data, { data, nfs: [], total: 0 })
    }
    const v = vencimentoMap.get(data)!
    v.nfs.push(nf)
    v.total += nf.valor_bruto
  }
  const vencimentos = Array.from(vencimentoMap.values())
    .sort((a, b) => a.data.localeCompare(b.data))

  // KPIs
  const totalDevido = nfsAtivas.reduce((acc, n) => acc + n.valor_bruto, 0)
  const hoje = new Date().toISOString().split('T')[0]
  const vencimentosHoje = nfsAtivas.filter((n) => n.data_vencimento === hoje)
  const vencidos = nfsAtivas.filter((n) => n.data_vencimento < hoje)
  const proximos7d = nfsAtivas.filter((n) => {
    const venc = new Date(n.data_vencimento)
    const em7d = new Date()
    em7d.setDate(em7d.getDate() + 7)
    return venc >= new Date(hoje) && venc <= em7d
  })

  const getDiasAteVencimento = (data: string) => {
    const diff = Math.ceil((new Date(data).getTime() - new Date(hoje).getTime()) / (1000 * 60 * 60 * 24))
    return diff
  }

  const getVencimentoColor = (data: string) => {
    const dias = getDiasAteVencimento(data)
    if (dias < 0) return 'bg-red-100 text-red-700 border-red-200'
    if (dias === 0) return 'bg-red-100 text-red-700 border-red-200'
    if (dias <= 5) return 'bg-yellow-100 text-yellow-700 border-yellow-200'
    return 'bg-green-100 text-green-700 border-green-200'
  }

  const getVencimentoLabel = (data: string) => {
    const dias = getDiasAteVencimento(data)
    if (dias < 0) return `${Math.abs(dias)}d atrasado`
    if (dias === 0) return 'Hoje'
    if (dias === 1) return 'Amanha'
    return `em ${dias}d`
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
        <h1 className="text-2xl font-bold text-gray-900">Dashboard do Sacado</h1>
        <p className="text-gray-500">Acompanhe seus pagamentos e vencimentos.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-blue-100 rounded-lg"><CreditCard size={18} className="text-blue-600" /></div>
            <span className="text-xs text-gray-500">Total a Pagar</span>
          </div>
          <p className="text-2xl font-bold text-blue-700">{formatCurrency(totalDevido)}</p>
          <p className="text-xs text-gray-400 mt-1">{nfsAtivas.length} NF(s) ativas</p>
        </div>
        <div className={`rounded-xl shadow-sm border p-5 ${vencidos.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`p-2 rounded-lg ${vencidos.length > 0 ? 'bg-red-200' : 'bg-red-100'}`}>
              <AlertTriangle size={18} className="text-red-600" />
            </div>
            <span className="text-xs text-gray-500">Vencidos</span>
          </div>
          <p className="text-2xl font-bold text-red-700">{vencidos.length}</p>
          {vencidos.length > 0 && (
            <p className="text-xs text-red-600 mt-1">{formatCurrency(vencidos.reduce((a, n) => a + n.valor_bruto, 0))}</p>
          )}
        </div>
        <div className={`rounded-xl shadow-sm border p-5 ${vencimentosHoje.length > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-yellow-100 rounded-lg"><Calendar size={18} className="text-yellow-600" /></div>
            <span className="text-xs text-gray-500">Vencem Hoje</span>
          </div>
          <p className="text-2xl font-bold text-yellow-700">{vencimentosHoje.length}</p>
          {vencimentosHoje.length > 0 && (
            <p className="text-xs text-yellow-600 mt-1">{formatCurrency(vencimentosHoje.reduce((a, n) => a + n.valor_bruto, 0))}</p>
          )}
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-purple-100 rounded-lg"><Clock size={18} className="text-purple-600" /></div>
            <span className="text-xs text-gray-500">Proximos 7 dias</span>
          </div>
          <p className="text-2xl font-bold text-purple-700">{proximos7d.length}</p>
          <p className="text-xs text-gray-400 mt-1">{formatCurrency(proximos7d.reduce((a, n) => a + n.valor_bruto, 0))}</p>
        </div>
      </div>

      {/* Calendario de vencimentos */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Calendar size={20} className="text-blue-600" />
          Calendario de Vencimentos
        </h2>

        {vencimentos.length === 0 ? (
          <p className="text-gray-500 text-sm">Nenhum vencimento pendente.</p>
        ) : (
          <div className="space-y-3">
            {vencimentos.map((v) => {
              const color = getVencimentoColor(v.data)
              const label = getVencimentoLabel(v.data)
              return (
                <div key={v.data} className={`rounded-xl border p-4 ${color}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-lg">{formatDate(v.data)}</span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/50">{label}</span>
                    </div>
                    <span className="font-bold text-lg">{formatCurrency(v.total)}</span>
                  </div>
                  <div className="space-y-1">
                    {v.nfs.map((nf) => (
                      <div key={nf.id} className="flex items-center justify-between text-sm bg-white/30 rounded-lg px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <Receipt size={14} />
                          <span className="font-medium">NF {nf.numero_nf}</span>
                          <span className="text-xs opacity-70">— {nf.razao_social_emitente}</span>
                        </div>
                        <span className="font-medium">{formatCurrency(nf.valor_bruto)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Visao por cedente — com dados da conta para pagamento */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Building2 size={20} className="text-purple-600" />
          Pagamentos por Cedente
        </h2>

        {cedentesAgrupados.length === 0 ? (
          <p className="text-gray-500 text-sm">Nenhum pagamento pendente.</p>
        ) : (
          <div className="space-y-4">
            {cedentesAgrupados.map((ced) => (
              <div key={ced.cnpj} className="border border-gray-200 rounded-xl overflow-hidden">
                {/* Header do cedente */}
                <div className="bg-gray-50 px-5 py-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{ced.razao_social}</p>
                    <p className="text-xs text-gray-500 font-mono">{formatCNPJ(ced.cnpj)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(ced.totalDevido)}</p>
                    <p className="text-xs text-gray-500">{ced.nfs.length} NF(s)</p>
                  </div>
                </div>

                {/* Conta escrow para pagamento */}
                {ced.contaEscrow && (
                  <div className="px-5 py-3 bg-blue-50 border-t border-blue-100 flex items-center gap-2">
                    <Wallet size={16} className="text-blue-600" />
                    <span className="text-sm text-blue-700">
                      Pagar na conta escrow: <strong className="font-mono">{ced.contaEscrow}</strong>
                    </span>
                  </div>
                )}

                {/* NFs do cedente */}
                <div className="divide-y divide-gray-100">
                  {ced.nfs
                    .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))
                    .map((nf) => {
                      const dias = getDiasAteVencimento(nf.data_vencimento)
                      return (
                        <div key={nf.id} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50">
                          <div className="flex items-center gap-3">
                            <Receipt size={16} className="text-gray-400" />
                            <div>
                              <span className="text-sm font-medium text-gray-900">NF {nf.numero_nf}</span>
                              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                                dias < 0 ? 'bg-red-100 text-red-700' :
                                dias === 0 ? 'bg-red-100 text-red-700' :
                                dias <= 5 ? 'bg-yellow-100 text-yellow-700' :
                                'bg-green-100 text-green-700'
                              }`}>
                                {getVencimentoLabel(nf.data_vencimento)}
                              </span>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-gray-900">{formatCurrency(nf.valor_bruto)}</p>
                            <p className="text-xs text-gray-400">{formatDate(nf.data_vencimento)}</p>
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Links rapidos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/sacado/notas-fiscais" className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:border-blue-300 transition-colors group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg"><Receipt size={18} className="text-blue-600" /></div>
              <span className="font-medium text-gray-900">NFs Recebidas</span>
            </div>
            <ArrowRight size={18} className="text-gray-300 group-hover:text-blue-500" />
          </div>
        </Link>
        <Link href="/sacado/aceite" className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:border-blue-300 transition-colors group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg"><CheckSquare size={18} className="text-amber-600" /></div>
              <span className="font-medium text-gray-900">Aceite de Cessao</span>
            </div>
            <ArrowRight size={18} className="text-gray-300 group-hover:text-blue-500" />
          </div>
        </Link>
        <Link href="/sacado/pagamentos" className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:border-blue-300 transition-colors group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg"><Wallet size={18} className="text-green-600" /></div>
              <span className="font-medium text-gray-900">Historico Pagamentos</span>
            </div>
            <ArrowRight size={18} className="text-gray-300 group-hover:text-blue-500" />
          </div>
        </Link>
      </div>
    </div>
  )
}
