'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { aprovarNF, reprovarNF } from '@/lib/actions/nota-fiscal'
import { formatCurrency, formatCNPJ, formatDate, parseLocalDate } from '@/lib/utils'
import { buckets } from '@/lib/storage'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

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

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  rascunho: { label: 'Rascunho', icon: FileText, variant: 'secondary', className: '' },
  submetida: { label: 'Submetida', icon: Upload, variant: 'default', className: 'bg-blue-100 text-blue-700 border-transparent' },
  em_analise: { label: 'Em Analise', icon: AlertCircle, variant: 'default', className: 'bg-yellow-100 text-yellow-700 border-transparent' },
  aprovada: { label: 'Aprovada', icon: CheckCircle, variant: 'default', className: 'bg-green-100 text-green-700 border-transparent' },
  em_antecipacao: { label: 'Em Antecipacao', icon: Banknote, variant: 'default', className: 'bg-purple-100 text-purple-700 border-transparent' },
  liquidada: { label: 'Liquidada', icon: CheckCircle, variant: 'default', className: 'bg-emerald-100 text-emerald-700 border-transparent' },
  cancelada: { label: 'Cancelada/Reprovada', icon: XCircle, variant: 'destructive', className: '' },
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
            .from(buckets.notasFiscais)
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
  const StatusIcon = status.icon
  const canAnalyze = nf.status === 'submetida' || nf.status === 'em_analise'
  const impostos = nf.valor_icms + nf.valor_iss + nf.valor_pis + nf.valor_cofins + nf.valor_ipi

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
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
          </div>
        </div>

        {canAnalyze && (
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => setShowReprovar(true)}
              disabled={processing}
            >
              <XCircle size={16} />
              Reprovar
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

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          messageType === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-destructive/10 text-destructive border border-destructive/20'
        }`}>
          {message}
        </div>
      )}

      {/* Modal reprovar */}
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Dados — 2 colunas */}
        <div className="lg:col-span-2 space-y-6">
          {/* Dados basicos */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Dados da NF</CardTitle>
            </CardHeader>
            <CardContent>
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
                <div>
                  <span className="text-muted-foreground">Data Vencimento</span>
                  <p className="font-medium tabular-nums">{formatDate(nf.data_vencimento)}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Chave de Acesso</span>
                  <p className="font-mono text-xs break-all">{nf.chave_acesso || '—'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Emitente e Destinatario */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Emitente (Cedente)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm space-y-1">
                  <p className="font-medium">{nf.razao_social_emitente}</p>
                  <p className="text-muted-foreground tabular-nums">{formatCNPJ(nf.cnpj_emitente)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Destinatario (Sacado)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm space-y-1">
                  <p className="font-medium">{nf.razao_social_destinatario || '—'}</p>
                  <p className="text-muted-foreground tabular-nums">{nf.cnpj_destinatario ? formatCNPJ(nf.cnpj_destinatario) : '—'}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Valores */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Valores</CardTitle>
            </CardHeader>
            <CardContent>
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

          {/* Itens e pagamento */}
          {(nf.descricao_itens || nf.condicao_pagamento) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Detalhes</CardTitle>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Resumo rapido */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Resumo</CardTitle>
            </CardHeader>
            <CardContent>
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
                    {Math.ceil((parseLocalDate(nf.data_vencimento).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} dias
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Preview do arquivo */}
          {previewUrl && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Arquivo</CardTitle>
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                    <ExternalLink size={16} />
                  </a>
                </div>
              </CardHeader>
              <CardContent>
                {nf.arquivo_url?.endsWith('.pdf') ? (
                  <iframe src={previewUrl} className="w-full h-80 rounded-lg border" />
                ) : nf.arquivo_url?.match(/\.(jpg|jpeg|png)$/i) ? (
                  <img src={previewUrl} alt="NF" className="w-full rounded-lg border" />
                ) : (
                  <div className="bg-muted rounded-lg p-4 text-center">
                    <FileText size={32} className="mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">Arquivo XML</p>
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                      Baixar
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Metadados */}
          <div className="bg-muted/50 rounded-xl p-4 text-sm">
            <p className="text-muted-foreground">Cadastrada em: {formatDate(nf.created_at)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
