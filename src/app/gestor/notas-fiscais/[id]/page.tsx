'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { aprovarNF, reprovarNF, solicitarAjusteNF } from '@/lib/actions/nota-fiscal'
import { obterUrlArquivoNotaFiscal } from '@/lib/actions/arquivo-nota-fiscal'
import { formatCurrency, formatCNPJ, formatDate, parseLocalDate } from '@/lib/utils'
import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  FileText,
  AlertCircle,
  Upload,
  Banknote,
  Wrench,
  Truck,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ChecklistGestor } from '@/components/documentos-v2/ChecklistGestor'
import { useNotifications } from '@/components/notifications/notification-provider'
import { ArquivoOriginalCompacto } from '@/components/notas-fiscais/ArquivoOriginalCompacto'
import { useFundoAtivo } from '@/components/fundos/fundo-ativo-provider'
import { HistoricoTimelineCard } from '@/components/historico/HistoricoTimelineCard'
import { DuplicatasDaNota } from '@/components/duplicatas/DuplicatasDaNota'
import { ParcelasDaNota } from '@/components/notas-fiscais/ParcelasDaNota'

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
  fundo_id: string | null
}

interface EntregaResumo {
  id: string
  status_entrega: string
  motivo_pendencia: string | null
}

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  rascunho: { label: 'Rascunho', icon: FileText, variant: 'secondary', className: '' },
  submetida: { label: 'Submetida', icon: Upload, variant: 'default', className: 'bg-blue-100 text-blue-700 border-transparent' },
  em_analise: { label: 'Em Analise', icon: AlertCircle, variant: 'default', className: 'bg-yellow-100 text-yellow-700 border-transparent' },
  aprovada: { label: 'Aprovada', icon: CheckCircle, variant: 'default', className: 'bg-green-100 text-green-700 border-transparent' },
  em_antecipacao: { label: 'Em Antecipacao', icon: Banknote, variant: 'default', className: 'bg-purple-100 text-purple-700 border-transparent' },
  liquidada: { label: 'Liquidada', icon: CheckCircle, variant: 'default', className: 'bg-emerald-100 text-emerald-700 border-transparent' },
  cancelada: { label: 'Cancelada/Reprovada', icon: XCircle, variant: 'destructive', className: '' },
  requer_ajuste: { label: 'Requer Ajuste', icon: Wrench, variant: 'default', className: 'bg-orange-100 text-orange-700 border-transparent' },
}

const entregaStatusConfig: Record<string, { label: string; className: string }> = {
  em_transito: { label: 'Em trânsito', className: 'bg-blue-100 text-blue-700 border-transparent dark:bg-blue-500/15 dark:text-blue-200' },
  aguardando_validacao: { label: 'Documento enviado — em análise', className: 'bg-cyan-100 text-cyan-700 border-transparent dark:bg-cyan-500/15 dark:text-cyan-200' },
  entregue: { label: 'Entrega confirmada', className: 'bg-green-100 text-green-700 border-transparent dark:bg-green-500/15 dark:text-green-200' },
  entrega_com_pendencia: { label: 'Em atraso / com pendência', className: 'bg-red-100 text-red-700 border-transparent dark:bg-red-500/15 dark:text-red-200' },
  devolvida: { label: 'Devolvida', className: 'bg-red-100 text-red-700 border-transparent dark:bg-red-500/15 dark:text-red-200' },
  cancelada: { label: 'Cancelada', className: 'bg-muted text-muted-foreground' },
}

