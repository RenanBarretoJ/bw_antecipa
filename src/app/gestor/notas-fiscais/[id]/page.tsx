'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { aprovarNF, reprovarNF } from '@/lib/actions/nota-fiscal'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  FileText,
  ExternalLink,
  AlertCircle,
  Upload,
  Banknote,
} from 'lucide-react'

interface NfCompleta {
  id: string
  numero_nf: string
  serie: string | null
  chave_acesso: string | null
  data_emissao: string
  data_vencimento: string
  cnpj_emitente: string
  razao_social_emitente: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  valor_liquido: number | null
  valor_icms: number
  valor_iss: number
  valor_pis: number
  valor_cofins: number
  valor_ipi: number
  descricao_itens: string | null
  condicao_pagamento: string | null
  arquivo_url: string | null
  status: string
  created_at: string
  cedente_id: string
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  rascunho: { label: 'Rascunho', color: 'bg-gray-100 text-gray-600', icon: FileText },
  submetida: { label: 'Submetida', color: 'bg-blue-100 text-blue-700', icon: Upload },
  em_analise: { label: 'Em Analise', color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle },
  aprovada: { label: 'Aprovada', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  em_antecipacao: { label: 'Em Antecipacao', color: 'bg-purple-100 text-purple-700', icon: Banknote },
  liquidada: { label: 'Liquidada', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  cancelada: { label: 'Cancelada/Reprovada', color: 'bg-red-100 text-red-700', icon: XCircle },
}

export default function NfDetalheGestorPage() {
  const params = useParams()
  const router = useRouter()
  const nfId = params.id as string

  const [nf, setNf] = useState<NfCompleta | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [showReprovar, setShowReprovar] = useState(false)
  const [motivo, setMotivo] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('notas_fiscais')
        .select('*')
        .eq('id', nfId)
        .single()

      if (data) {
        const nfData = data as NfCompleta
        setNf(nfData)

        if (nfData.arquivo_url) {
          const { data: signedData } = await supabase.storage
            .from('notas-fiscais')
            .createSignedUrl(nfData.arquivo_url, 3600)
          if (signedData) setPreviewUrl(signedData.signedUrl)
        }
      }
      setLoading(false)
    }
    load()
  }, [nfId])

  const handleAprovar = async () => {
    setProcessing(true)
    const result = await aprovarNF(nfId)
    if (result?.success) {
      setMessage(result.message || 'Aprovada!')
      setMessageType('success')
      setTimeout(() => router.push('/gestor/notas-fiscais'), 1500)
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setProcessing(false)
  }

  const handleReprovar = async () => {
    if (!motivo.trim()) {
      setMessage('Informe o motivo da reprovacao.')
      setMessageType('error')
      return
    }
    setProcessing(true)
    const result = await reprovarNF(nfId, motivo)
    if (result?.success) {
      setMessage(result.message || 'Reprovada.')
      setMessageType('success')
      setTimeout(() => router.push('/gestor/notas-fiscais'), 1500)
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

  if (!nf) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <p className="text-gray-500">Nota fiscal nao encontrada.</p>
        <Link href="/gestor/notas-fiscais" className="text-blue-600 hover:text-blue-800 mt-2 inline-block">
          Voltar
        </Link>
      </div>
    )
  }

  const status = statusConfig[nf.status] || statusConfig.rascunho
  const StatusIcon = status.icon
  const canAnalyze = nf.status === 'submetida' || nf.status === 'em_analise'
  const impostos = nf.valor_icms + nf.valor_iss + nf.valor_pis + nf.valor_cofins + nf.valor_ipi

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/gestor/notas-fiscais" className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Analise NF {nf.numero_nf || '(sem numero)'}
            </h1>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
              <StatusIcon size={12} />
              {status.label}
            </span>
          </div>
        </div>

        {canAnalyze && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowReprovar(true)}
              disabled={processing}
              className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
            >
              <XCircle size={16} />
              Reprovar
            </button>
            <button
              onClick={handleAprovar}
              disabled={processing}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircle size={16} />
              {processing ? 'Processando...' : 'Aprovar NF'}
            </button>
          </div>
        )}
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
          <h3 className="font-semibold text-red-800 mb-2">Reprovar NF</h3>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Informe o motivo da reprovacao (obrigatorio)..."
            rows={3}
            className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setShowReprovar(false); setMotivo('') }}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={handleReprovar}
              disabled={processing}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm"
            >
              {processing ? 'Reprovando...' : 'Confirmar Reprovacao'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Dados — 2 colunas */}
        <div className="lg:col-span-2 space-y-6">
          {/* Dados basicos */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Dados da NF</h2>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Numero</span>
                <p className="font-medium">{nf.numero_nf || '—'}</p>
              </div>
              <div>
                <span className="text-gray-500">Serie</span>
                <p className="font-medium">{nf.serie || '—'}</p>
              </div>
              <div>
                <span className="text-gray-500">Data Emissao</span>
                <p className="font-medium">{formatDate(nf.data_emissao)}</p>
              </div>
              <div>
                <span className="text-gray-500">Data Vencimento</span>
                <p className="font-medium">{formatDate(nf.data_vencimento)}</p>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500">Chave de Acesso</span>
                <p className="font-mono text-xs break-all">{nf.chave_acesso || '—'}</p>
              </div>
            </div>
          </div>

          {/* Emitente e Destinatario */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="font-semibold text-gray-900 mb-3">Emitente (Cedente)</h2>
              <div className="text-sm space-y-1">
                <p className="font-medium">{nf.razao_social_emitente}</p>
                <p className="text-gray-500">{formatCNPJ(nf.cnpj_emitente)}</p>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="font-semibold text-gray-900 mb-3">Destinatario (Sacado)</h2>
              <div className="text-sm space-y-1">
                <p className="font-medium">{nf.razao_social_destinatario || '—'}</p>
                <p className="text-gray-500">{nf.cnpj_destinatario ? formatCNPJ(nf.cnpj_destinatario) : '—'}</p>
              </div>
            </div>
          </div>

          {/* Valores */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Valores</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Valor Bruto</span>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(nf.valor_bruto)}</p>
              </div>
              <div>
                <span className="text-gray-500">ICMS</span>
                <p className="font-medium">{formatCurrency(nf.valor_icms)}</p>
              </div>
              <div>
                <span className="text-gray-500">ISS</span>
                <p className="font-medium">{formatCurrency(nf.valor_iss)}</p>
              </div>
              <div>
                <span className="text-gray-500">PIS</span>
                <p className="font-medium">{formatCurrency(nf.valor_pis)}</p>
              </div>
              <div>
                <span className="text-gray-500">COFINS</span>
                <p className="font-medium">{formatCurrency(nf.valor_cofins)}</p>
              </div>
              <div>
                <span className="text-gray-500">IPI</span>
                <p className="font-medium">{formatCurrency(nf.valor_ipi)}</p>
              </div>
              <div>
                <span className="text-gray-500">Total Impostos</span>
                <p className="font-medium text-red-600">{formatCurrency(impostos)}</p>
              </div>
              <div>
                <span className="text-gray-500">Valor Liquido</span>
                <p className="text-lg font-bold text-green-700">{formatCurrency(nf.valor_liquido || 0)}</p>
              </div>
            </div>
          </div>

          {/* Itens e pagamento */}
          {(nf.descricao_itens || nf.condicao_pagamento) && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Detalhes</h2>
              {nf.descricao_itens && (
                <div className="mb-4">
                  <span className="text-sm text-gray-500">Itens</span>
                  <p className="text-sm mt-1">{nf.descricao_itens}</p>
                </div>
              )}
              {nf.condicao_pagamento && (
                <div>
                  <span className="text-sm text-gray-500">Condicao de Pagamento</span>
                  <p className="text-sm mt-1">{nf.condicao_pagamento}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Resumo rapido */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-3">Resumo</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Valor Bruto</span>
                <span className="font-bold">{formatCurrency(nf.valor_bruto)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">(-) Impostos</span>
                <span className="text-red-600">{formatCurrency(impostos)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between">
                <span className="font-medium">Valor Liquido</span>
                <span className="font-bold text-green-700">{formatCurrency(nf.valor_liquido || 0)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between">
                <span className="text-gray-500">Dias ate vencimento</span>
                <span className="font-medium">
                  {Math.ceil((new Date(nf.data_vencimento).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} dias
                </span>
              </div>
            </div>
          </div>

          {/* Preview do arquivo */}
          {previewUrl && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Arquivo</h3>
                <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
                  <ExternalLink size={16} />
                </a>
              </div>
              {nf.arquivo_url?.endsWith('.pdf') ? (
                <iframe src={previewUrl} className="w-full h-80 rounded-lg border" />
              ) : nf.arquivo_url?.match(/\.(jpg|jpeg|png)$/i) ? (
                <img src={previewUrl} alt="NF" className="w-full rounded-lg border" />
              ) : (
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <FileText size={32} className="mx-auto text-gray-400 mb-2" />
                  <p className="text-sm text-gray-500">Arquivo XML</p>
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600">
                    Baixar
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Metadados */}
          <div className="bg-gray-50 rounded-xl p-4 text-sm">
            <p className="text-gray-500">Cadastrada em: {formatDate(nf.created_at)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
