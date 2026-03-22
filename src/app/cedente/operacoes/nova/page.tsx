'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { solicitarAntecipacao } from '@/lib/actions/operacao'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { ArrowLeft, CheckSquare, Square, Send, Receipt, Calculator } from 'lucide-react'

interface NfAprovada {
  id: string
  numero_nf: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  data_vencimento: string
}

interface TaxaConfig {
  prazo_min: number
  prazo_max: number
  taxa_percentual: number
}

export default function NovaSolicitacaoPage() {
  const router = useRouter()
  const [nfs, setNfs] = useState<NfAprovada[]>([])
  const [taxas, setTaxas] = useState<TaxaConfig[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      // Buscar NFs aprovadas
      const { data: nfsData } = await supabase
        .from('notas_fiscais')
        .select('id, numero_nf, cnpj_destinatario, razao_social_destinatario, valor_bruto, data_vencimento')
        .eq('status', 'aprovada')
        .order('data_vencimento', { ascending: true })

      setNfs((nfsData || []) as NfAprovada[])

      // Buscar taxas pre-configuradas
      const { data: taxasData } = await supabase
        .from('taxas_cedente')
        .select('prazo_min, prazo_max, taxa_percentual')
        .order('prazo_min', { ascending: true })

      setTaxas((taxasData || []) as TaxaConfig[])
      setLoading(false)
    }
    load()
  }, [])

  const toggleNf = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === nfs.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(nfs.map((n) => n.id)))
    }
  }

  // Calculos
  const nfsSelecionadas = nfs.filter((n) => selected.has(n.id))
  const valorBrutoTotal = nfsSelecionadas.reduce((acc, n) => acc + n.valor_bruto, 0)

  const dataVencimentoMaisDistante = nfsSelecionadas.length > 0
    ? nfsSelecionadas.reduce((max, n) => n.data_vencimento > max ? n.data_vencimento : max, nfsSelecionadas[0].data_vencimento)
    : ''

  const prazoDias = dataVencimentoMaisDistante
    ? Math.max(1, Math.ceil((new Date(dataVencimentoMaisDistante).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0

  // Encontrar taxa aplicavel
  const taxaAplicavel = taxas.find((t) => prazoDias >= t.prazo_min && prazoDias <= t.prazo_max)
  const taxaPercentual = taxaAplicavel?.taxa_percentual || 0
  const taxaProporcional = (taxaPercentual / 100) * (prazoDias / 30)
  const valorDesconto = valorBrutoTotal * taxaProporcional
  const valorLiquidoEstimado = valorBrutoTotal - valorDesconto

  const handleSubmit = async () => {
    if (selected.size === 0) {
      setMessage('Selecione ao menos uma NF.')
      setMessageType('error')
      return
    }

    setSubmitting(true)
    setMessage('')

    const result = await solicitarAntecipacao(Array.from(selected))

    if (result?.success) {
      setMessage(result.message || 'Solicitacao criada!')
      setMessageType('success')
      setTimeout(() => router.push('/cedente/operacoes'), 2000)
    } else {
      setMessage(result?.message || 'Erro ao solicitar.')
      setMessageType('error')
    }
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/cedente/operacoes" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nova Solicitacao de Antecipacao</h1>
          <p className="text-gray-500">Selecione as NFs aprovadas que deseja antecipar.</p>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          messageType === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lista de NFs */}
        <div className="lg:col-span-2">
          {nfs.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <Receipt size={48} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">Nenhuma NF aprovada disponivel para antecipacao.</p>
              <Link href="/cedente/notas-fiscais" className="text-blue-600 hover:text-blue-800 mt-2 inline-block text-sm">
                Enviar notas fiscais
              </Link>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                >
                  {selected.size === nfs.length ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} />}
                  {selected.size === nfs.length ? 'Desmarcar todas' : 'Selecionar todas'}
                </button>
                <span className="text-sm text-gray-500">{selected.size} de {nfs.length} selecionada(s)</span>
              </div>

              <div className="divide-y divide-gray-100">
                {nfs.map((nf) => {
                  const isSelected = selected.has(nf.id)
                  return (
                    <div
                      key={nf.id}
                      onClick={() => toggleNf(nf.id)}
                      className={`px-4 py-3 flex items-center gap-4 cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      {isSelected
                        ? <CheckSquare size={18} className="text-blue-600 shrink-0" />
                        : <Square size={18} className="text-gray-300 shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">NF {nf.numero_nf}</span>
                          <span className="text-xs text-gray-400">|</span>
                          <span className="text-sm text-gray-600 truncate">{nf.razao_social_destinatario}</span>
                        </div>
                        <div className="flex gap-4 text-xs text-gray-400 mt-0.5">
                          <span>CNPJ: {formatCNPJ(nf.cnpj_destinatario)}</span>
                          <span>Venc: {formatDate(nf.data_vencimento)}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-gray-900">{formatCurrency(nf.valor_bruto)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Painel de resumo */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sticky top-6">
            <div className="flex items-center gap-2 mb-4">
              <Calculator size={18} className="text-blue-600" />
              <h3 className="font-semibold text-gray-900">Resumo da Operacao</h3>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">NFs selecionadas</span>
                <span className="font-medium">{selected.size}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Valor Bruto Total</span>
                <span className="font-bold text-gray-900">{formatCurrency(valorBrutoTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Prazo (dias)</span>
                <span className="font-medium">{prazoDias || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Taxa (% a.m.)</span>
                <span className="font-medium">
                  {taxaPercentual > 0 ? `${taxaPercentual}%` : 'A definir pelo gestor'}
                </span>
              </div>

              {taxaPercentual > 0 && (
                <>
                  <div className="flex justify-between text-red-600">
                    <span>(-) Desconto</span>
                    <span>{formatCurrency(valorDesconto)}</span>
                  </div>
                  <div className="border-t pt-3 flex justify-between">
                    <span className="font-semibold text-gray-900">Valor Liquido Estimado</span>
                    <span className="font-bold text-green-700 text-lg">{formatCurrency(valorLiquidoEstimado)}</span>
                  </div>
                </>
              )}

              {taxaPercentual === 0 && selected.size > 0 && (
                <div className="bg-yellow-50 rounded-lg p-3 text-xs text-yellow-700">
                  Nao ha taxa pre-configurada para este prazo. O gestor definira a taxa ao analisar.
                </div>
              )}
            </div>

            {/* Taxas pre-configuradas */}
            {taxas.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-xs font-medium text-gray-500 mb-2">Taxas pre-configuradas</p>
                <div className="space-y-1">
                  {taxas.map((t, i) => (
                    <div key={i} className={`flex justify-between text-xs px-2 py-1 rounded ${
                      taxaAplicavel === t ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500'
                    }`}>
                      <span>{t.prazo_min}-{t.prazo_max} dias</span>
                      <span>{t.taxa_percentual}% a.m.</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting || selected.size === 0}
              className="mt-6 w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Solicitando...
                </>
              ) : (
                <>
                  <Send size={18} />
                  Solicitar Antecipacao
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
