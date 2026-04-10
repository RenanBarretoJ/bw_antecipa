'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { aceitarCessao, contestarCessao } from '@/lib/actions/sacado'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import {
  CheckCircle,
  XCircle,
  Receipt,
  AlertTriangle,
  Wallet,
  Eye,
  X,
  Loader2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { buckets } from '@/lib/storage'

interface NfCessao {
  id: string
  numero_nf: string
  cnpj_emitente: string
  razao_social_emitente: string
  valor_bruto: number
  data_vencimento: string
  status: string
  cedente_id: string
  arquivo_url: string | null
}

interface ContaInfo {
  cedente_id: string
  identificador: string
}

function LoadingSkeleton() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-80" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-44 rounded-xl" />
      ))}
    </div>
  )
}

export default function AceiteCessaoPage() {
  const [nfs, setNfs] = useState<NfCessao[]>([])
  const [contas, setContas] = useState<ContaInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [contestando, setContestando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [preview, setPreview] = useState<{ nf: NfCessao; url: string } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  const loadData = async () => {
    const supabase = createClient()

    // NFs cedidas (em_antecipacao) destinadas a este sacado
    const { data: nfsData } = await supabase
      .from('notas_fiscais')
      .select('id, numero_nf, cnpj_emitente, razao_social_emitente, valor_bruto, data_vencimento, status, cedente_id, arquivo_url')
      .eq('status', 'em_antecipacao')
      .order('data_vencimento', { ascending: true })

    setNfs((nfsData || []) as NfCessao[])

    // Buscar contas escrow para mostrar dados de pagamento
    const { data: contasData } = await supabase
      .from('contas_escrow')
      .select('cedente_id, identificador')

    setContas((contasData || []) as ContaInfo[])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const openPreview = async (nf: NfCessao) => {
    if (!nf.arquivo_url) return
    setLoadingPreview(true)
    const supabase = createClient()
    const { data } = await supabase.storage
      .from(buckets.notasFiscais)
      .createSignedUrl(nf.arquivo_url, 3600)
    setPreview({ nf, url: data?.signedUrl || '' })
    setLoadingPreview(false)
  }

  const getContaEscrow = (cedenteId: string) => {
    return contas.find((c) => c.cedente_id === cedenteId)?.identificador || null
  }

  const handleAceitar = async (nfId: string) => {
    setProcessing(nfId)
    setMessage('')
    const result = await aceitarCessao(nfId)
    if (result?.success) {
      setMessage(result.message || 'Aceita!')
      setMessageType('success')
      await loadData()
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setProcessing(null)
  }

  const handleContestar = async (nfId: string) => {
    if (!motivo.trim()) {
      setMessage('Informe o motivo da contestacao.')
      setMessageType('error')
      return
    }
    setProcessing(nfId)
    const result = await contestarCessao(nfId, motivo)
    if (result?.success) {
      setMessage(result.message || 'Contestada.')
      setMessageType('success')
      setContestando(null)
      setMotivo('')
      await loadData()
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setProcessing(null)
  }

  if (loading) return <LoadingSkeleton />

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Aceite de Cessao</h1>
        <p className="text-muted-foreground">Confirme ou conteste as cessoes de credito das NFs emitidas contra voce.</p>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${
          messageType === 'success'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-red-50 text-destructive border-red-200'
        }`}>
          {message}
        </div>
      )}

      {nfs.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <CheckCircle size={48} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhuma cessao pendente de aceite.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {nfs.map((nf) => {
            const contaEscrow = getContaEscrow(nf.cedente_id)
            const isContestando = contestando === nf.id
            const isProcessing = processing === nf.id

            return (
              <Card key={nf.id} className="overflow-hidden">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Receipt size={18} className="text-purple-600" />
                        <span className="font-bold text-foreground text-lg">NF {nf.numero_nf}</span>
                        <Badge className="bg-purple-100 text-purple-700 border-purple-200">Cessao ativa</Badge>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">Cedente (Emitente)</span>
                          <p className="font-medium text-foreground">{nf.razao_social_emitente}</p>
                          <p className="text-xs text-muted-foreground">{formatCNPJ(nf.cnpj_emitente)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Valor</span>
                          <p className="font-bold text-lg tabular-nums">{formatCurrency(nf.valor_bruto)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Vencimento</span>
                          <p className="font-medium tabular-nums">{formatDate(nf.data_vencimento)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Status</span>
                          <p className="font-medium text-purple-700">Cessao ativa</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Conta escrow para pagamento */}
                  {contaEscrow && (
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg flex items-center gap-2 text-sm">
                      <Wallet size={16} className="text-blue-600" />
                      <span className="text-blue-700">
                        Conta para pagamento: <strong className="font-mono">{contaEscrow}</strong>
                      </span>
                    </div>
                  )}

                  {/* Acoes */}
                  {!isContestando && (
                    <div className="mt-4 flex gap-3 flex-wrap">
                      <Button
                        onClick={() => handleAceitar(nf.id)}
                        disabled={isProcessing}
                        className="bg-green-600 text-white hover:bg-green-700 gap-2"
                        size="sm"
                      >
                        <CheckCircle size={16} />
                        {isProcessing ? 'Processando...' : 'Aceitar Cessao'}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => setContestando(nf.id)}
                        size="sm"
                        className="gap-2"
                      >
                        <XCircle size={16} />
                        Contestar
                      </Button>
                      {nf.arquivo_url && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openPreview(nf)}
                          disabled={loadingPreview}
                          className="gap-1 text-muted-foreground hover:text-foreground"
                        >
                          {loadingPreview ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                          Ver NF
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Form contestacao */}
                  {isContestando && (
                    <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle size={16} className="text-destructive" />
                        <span className="font-medium text-red-800">Contestar Cessao</span>
                      </div>
                      <textarea
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Descreva o motivo da contestacao (obrigatorio)..."
                        rows={3}
                        className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm mb-3 bg-background"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setContestando(null); setMotivo('') }}
                        >
                          Cancelar
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleContestar(nf.id)}
                          disabled={isProcessing}
                        >
                          {isProcessing ? 'Enviando...' : 'Confirmar Contestacao'}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal de preview */}
      {preview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-border">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="font-semibold text-foreground">NF {preview.nf.numero_nf}</h3>
                <p className="text-xs text-muted-foreground">{preview.nf.razao_social_emitente} — {formatCurrency(preview.nf.valor_bruto)}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setPreview(null)}>
                <X size={20} />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {preview.url ? (
                preview.nf.arquivo_url?.toLowerCase().endsWith('.pdf') ? (
                  <iframe src={preview.url} className="w-full h-[600px] border rounded" />
                ) : (
                  <img src={preview.url} alt={`NF ${preview.nf.numero_nf}`} className="max-w-full mx-auto rounded" />
                )
              ) : (
                <p className="text-muted-foreground text-center py-10">Nao foi possivel carregar o arquivo.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
