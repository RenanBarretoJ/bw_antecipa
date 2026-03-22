'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { aprovarOperacao, reprovarOperacao } from '@/lib/actions/operacao'
import { liquidarOperacao, marcarInadimplente } from '@/lib/actions/liquidacao'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Banknote,
  FileText,
  Calculator,
} from 'lucide-react'

interface OperacaoDetalhe {
  id: string
  cedente_id: string
  conta_escrow_id: string
  valor_bruto_total: number
  taxa_desconto: number
  prazo_dias: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: string
  motivo_reprovacao: string | null
  aprovado_em: string | null
  created_at: string
  cedentes: {
    razao_social: string
    cnpj: string
  }
}

interface NfDaOperacao {
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

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  solicitada: { label: 'Solicitada', color: 'bg-blue-100 text-blue-700', icon: Clock },
  em_analise: { label: 'Em Analise', color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle },
  em_andamento: { label: 'Em Andamento', color: 'bg-purple-100 text-purple-700', icon: Banknote },
  liquidada: { label: 'Liquidada', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  inadimplente: { label: 'Inadimplente', color: 'bg-red-100 text-red-700', icon: AlertCircle },
  reprovada: { label: 'Reprovada', color: 'bg-red-100 text-red-700', icon: XCircle },
  cancelada: { label: 'Cancelada', color: 'bg-gray-100 text-gray-600', icon: XCircle },
}

export default function OperacaoDetalheGestorPage() {
  const params = useParams()
  const router = useRouter()
  const opId = params.id as string

  const [op, setOp] = useState<OperacaoDetalhe | null>(null)
  const [nfs, setNfs] = useState<NfDaOperacao[]>([])
  const [taxasConfig, setTaxasConfig] = useState<TaxaConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  // Campos de aprovacao
  const [taxa, setTaxa] = useState(0)
  const [prazo, setPrazo] = useState(0)
  const [valorLiquido, setValorLiquido] = useState(0)
  const [showReprovar, setShowReprovar] = useState(false)
  const [motivo, setMotivo] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      // Buscar operacao
      const { data: opData } = await supabase
        .from('operacoes')
        .select('*, cedentes(razao_social, cnpj)')
        .eq('id', opId)
        .single()

      if (opData) {
        const o = opData as OperacaoDetalhe
        setOp(o)
        setTaxa(o.taxa_desconto)
        setPrazo(o.prazo_dias)
        setValorLiquido(o.valor_liquido_desembolso)

        // Buscar NFs da operacao
        const { data: opNfs } = await supabase
          .from('operacoes_nfs')
          .select('nota_fiscal_id')
          .eq('operacao_id', opId)

        if (opNfs) {
          const nfIds = (opNfs as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
          const { data: nfsData } = await supabase
            .from('notas_fiscais')
            .select('id, numero_nf, cnpj_destinatario, razao_social_destinatario, valor_bruto, data_vencimento')
            .in('id', nfIds)

          setNfs((nfsData || []) as NfDaOperacao[])
        }

        // Buscar taxas pre-configuradas do cedente
        const { data: taxas } = await supabase
          .from('taxas_cedente')
          .select('prazo_min, prazo_max, taxa_percentual')
          .eq('cedente_id', o.cedente_id)
          .order('prazo_min', { ascending: true })

        setTaxasConfig((taxas || []) as TaxaConfig[])
      }

      setLoading(false)
    }
    load()
  }, [opId])

  // Recalcular valor liquido quando taxa ou prazo mudam
  useEffect(() => {
    if (op && taxa >= 0 && prazo > 0) {
      const taxaProporcional = (taxa / 100) * (prazo / 30)
      const vl = op.valor_bruto_total * (1 - taxaProporcional)
      setValorLiquido(Math.max(0, Math.round(vl * 100) / 100))
    }
  }, [taxa, prazo, op])

  const aplicarTaxaConfig = (t: TaxaConfig) => {
    setTaxa(t.taxa_percentual)
  }

  const handleAprovar = async () => {
    if (taxa < 0) { setMessage('Taxa invalida.'); setMessageType('error'); return }
    if (valorLiquido <= 0) { setMessage('Valor liquido invalido.'); setMessageType('error'); return }

    setProcessing(true)
    const result = await aprovarOperacao(opId, taxa, prazo, valorLiquido)
    if (result?.success) {
      setMessage(result.message || 'Aprovada!')
      setMessageType('success')
      setTimeout(() => router.push('/gestor/operacoes'), 2000)
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setProcessing(false)
  }

  const handleReprovar = async () => {
    if (!motivo.trim()) { setMessage('Motivo obrigatorio.'); setMessageType('error'); return }
    setProcessing(true)
    const result = await reprovarOperacao(opId, motivo)
    if (result?.success) {
      setMessage(result.message || 'Reprovada.')
      setMessageType('success')
      setTimeout(() => router.push('/gestor/operacoes'), 2000)
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setProcessing(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!op) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Operacao nao encontrada.</p>
        <Link href="/gestor/operacoes" className="text-blue-600 mt-2 inline-block">Voltar</Link>
      </div>
    )
  }

  const status = statusConfig[op.status] || statusConfig.solicitada
  const StatusIcon = status.icon
  const canAnalyze = op.status === 'solicitada' || op.status === 'em_analise'

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/gestor/operacoes" className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Operacao #{op.id.substring(0, 8)}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                <StatusIcon size={12} />
                {status.label}
              </span>
              <span className="text-sm text-gray-500">| {op.cedentes.razao_social} ({formatCNPJ(op.cedentes.cnpj)})</span>
            </div>
          </div>
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

      {/* Modal reprovar */}
      {showReprovar && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="font-semibold text-red-800 mb-2">Reprovar Operacao</h3>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo da reprovacao (obrigatorio)..."
            rows={3}
            className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <div className="flex gap-2">
            <button onClick={() => { setShowReprovar(false); setMotivo('') }} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm">
              Cancelar
            </button>
            <button onClick={handleReprovar} disabled={processing} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm disabled:opacity-50">
              {processing ? 'Reprovando...' : 'Confirmar'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* NFs da operacao */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <FileText size={18} />
              Notas Fiscais ({nfs.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left px-3 py-2 text-xs text-gray-500 uppercase">NF</th>
                    <th className="text-left px-3 py-2 text-xs text-gray-500 uppercase">Sacado</th>
                    <th className="text-left px-3 py-2 text-xs text-gray-500 uppercase">Valor</th>
                    <th className="text-left px-3 py-2 text-xs text-gray-500 uppercase">Vencimento</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {nfs.map((nf) => (
                    <tr key={nf.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{nf.numero_nf}</td>
                      <td className="px-3 py-2">
                        <p>{nf.razao_social_destinatario}</p>
                        <p className="text-xs text-gray-400">{formatCNPJ(nf.cnpj_destinatario)}</p>
                      </td>
                      <td className="px-3 py-2 font-medium">{formatCurrency(nf.valor_bruto)}</td>
                      <td className="px-3 py-2">{formatDate(nf.data_vencimento)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Dados da operacao */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Dados da Operacao</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Valor Bruto Total</span>
                <p className="text-xl font-bold">{formatCurrency(op.valor_bruto_total)}</p>
              </div>
              <div>
                <span className="text-gray-500">Prazo</span>
                <p className="text-xl font-bold">{op.prazo_dias} dias</p>
              </div>
              <div>
                <span className="text-gray-500">Vencimento</span>
                <p className="font-medium">{formatDate(op.data_vencimento)}</p>
              </div>
              <div>
                <span className="text-gray-500">Criada em</span>
                <p className="font-medium">{formatDate(op.created_at)}</p>
              </div>
            </div>
            {op.motivo_reprovacao && (
              <div className="mt-4 p-3 bg-red-50 rounded-lg text-sm text-red-700">
                <strong>Motivo da reprovacao:</strong> {op.motivo_reprovacao}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar — painel de aprovacao */}
        <div className="space-y-6">
          {canAnalyze ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Calculator size={18} className="text-blue-600" />
                <h3 className="font-semibold text-gray-900">Definir Termos</h3>
              </div>

              {/* Taxas pre-configuradas */}
              {taxasConfig.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-medium text-gray-500 mb-2">Taxas pre-configuradas</p>
                  <div className="space-y-1">
                    {taxasConfig.map((t, i) => (
                      <button
                        key={i}
                        onClick={() => aplicarTaxaConfig(t)}
                        className={`w-full flex justify-between text-xs px-3 py-2 rounded-lg transition-colors ${
                          taxa === t.taxa_percentual
                            ? 'bg-blue-100 text-blue-700 font-medium'
                            : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <span>{t.prazo_min}-{t.prazo_max} dias</span>
                        <span>{t.taxa_percentual}% a.m.</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Taxa (% a.m.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={taxa}
                    onChange={(e) => setTaxa(parseFloat(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prazo (dias)</label>
                  <input
                    type="number"
                    min="1"
                    value={prazo}
                    onChange={(e) => setPrazo(parseInt(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valor Liquido Desembolso</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={valorLiquido}
                    onChange={(e) => setValorLiquido(parseFloat(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Resumo visual */}
              <div className="mt-4 p-3 bg-gray-50 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Bruto</span>
                  <span className="font-medium">{formatCurrency(op.valor_bruto_total)}</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>(-) Desconto ({taxa}% x {prazo}d)</span>
                  <span>{formatCurrency(op.valor_bruto_total - valorLiquido)}</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-semibold">Liquido</span>
                  <span className="font-bold text-green-700 text-lg">{formatCurrency(valorLiquido)}</span>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <button
                  onClick={handleAprovar}
                  disabled={processing}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                >
                  <CheckCircle size={18} />
                  {processing ? 'Processando...' : 'Aprovar e Desembolsar'}
                </button>
                <button
                  onClick={() => setShowReprovar(true)}
                  disabled={processing}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 disabled:opacity-50 text-sm"
                >
                  <XCircle size={16} />
                  Reprovar
                </button>
              </div>
            </div>
          ) : (
            // Status somente leitura
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Resumo</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Valor Bruto</span>
                  <span className="font-bold">{formatCurrency(op.valor_bruto_total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Taxa</span>
                  <span className="font-medium">{op.taxa_desconto}% a.m.</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Prazo</span>
                  <span className="font-medium">{op.prazo_dias} dias</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-semibold">Valor Liquido</span>
                  <span className="font-bold text-green-700">{formatCurrency(op.valor_liquido_desembolso)}</span>
                </div>
                {op.aprovado_em && (
                  <div className="flex justify-between text-gray-400 text-xs mt-2">
                    <span>Aprovada em</span>
                    <span>{formatDate(op.aprovado_em)}</span>
                  </div>
                )}
              </div>

              {/* Acoes de liquidacao/inadimplencia */}
              {(op.status === 'em_andamento' || op.status === 'inadimplente') && (
                <div className="mt-4 space-y-2 border-t pt-4">
                  <button
                    onClick={async () => {
                      setProcessing(true)
                      const result = await liquidarOperacao(op.id)
                      if (result?.success) {
                        setMessage(result.message || 'Liquidada!')
                        setMessageType('success')
                        setTimeout(() => router.push('/gestor/operacoes'), 1500)
                      } else {
                        setMessage(result?.message || 'Erro.')
                        setMessageType('error')
                      }
                      setProcessing(false)
                    }}
                    disabled={processing}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
                  >
                    <CheckCircle size={16} />
                    {processing ? 'Processando...' : 'Confirmar Liquidacao'}
                  </button>
                  {op.status === 'em_andamento' && (
                    <button
                      onClick={async () => {
                        setProcessing(true)
                        const result = await marcarInadimplente(op.id)
                        if (result?.success) {
                          setMessage(result.message || 'Marcada.')
                          setMessageType('success')
                          setTimeout(() => router.push('/gestor/operacoes'), 1500)
                        } else {
                          setMessage(result?.message || 'Erro.')
                          setMessageType('error')
                        }
                        setProcessing(false)
                      }}
                      disabled={processing}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 disabled:opacity-50 text-sm"
                    >
                      <AlertCircle size={16} />
                      Marcar Inadimplente
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Link para configurar taxas */}
          {canAnalyze && (
            <Link
              href={`/gestor/cedentes/${op.cedente_id}`}
              className="block text-center text-sm text-blue-600 hover:text-blue-800"
            >
              Gerenciar taxas deste cedente
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
