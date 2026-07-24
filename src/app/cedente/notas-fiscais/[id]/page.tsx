'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { salvarDadosNF, submeterNF, resubmeterNFAjustada } from '@/lib/actions/nota-fiscal'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'
import { buckets } from '@/lib/storage'
import Link from 'next/link'
import {
  ArrowLeft,
  Save,
  Send,
  FileText,
  CheckCircle,
  AlertCircle,
  XCircle,
  Banknote,
  Wrench,
  Truck,
} from 'lucide-react'
import { ChecklistCedente } from '@/components/documentos-v2/ChecklistCedente'
import { useNotifications } from '@/components/notifications/notification-provider'
import { ArquivoOriginalCompacto } from '@/components/notas-fiscais/ArquivoOriginalCompacto'

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
  motivo_ajuste: string | null
  created_at: string
}

interface EntregaResumo {
  id: string
  status_entrega: string
  motivo_pendencia: string | null
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  rascunho: { label: 'Rascunho', color: 'bg-gray-100 text-gray-600', icon: FileText },
  submetida: { label: 'Submetida', color: 'bg-blue-100 text-blue-700', icon: Send },
  em_analise: { label: 'Em Analise', color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle },
  aprovada: { label: 'Validada', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  em_antecipacao: { label: 'Em Antecipacao', color: 'bg-purple-100 text-purple-700', icon: Banknote },
  liquidada: { label: 'Liquidada', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  aceita:        { label: 'Antecipada',         color: 'bg-green-100 text-green-700',  icon: CheckCircle },
  contestada:    { label: 'Contestada',         color: 'bg-orange-100 text-orange-700', icon: AlertCircle },
  cancelada:     { label: 'Cancelada',          color: 'bg-red-100 text-red-700',       icon: XCircle },
  requer_ajuste: { label: 'Requer Ajuste',      color: 'bg-orange-100 text-orange-700', icon: Wrench },
}

const entregaStatusConfig: Record<string, { label: string; color: string }> = {
  em_transito: { label: 'Em trânsito', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200' },
  aguardando_validacao: { label: 'Documento enviado — em análise', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-200' },
  entregue: { label: 'Entrega confirmada', color: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-200' },
  entrega_com_pendencia: { label: 'Em atraso / com pendência', color: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200' },
  devolvida: { label: 'Devolvida', color: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200' },
  cancelada: { label: 'Cancelada', color: 'bg-gray-100 text-gray-600 dark:bg-muted dark:text-muted-foreground' },
}

function LabelValue({ label, value, mono = false }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate font-medium text-foreground ${mono ? 'font-mono text-xs tabular-nums' : ''}`}>{value || '—'}</p>
    </div>
  )
}

function ReadOnlyNfDetails({
  nf,
  previewUrl,
}: {
  nf: NfCompleta
  previewUrl: string | null
}) {
  const impostos = Number(nf.valor_icms || 0) + Number(nf.valor_iss || 0) + Number(nf.valor_pis || 0) + Number(nf.valor_cofins || 0) + Number(nf.valor_ipi || 0)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 font-semibold text-foreground">Dados da Nota Fiscal</h2>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
            <LabelValue label="Número" value={nf.numero_nf} />
            <LabelValue label="Série" value={nf.serie} />
            <LabelValue label="Emissão" value={formatDate(nf.data_emissao)} />
            <LabelValue label="Vencimento" value={formatDate(nf.data_vencimento)} />
            <div className="col-span-2 md:col-span-1">
              <LabelValue label="Chave" value={nf.chave_acesso} mono />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 font-semibold text-foreground">Emitente</h2>
            <div className="space-y-2 text-sm">
              <LabelValue label="Razão social" value={nf.razao_social_emitente} />
              <LabelValue label="CNPJ" value={formatCNPJ(nf.cnpj_emitente)} mono />
            </div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 font-semibold text-foreground">Destinatário</h2>
            <div className="space-y-2 text-sm">
              <LabelValue label="Razão social" value={nf.razao_social_destinatario} />
              <LabelValue label="CNPJ" value={nf.cnpj_destinatario ? formatCNPJ(nf.cnpj_destinatario) : null} mono />
            </div>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 font-semibold text-foreground">Valores</h2>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <LabelValue label="Valor bruto" value={formatCurrency(nf.valor_bruto)} />
            <LabelValue label="ICMS" value={formatCurrency(nf.valor_icms)} />
            <LabelValue label="ISS" value={formatCurrency(nf.valor_iss)} />
            <LabelValue label="PIS" value={formatCurrency(nf.valor_pis)} />
            <LabelValue label="COFINS" value={formatCurrency(nf.valor_cofins)} />
            <LabelValue label="IPI" value={formatCurrency(nf.valor_ipi)} />
            <LabelValue label="Impostos" value={formatCurrency(impostos)} />
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Valor líquido</p>
              <p className="mt-1 font-bold text-success-foreground">{formatCurrency(nf.valor_liquido || nf.valor_bruto)}</p>
            </div>
          </div>
        </section>

        {(nf.descricao_itens || nf.condicao_pagamento) && (
          <details className="rounded-xl border bg-card p-4">
            <summary className="cursor-pointer font-semibold text-foreground">Itens e condição de pagamento</summary>
            <div className="mt-3 space-y-3 text-sm">
              {nf.descricao_itens && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Itens</p>
                  <p className="mt-1 text-foreground">{nf.descricao_itens}</p>
                </div>
              )}
              {nf.condicao_pagamento && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Condição de pagamento</p>
                  <p className="mt-1 text-foreground">{nf.condicao_pagamento}</p>
                </div>
              )}
            </div>
          </details>
        )}
      </div>

      <div className="space-y-4">
        <section className="rounded-xl border bg-card p-4">
          <h3 className="mb-3 font-semibold text-foreground">Resumo</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Valor Bruto</span>
              <span className="font-medium tabular-nums">{formatCurrency(nf.valor_bruto)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Impostos</span>
              <span className="tabular-nums">{formatCurrency(impostos)}</span>
            </div>
            <div className="flex justify-between gap-3 border-t pt-2">
              <span className="font-medium">Valor Líquido</span>
              <span className="font-bold text-success-foreground tabular-nums">{formatCurrency(nf.valor_liquido || nf.valor_bruto)}</span>
            </div>
          </div>
        </section>
        <ArquivoOriginalCompacto previewUrl={previewUrl} arquivoUrl={nf.arquivo_url} title="Arquivo original" />
      </div>
    </div>
  )
}

export default function NfDetalhePage() {
  const params = useParams()
  const router = useRouter()
  const notifications = useNotifications()
  const nfId = params.id as string

  const [nf, setNf] = useState<NfCompleta | null>(null)
  const [entrega, setEntrega] = useState<EntregaResumo | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [resubmitting, setResubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [buscandoCnpj, setBuscandoCnpj] = useState(false)

  useEffect(() => {
    if (!message) return
    notifications.notify({ type: messageType, message, dedupeKey: `${messageType}:${message}` })
    queueMicrotask(() => setMessage(''))
  }, [message, messageType, notifications])

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
            .from(buckets.notasFiscais)
            .createSignedUrl(nfData.arquivo_url, 3600)
          if (signedData) {
            setPreviewUrl(signedData.signedUrl)
          }
        }
      }

      const { data: entregaData } = await supabase
        .from('nota_fiscal_entregas')
        .select('id, status_entrega, motivo_pendencia, created_at')
        .eq('nota_fiscal_id', nfId)
        .neq('status_entrega', 'nao_aplicavel')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setEntrega(entregaData as EntregaResumo | null)

      setLoading(false)
    }
    load()
  }, [nfId])

  const updateForm = (field: string, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const buscarRazaoPorCnpj = async (cnpj: string) => {
    const digits = cnpj.replace(/\D/g, '')
    if (digits.length !== 14) return
    setBuscandoCnpj(true)
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`)
      if (res.ok) {
        const data = await res.json() as { razao_social?: string; nome_fantasia?: string }
        const nome = data.razao_social || data.nome_fantasia || ''
        if (nome) setForm((prev) => ({ ...prev, razao_social_destinatario: nome }))
      }
    } catch {
      // falha silenciosa — usuário preenche manualmente
    } finally {
      setBuscandoCnpj(false)
    }
  }

  // Buscar razão social automaticamente quando o CNPJ destinatário estiver completo
  useEffect(() => {
    if (!nf || (nf.status !== 'rascunho' && nf.status !== 'requer_ajuste')) return
    const digits = form.cnpj_destinatario.replace(/\D/g, '')
    if (digits.length === 14) {
      buscarRazaoPorCnpj(digits)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cnpj_destinatario])

  const handleSave = async (): Promise<boolean> => {
    setSaving(true)
    setMessage('')

    const result = await salvarDadosNF(nfId, {
      ...form,
      valor_bruto: Number(form.valor_bruto),
      valor_liquido: Number(form.valor_bruto),
      valor_icms: Number(form.valor_icms),
      valor_iss: Number(form.valor_iss),
      valor_pis: Number(form.valor_pis),
      valor_cofins: Number(form.valor_cofins),
      valor_ipi: Number(form.valor_ipi),
    })

    if (result?.success) {
      setMessage(result.message || 'Salvo!')
      setMessageType('success')
      setSaving(false)
      return true
    } else {
      const fieldErrors = result?.errors
        ? Object.values(result.errors).flat().join(' | ')
        : null

      setMessage(fieldErrors || result?.message || 'Erro ao salvar.')
      setMessageType('error')
      setSaving(false)
      return false
    }
  }

  const handleSubmit = async () => {
    const saved = await handleSave()
    if (!saved) return

    setSubmitting(true)
    const result = await submeterNF(nfId)

    if (result?.success) {
      setMessage(result.message || 'Submetida!')
      setMessageType('success')
      setTimeout(() => router.push('/cedente/notas-fiscais'), 1500)
    } else {
      const fieldErrors = result?.errors
        ? Object.values(result.errors).flat().join(' | ')
        : null

      setMessage(fieldErrors || result?.message || 'Erro ao salvar.')
      setMessageType('error')
    }
    setSubmitting(false)
  }

  const handleResubmeter = async () => {
    const saved = await handleSave()
    if (!saved) return

    setResubmitting(true)
    const result = await resubmeterNFAjustada(nfId)

    if (result?.success) {
      setMessage(result.message || 'Resubmetida!')
      setMessageType('success')
      setTimeout(() => router.push('/cedente/notas-fiscais'), 1500)
    } else {
      setMessage(result?.message || 'Erro ao resubmeter.')
      setMessageType('error')
    }
    setResubmitting(false)
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

  const isEditable = nf.status === 'rascunho' || nf.status === 'requer_ajuste'
  const status = statusConfig[nf.status] || statusConfig.rascunho
  const entregaStatus = entrega ? entregaStatusConfig[entrega.status_entrega] || entregaStatusConfig.em_transito : null
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
            {entregaStatus && (
              <span className={`ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${entregaStatus.color}`}>
                <Truck size={12} />
                {entregaStatus.label}
              </span>
            )}
            {entrega?.motivo_pendencia && <p className="mt-1 text-xs text-red-600">{entrega.motivo_pendencia}</p>}
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
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            {nf.status === 'requer_ajuste' ? (
              <button
                onClick={handleResubmeter}
                disabled={resubmitting || saving}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                <Send size={16} />
                {resubmitting ? 'Enviando...' : 'Resubmeter apos ajuste'}
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting || saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <Send size={16} />
                {submitting ? 'Submetendo...' : 'Submeter para analise'}
              </button>
            )}
          </div>
        )}
      </div>

      <ChecklistCedente notaFiscalId={nfId} />

      {nf.status === 'requer_ajuste' && nf.motivo_ajuste && (
        <div className="mb-4 p-4 rounded-lg text-sm bg-orange-50 border border-orange-300 text-orange-800">
          <p className="font-semibold mb-1 flex items-center gap-1.5">
            <Wrench size={14} />
            Ajuste solicitado pelo gestor
          </p>
          <p>{nf.motivo_ajuste}</p>
          <p className="mt-2 text-xs text-orange-600">
            Corrija os dados abaixo e clique em &quot;Resubmeter apos ajuste&quot;.
          </p>
        </div>
      )}

      {isEditable && nf.status === 'rascunho' && (nf.numero_nf || nf.valor_bruto > 0 || nf.cnpj_destinatario) && (
        <div className="mb-4 p-3 rounded-lg text-sm bg-blue-50 border border-blue-200 text-blue-800">
          Alguns campos foram pré-preenchidos automaticamente a partir do PDF. Verifique os dados antes de submeter.
        </div>
      )}

      {isEditable ? (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Formulario — 2 colunas */}
        <div className="space-y-4 lg:col-span-2">
          {/* Dados basicos */}
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-foreground">Dados da Nota Fiscal</h2>
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
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-foreground">Emitente (Cedente)</h2>
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
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-foreground">Destinatario (Sacado / Devedor)</h2>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Razao Social Destinatario *
                  {buscandoCnpj && <span className="ml-2 text-xs text-blue-600 font-normal">Buscando...</span>}
                </label>
                <input
                  type="text"
                  value={form.razao_social_destinatario}
                  onChange={(e) => updateForm('razao_social_destinatario', e.target.value)}
                  disabled={!isEditable || buscandoCnpj}
                  placeholder={buscandoCnpj ? 'Buscando razao social...' : ''}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
            </div>
          </div>

          {/* Valores */}
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-foreground">Valores</h2>
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
                  value={form.valor_bruto}
                  disabled
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                />
                <p className="text-xs text-gray-500 mt-1">Igual ao valor bruto. Impostos sao registrados, mas nao deduzidos.</p>
              </div>
            </div>
          </div>

          {/* Descricao e pagamento */}
          <details className="rounded-xl border bg-card p-4 shadow-sm">
            <summary className="cursor-pointer text-lg font-semibold text-foreground">Informacoes Adicionais</summary>
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
          </details>
        </div>

        {/* Sidebar — preview + resumo */}
        <div className="space-y-4">
          {/* Resumo de valores */}
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h3 className="mb-3 font-semibold text-foreground">Resumo</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Valor Bruto</span>
                <span className="font-medium">{formatCurrency(form.valor_bruto)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Impostos (informativo)</span>
                <span className="text-gray-700">
                  {formatCurrency(form.valor_icms + form.valor_iss + form.valor_pis + form.valor_cofins + form.valor_ipi)}
                </span>
              </div>
              <div className="border-t pt-2 flex justify-between">
                <span className="font-medium text-gray-900">Valor Liquido</span>
                <span className="font-bold text-green-700">{formatCurrency(form.valor_bruto)}</span>
              </div>
            </div>
          </div>

          <ArquivoOriginalCompacto previewUrl={previewUrl} arquivoUrl={nf.arquivo_url} title="Arquivo original" />

          {/* Info */}
          {nf.status === 'requer_ajuste' ? (
            <div className="bg-orange-50 rounded-xl p-4 text-sm text-orange-800">
              <p className="font-medium mb-1">Ajuste necessario</p>
              <p>
                Corrija os campos indicados pelo gestor e clique em &quot;Resubmeter apos ajuste&quot; para enviar novamente para analise.
              </p>
            </div>
          ) : (
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
          )}
        </div>
      </div>
      ) : (
        <ReadOnlyNfDetails nf={nf} previewUrl={previewUrl} />
      )}
    </div>
  )
}