export default function NfDetalheGestorPage() {
  const params = useParams()
  const router = useRouter()
  const notifications = useNotifications()
  const { loading: loadingFundo, fundoAtivo, bloqueado } = useFundoAtivo()
  const nfId = params.id as string

  const [nf, setNf] = useState<NfCompleta | null>(null)
  const [entrega, setEntrega] = useState<EntregaResumo | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [showReprovar, setShowReprovar] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [showAjuste, setShowAjuste] = useState(false)
  const [motivoAjuste, setMotivoAjuste] = useState('')
  const [todayMs] = useState(() => Date.now())
  const [temParcelas, setTemParcelas] = useState(false)

  useEffect(() => {
    if (!message) return
    notifications.notify({ type: messageType, message, dedupeKey: `${messageType}:${message}` })
    queueMicrotask(() => setMessage(''))
  }, [message, messageType, notifications])

  useEffect(() => {
    const load = async () => {
      if (loadingFundo) return
      if (bloqueado || !fundoAtivo?.id) {
        setNf(null)
        setEntrega(null)
        setLoading(false)
        return
      }
      const supabase = createClient()
      const { data } = await supabase
        .from('notas_fiscais')
        .select('*')
        .eq('id', nfId)
        .eq('fundo_id', fundoAtivo.id)
        .single()

      if (data) {
        const nfData = data as NfCompleta
        setNf(nfData)

        if (nfData.arquivo_url) {
          const signed = await obterUrlArquivoNotaFiscal(nfData.id)
          if (signed.success && signed.url) setPreviewUrl(signed.url)
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
  }, [nfId, loadingFundo, bloqueado, fundoAtivo?.id])

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

  const handleSolicitarAjuste = async () => {
    if (!motivoAjuste.trim()) {
      setMessage('Informe o motivo do ajuste.')
      setMessageType('error')
      return
    }
    setProcessing(true)
    const result = await solicitarAjusteNF(nfId, motivoAjuste)
    if (result?.success) {
      setMessage(result.message || 'Ajuste solicitado.')
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
      <div className="max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-60 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (!nf) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <p className="text-muted-foreground">Nota fiscal nao encontrada.</p>
        <Link href="/gestor/notas-fiscais" className="text-primary hover:underline mt-2 inline-block">
          Voltar
        </Link>
      </div>
    )
  }

  const status = statusConfig[nf.status] || statusConfig.rascunho
  const entregaStatus = entrega ? entregaStatusConfig[entrega.status_entrega] || entregaStatusConfig.em_transito : null
  const StatusIcon = status.icon
  const canAnalyze = nf.status === 'submetida' || nf.status === 'em_analise'
  const impostos = nf.valor_icms + nf.valor_iss + nf.valor_pis + nf.valor_cofins + nf.valor_ipi

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/gestor/notas-fiscais">
            <Button variant="ghost" size="icon">
              <ArrowLeft size={20} />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Analise NF {nf.numero_nf || '(sem numero)'}
            </h1>
            <Badge variant={status.variant} className={status.className}>
              <StatusIcon size={12} />
              {status.label}
            </Badge>
            {entregaStatus && (
              <Badge variant="default" className={`ml-2 ${entregaStatus.className}`}>
                <Truck size={12} />
                {entregaStatus.label}
              </Badge>
            )}
            {entrega?.motivo_pendencia && <p className="mt-1 text-xs text-destructive">{entrega.motivo_pendencia}</p>}
          </div>
        </div>

        {canAnalyze && (
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => { setShowReprovar(true); setShowAjuste(false) }}
              disabled={processing}
            >
              <XCircle size={16} />
              Reprovar
            </Button>
            <Button
              variant="outline"
              onClick={() => { setShowAjuste(true); setShowReprovar(false) }}
              disabled={processing}
              className="border-orange-300 text-orange-700 hover:bg-orange-50"
            >
              <Wrench size={16} />
              Solicitar Ajuste
            </Button>
            <Button
              onClick={handleAprovar}
              disabled={processing}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle size={16} />
              {processing ? 'Processando...' : 'Aprovar NF'}
            </Button>
          </div>
        )}
      </div>

      {/* Painel reprovar */}
      {showReprovar && (
        <div className="mb-6 bg-destructive/5 border border-destructive/20 rounded-xl p-4">
          <h3 className="font-semibold text-destructive mb-3">Reprovar NF</h3>
          <div className="mb-3">
            <Label htmlFor="motivo-reprovar" className="text-sm mb-1 block">
              Motivo da reprovacao (obrigatorio)
            </Label>
            <textarea
              id="motivo-reprovar"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Informe o motivo da reprovacao..."
              rows={3}
              className="w-full border border-input rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowReprovar(false); setMotivo('') }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleReprovar}
              disabled={processing}
            >
              {processing ? 'Reprovando...' : 'Confirmar Reprovacao'}
            </Button>
          </div>
        </div>
      )}

      {/* Painel solicitar ajuste */}
      {showAjuste && (
        <div className="mb-6 bg-orange-50 border border-orange-200 rounded-xl p-4">
          <h3 className="font-semibold text-orange-700 mb-3">Solicitar Ajuste</h3>
          <div className="mb-3">
            <Label htmlFor="motivo-ajuste" className="text-sm mb-1 block">
              Descreva o que precisa ser corrigido (obrigatorio)
            </Label>
            <textarea
              id="motivo-ajuste"
              value={motivoAjuste}
              onChange={(e) => setMotivoAjuste(e.target.value)}
              placeholder="Ex: Data de vencimento incorreta, CNPJ do sacado divergente..."
              rows={3}
              className="w-full border border-orange-300 rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowAjuste(false); setMotivoAjuste('') }}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSolicitarAjuste}
              disabled={processing}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {processing ? 'Enviando...' : 'Solicitar Ajuste'}
            </Button>
          </div>
        </div>
      )}

      <ChecklistGestor notaFiscalId={nfId} />

      <DuplicatasDaNota notaFiscalId={nfId} mode="gestor" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Dados — 2 colunas */}
        <div className="lg:col-span-2 space-y-4">
          {/* Dados basicos */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Dados da NF</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Numero</span>
                  <p className="font-medium tabular-nums">{nf.numero_nf || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Serie</span>
                  <p className="font-medium">{nf.serie || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Data Emissao</span>
                  <p className="font-medium tabular-nums">{formatDate(nf.data_emissao)}</p>
                </div>
                {!temParcelas && (
                  <div>
                    <span className="text-muted-foreground">Data Vencimento</span>
                    <p className="font-medium tabular-nums">{formatDate(nf.data_vencimento)}</p>
                  </div>
                )}
                <div className="col-span-2">
                  <span className="text-muted-foreground">Chave de Acesso</span>
                  <p className="font-mono text-xs break-all">{nf.chave_acesso || '—'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Emitente e Destinatario */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Emitente (Cedente)</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-sm space-y-1">
                  <p className="font-medium">{nf.razao_social_emitente}</p>
                  <p className="text-muted-foreground tabular-nums">{formatCNPJ(nf.cnpj_emitente)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Destinatario (Sacado)</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-sm space-y-1">
                  <p className="font-medium">{nf.razao_social_destinatario || '—'}</p>
                  <p className="text-muted-foreground tabular-nums">{nf.cnpj_destinatario ? formatCNPJ(nf.cnpj_destinatario) : '—'}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Valores */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Valores</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Valor Bruto</span>
                  <p className="text-lg font-bold text-foreground tabular-nums">{formatCurrency(nf.valor_bruto)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">ICMS</span>
                  <p className="font-medium tabular-nums">{formatCurrency(nf.valor_icms)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">ISS</span>
                  <p className="font-medium tabular-nums">{formatCurrency(nf.valor_iss)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">PIS</span>
                  <p className="font-medium tabular-nums">{formatCurrency(nf.valor_pis)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">COFINS</span>
                  <p className="font-medium tabular-nums">{formatCurrency(nf.valor_cofins)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">IPI</span>
                  <p className="font-medium tabular-nums">{formatCurrency(nf.valor_ipi)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Impostos</span>
                  <p className="font-medium text-destructive tabular-nums">{formatCurrency(impostos)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Valor Liquido</span>
                  <p className="text-lg font-bold text-green-700 tabular-nums">{formatCurrency(nf.valor_liquido || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <ParcelasDaNota notaFiscalId={nfId} mode="gestor" onTemParcelas={setTemParcelas} />

          {/* Itens e pagamento */}
          {(nf.descricao_itens || nf.condicao_pagamento) && (
            <details className="rounded-xl border bg-card p-4">
              <summary className="cursor-pointer text-base font-semibold text-foreground">Itens e condição de pagamento</summary>
              <div className="mt-3">
                {nf.descricao_itens && (
                  <div className="mb-4">
                    <span className="text-sm text-muted-foreground">Itens</span>
                    <p className="text-sm mt-1">{nf.descricao_itens}</p>
                  </div>
                )}
                {nf.condicao_pagamento && (
                  <div>
                    <span className="text-sm text-muted-foreground">Condicao de Pagamento</span>
                    <p className="text-sm mt-1">{nf.condicao_pagamento}</p>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Resumo rapido */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Resumo</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor Bruto</span>
                  <span className="font-bold tabular-nums">{formatCurrency(nf.valor_bruto)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">(-) Impostos</span>
                  <span className="text-destructive tabular-nums">{formatCurrency(impostos)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between">
                  <span className="font-medium">Valor Liquido</span>
                  <span className="font-bold text-green-700 tabular-nums">{formatCurrency(nf.valor_liquido || 0)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between">
                  <span className="text-muted-foreground">Dias ate vencimento</span>
                  <span className="font-medium tabular-nums">
                    {Math.ceil((parseLocalDate(nf.data_vencimento).getTime() - todayMs) / (1000 * 60 * 60 * 24))} dias
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <ArquivoOriginalCompacto previewUrl={previewUrl} arquivoUrl={nf.arquivo_url} title="Arquivo original" />

          {/* Metadados */}
          <div className="bg-muted/50 rounded-xl p-4 text-sm">
            <p className="text-muted-foreground">Cadastrada em: {formatDate(nf.created_at)}</p>
          </div>
        </div>
      </div>

      <HistoricoTimelineCard entidade="nota_fiscal" entidadeId={nfId} />
    </div>
  )
}
