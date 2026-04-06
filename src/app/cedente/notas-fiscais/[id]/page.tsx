'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { salvarDadosNF, submeterNF } from '@/lib/actions/nota-fiscal'
import { formatCurrency } from '@/lib/utils'
import Link from 'next/link'
import {
  ArrowLeft,
  Save,
  Send,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  XCircle,
  Upload,
  Banknote,
  ExternalLink,
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
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  rascunho: { label: 'Rascunho', color: 'bg-gray-100 text-gray-600', icon: FileText },
  submetida: { label: 'Submetida', color: 'bg-blue-100 text-blue-700', icon: Upload },
  em_analise: { label: 'Em Analise', color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle },
  aprovada: { label: 'Aprovada', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  em_antecipacao: { label: 'Em Antecipacao', color: 'bg-purple-100 text-purple-700', icon: Banknote },
  liquidada: { label: 'Liquidada', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  cancelada: { label: 'Cancelada', color: 'bg-red-100 text-red-700', icon: XCircle },
}

export default function NfDetalhePage() {
  const params = useParams()
  const router = useRouter()
  const nfId = params.id as string

  const [nf, setNf] = useState<NfCompleta | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Form state
  const [form, setForm] = useState({
    numero_nf: '',
    serie: '',
    chave_acesso: '',
    data_emissao: '',
    data_vencimento: '',
    cnpj_emitente: '',
    razao_social_emitente: '',
    cnpj_destinatario: '',
    razao_social_destinatario: '',
    valor_bruto: 0,
    valor_liquido: 0,
    valor_icms: 0,
    valor_iss: 0,
    valor_pis: 0,
    valor_cofins: 0,
    valor_ipi: 0,
    descricao_itens: '',
    condicao_pagamento: '',
  })

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
        setForm({
          numero_nf: nfData.numero_nf || '',
          serie: nfData.serie || '',
          chave_acesso: nfData.chave_acesso || '',
          data_emissao: nfData.data_emissao || '',
          data_vencimento: nfData.data_vencimento || '',
          cnpj_emitente: nfData.cnpj_emitente || '',
          razao_social_emitente: nfData.razao_social_emitente || '',
          cnpj_destinatario: nfData.cnpj_destinatario || '',
          razao_social_destinatario: nfData.razao_social_destinatario || '',
          valor_bruto: nfData.valor_bruto || 0,
          valor_liquido: nfData.valor_liquido || 0,
          valor_icms: nfData.valor_icms || 0,
          valor_iss: nfData.valor_iss || 0,
          valor_pis: nfData.valor_pis || 0,
          valor_cofins: nfData.valor_cofins || 0,
          valor_ipi: nfData.valor_ipi || 0,
          descricao_itens: nfData.descricao_itens || '',
          condicao_pagamento: nfData.condicao_pagamento || '',
        })

        // Gerar URL de preview do arquivo
        if (nfData.arquivo_url) {
          const { data: signedData } = await supabase.storage
            .from('notas-fiscais')
            .createSignedUrl(nfData.arquivo_url, 3600)
          if (signedData) {
            setPreviewUrl(signedData.signedUrl)
          }
        }
      }
      setLoading(false)
    }
    load()
  }, [nfId])

  const updateForm = (field: string, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage('')

    const result = await salvarDadosNF(nfId, {
      ...form,
      valor_bruto: Number(form.valor_bruto),
      valor_liquido: Number(form.valor_liquido),
      valor_icms: Number(form.valor_icms),
      valor_iss: Number(form.valor_iss),
      valor_pis: Number(form.valor_pis),
      valor_cofins: Number(form.valor_cofins),
      valor_ipi: Number(form.valor_ipi),
    })

    if (result?.success) {
      setMessage(result.message || 'Salvo!')
      setMessageType('success')
    } else {
      setMessage(result?.message || 'Erro ao salvar.')
      setMessageType('error')
    }
    setSaving(false)
  }

  const handleSubmit = async () => {
    // Salvar primeiro
    await handleSave()

    setSubmitting(true)
    const result = await submeterNF(nfId)

    if (result?.success) {
      setMessage(result.message || 'Submetida!')
      setMessageType('success')
      // Recarregar para atualizar status
      setTimeout(() => router.push('/cedente/notas-fiscais'), 1500)
    } else {
      setMessage(result?.message || 'Erro ao submeter.')
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

  if (!nf) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <p className="text-gray-500">Nota fiscal nao encontrada.</p>
        <Link href="/cedente/notas-fiscais" className="text-blue-600 hover:text-blue-800 mt-2 inline-block">
          Voltar para lista
        </Link>
      </div>
    )
  }

  const isEditable = nf.status === 'rascunho'
  const status = statusConfig[nf.status] || statusConfig.rascunho
  const StatusIcon = status.icon

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/cedente/notas-fiscais" className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              NF {nf.numero_nf || '(sem numero)'}
            </h1>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
              <StatusIcon size={12} />
              {status.label}
            </span>
          </div>
        </div>

        {isEditable && (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? 'Salvando...' : 'Salvar rascunho'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || saving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Send size={16} />
              {submitting ? 'Submetendo...' : 'Submeter para analise'}
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

      {isEditable && (nf.numero_nf || nf.valor_bruto > 0 || nf.cnpj_destinatario) && (
        <div className="mb-4 p-3 rounded-lg text-sm bg-blue-50 border border-blue-200 text-blue-800">
          Alguns campos foram pré-preenchidos automaticamente a partir do PDF. Verifique os dados antes de submeter.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Formulario — 2 colunas */}
        <div className="lg:col-span-2 space-y-6">
          {/* Dados basicos */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Dados da Nota Fiscal</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Numero da NF *</label>
                <input
                  type="text"
                  value={form.numero_nf}
                  onChange={(e) => updateForm('numero_nf', e.target.value)}
                  disabled={!isEditable}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Serie</label>
                <input
                  type="text"
                  value={form.serie}
                  onChange={(e) => updateForm('serie', e.target.value)}
                  disabled={!isEditable}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Chave de Acesso</label>
                <input
                  type="text"
                  value={form.chave_acesso}
                  onChange={(e) => updateForm('chave_acesso', e.target.value)}
                  disabled={!isEditable}
                  maxLength={44}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data de Emissao *</label>
                <input
                  type="date"
                  value={form.data_emissao}
                  onChange={(e) => updateForm('data_emissao', e.target.value)}
                  disabled={!isEditable}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data de Vencimento *</label>
                <input
                  type="date"
                  value={form.data_vencimento}
                  onChange={(e) => updateForm('data_vencimento', e.target.value)}
                  disabled={!isEditable}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
            </div>
          </div>

          {/* Emitente */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Emitente (Cedente)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ Emitente</label>
                <input
                  type="text"
                  value={form.cnpj_emitente}
                  disabled
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Razao Social Emitente</label>
                <input
                  type="text"
                  value={form.razao_social_emitente}
                  disabled
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500"
                />
              </div>
            </div>
          </div>

          {/* Destinatario (Sacado) */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Destinatario (Sacado / Devedor)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ Destinatario *</label>
                <input
                  type="text"
                  value={form.cnpj_destinatario}
                  onChange={(e) => updateForm('cnpj_destinatario', e.target.value)}
                  disabled={!isEditable}
                  placeholder="00.000.000/0001-00"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Razao Social Destinatario *</label>
                <input
                  type="text"
                  value={form.razao_social_destinatario}
                  onChange={(e) => updateForm('razao_social_destinatario', e.target.value)}
                  disabled={!isEditable}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
            </div>
          </div>

          {/* Valores */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Valores</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Valor Bruto *</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.valor_bruto}
                  onChange={(e) => updateForm('valor_bruto', parseFloat(e.target.value) || 0)}
                  disabled={!isEditable}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ICMS</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.valor_icms}
                  onChange={(e) => updateForm('valor_icms', parseFloat(e.target.value) || 0)}
                  disabled={!isEditable}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ISS</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.valor_iss}
                  onChange={(e) => updateForm('valor_iss', parseFloat(e.target.value) || 0)}
                  disabled={!isEditable}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PIS</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.valor_pis}
                  onChange={(e) => updateForm('valor_pis', parseFloat(e.target.value) || 0)}
                  disabled={!isEditable}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">COFINS</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.valor_cofins}
                  onChange={(e) => updateForm('valor_cofins', parseFloat(e.target.value) || 0)}
                  disabled={!isEditable}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">IPI</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.valor_ipi}
                  onChange={(e) => updateForm('valor_ipi', parseFloat(e.target.value) || 0)}
                  disabled={!isEditable}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Valor Liquido</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.valor_liquido}
                  onChange={(e) => updateForm('valor_liquido', parseFloat(e.target.value) || 0)}
                  disabled={!isEditable}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
            </div>
          </div>

          {/* Descricao e pagamento */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Informacoes Adicionais</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descricao dos Itens</label>
                <textarea
                  value={form.descricao_itens}
                  onChange={(e) => updateForm('descricao_itens', e.target.value)}
                  disabled={!isEditable}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Condicao de Pagamento</label>
                <input
                  type="text"
                  value={form.condicao_pagamento}
                  onChange={(e) => updateForm('condicao_pagamento', e.target.value)}
                  disabled={!isEditable}
                  placeholder="Ex: 30 dias, boleto"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar — preview + resumo */}
        <div className="space-y-6">
          {/* Resumo de valores */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-3">Resumo</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Valor Bruto</span>
                <span className="font-medium">{formatCurrency(form.valor_bruto)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">(-) Impostos</span>
                <span className="text-red-600">
                  {formatCurrency(form.valor_icms + form.valor_iss + form.valor_pis + form.valor_cofins + form.valor_ipi)}
                </span>
              </div>
              <div className="border-t pt-2 flex justify-between">
                <span className="font-medium text-gray-900">Valor Liquido</span>
                <span className="font-bold text-green-700">{formatCurrency(form.valor_liquido)}</span>
              </div>
            </div>
          </div>

          {/* Preview do arquivo */}
          {previewUrl && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Arquivo Original</h3>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800"
                >
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
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Baixar arquivo
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Info */}
          <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-800">
            <p className="font-medium mb-1">Dica</p>
            {isEditable ? (
              <p>
                Preencha todos os campos obrigatorios (*) e clique em &quot;Submeter para analise&quot;.
                O devedor (sacado) sera identificado pelo CNPJ destinatario.
              </p>
            ) : (
              <p>
                Esta NF ja foi submetida e nao pode ser editada.
                Acompanhe o status na listagem.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
