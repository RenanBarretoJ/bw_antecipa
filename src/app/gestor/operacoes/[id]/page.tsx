'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { aprovarOperacao, desembolsarOperacao, reprovarOperacao, removerNfDaOperacao, salvarTestemunhasOperacao, salvarTermoAssinado, salvarComprovantePagamento, salvarNotificacaoAssinada } from '@/lib/actions/operacao'
import { liquidarOperacao, marcarInadimplente } from '@/lib/actions/liquidacao'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Banknote,
  FileText,
  FileDown,
  Calculator,
  Loader2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BotaoDownloadContrato } from '@/components/contratos/BotaoDownloadContrato'
import { UploadDocumentoAssinado } from '@/components/contratos/UploadDocumentoAssinado'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Testemunha {
  id: string
  nome: string
  cpf: string
}

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
  testemunha_1_id: string | null
  testemunha_2_id: string | null
  termo_assinado_url: string | null
  comprovante_pagamento_url: string | null
  notificacao_url: string | null
  notificacao_assinada_url: string | null
  cedentes: {
    razao_social: string
    cnpj: string
    contrato_url: string | null
    contrato_assinado_url: string | null
  }
}

interface NfDaOperacao {
  id: string
  numero_nf: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  valor_liquido: number
  valor_antecipado: number | null
  data_vencimento: string
  status: string
}

interface TaxaConfig {
  prazo_min: number
  prazo_max: number
  taxa_percentual: number
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link'

const statusConfig: Record<string, { label: string; variant: BadgeVariant; className: string; icon: typeof CheckCircle }> = {
  solicitada: { label: 'Solicitada', variant: 'secondary', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Clock },
  em_analise: { label: 'Em Analise', variant: 'secondary', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: AlertCircle },
  aprovada: { label: 'Aprovada — Aguard. Desembolso', variant: 'secondary', className: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400', icon: CheckCircle },
  em_andamento: { label: 'Em Andamento', variant: 'secondary', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: Banknote },
  liquidada: { label: 'Liquidada', variant: 'secondary', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: CheckCircle },
  inadimplente: { label: 'Inadimplente', variant: 'destructive', className: '', icon: AlertCircle },
  reprovada: { label: 'Reprovada', variant: 'destructive', className: '', icon: XCircle },
  cancelada: { label: 'Cancelada', variant: 'outline', className: 'text-muted-foreground', icon: XCircle },
}

function PageSkeleton() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-5 w-40" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-5 w-40" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-1">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-6 w-28" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <div>
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-5 w-32" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
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
  const [removendoNf, setRemovendoNf] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  // Campos de aprovacao
  const [taxa, setTaxa] = useState(0)
  const [valorLiquido, setValorLiquido] = useState(0)
  const [showReprovar, setShowReprovar] = useState(false)
  const [motivo, setMotivo] = useState('')

  // Testemunhas
  const [testemunhas, setTestemunhas] = useState<Testemunha[]>([])
  const [test1Id, setTest1Id] = useState('')
  const [test2Id, setTest2Id] = useState('')
  const [salvandoTest, setSalvandoTest] = useState(false)
  const [gerandoCnab, setGerandoCnab] = useState(false)

  // Estado local para docs (atualizado após upload sem reload da página)
  const [termoAssinadoUrl, setTermoAssinadoUrl] = useState<string | null>(null)
  const [comprovanteUrl, setComprovanteUrl] = useState<string | null>(null)
  const [notificacaoAssinadaUrl, setNotificacaoAssinadaUrl] = useState<string | null>(null)
  const [desembolsando, setDesembolsando] = useState(false)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const { data: opData } = await supabase
        .from('operacoes')
        .select('*, cedentes(razao_social, cnpj, contrato_url, contrato_assinado_url)')
        .eq('id', opId)
        .single()

      const { data: testData } = await supabase
        .from('testemunhas')
        .select('id, nome, cpf')
        .eq('ativo', true)
        .order('created_at', { ascending: true })
      setTestemunhas((testData || []) as Testemunha[])

      if (opData) {
        const o = opData as OperacaoDetalhe
        setOp(o)
        setTaxa(o.taxa_desconto)
        setValorLiquido(o.valor_liquido_desembolso)
        if (o.testemunha_1_id) setTest1Id(o.testemunha_1_id)
        if (o.testemunha_2_id) setTest2Id(o.testemunha_2_id)
        setTermoAssinadoUrl(o.termo_assinado_url)
        setComprovanteUrl(o.comprovante_pagamento_url)
        setNotificacaoAssinadaUrl(o.notificacao_assinada_url)

        const { data: opNfs } = await supabase
          .from('operacoes_nfs')
          .select('nota_fiscal_id')
          .eq('operacao_id', opId)

        if (opNfs) {
          const nfIds = (opNfs as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
          const { data: nfsData } = await supabase
            .from('notas_fiscais')
            .select('id, numero_nf, cnpj_destinatario, razao_social_destinatario, valor_bruto, valor_liquido, valor_antecipado, data_vencimento, status')
            .in('id', nfIds)
            .order('data_vencimento', { ascending: true })

          setNfs((nfsData || []) as NfDaOperacao[])
        }

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

  useEffect(() => {
    if (op && taxa >= 0 && nfs.length > 0) {
      const hoje = new Date()
      const total = nfs.reduce((acc, nf) => {
        const prazoDias = Math.max(1, Math.ceil(
          (new Date(nf.data_vencimento).getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)
        ))
        const fator = (1 + taxa / 100) ** (prazoDias / 30)
        const base = nf.valor_liquido || nf.valor_bruto
        return acc + Math.round((base / fator) * 100) / 100
      }, 0)
      setValorLiquido(Math.max(0, Math.round(total * 100) / 100))
    }
  }, [taxa, nfs, op])

  const calcularValorAntecipado = (valorBase: number, dataVencimento: string): number => {
    if (taxa < 0) return valorBase
    const prazoDias = Math.max(1, Math.ceil(
      (new Date(dataVencimento).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    ))
    const fator = Math.pow(1 + taxa / 100, prazoDias / 30)
    return Math.round((valorBase / fator) * 100) / 100
  }

  const aplicarTaxaConfig = (t: TaxaConfig) => {
    setTaxa(t.taxa_percentual)
  }

  const handleAprovar = async () => {
    if (taxa < 0) { setMessage('Taxa invalida.'); setMessageType('error'); return }
    if (valorLiquido <= 0) { setMessage('Valor liquido invalido.'); setMessageType('error'); return }

    setProcessing(true)
    const result = await aprovarOperacao(opId, taxa, valorLiquido)
    if (result?.success) {
      setMessage(result.message || 'Aprovada!')
      setMessageType('success')
      // Gerar Termo de Cessao automaticamente (non-blocking)
      fetch('/api/contratos/gerar-termo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operacao_id: opId }),
      }).catch(() => {})
      // Recarregar operacao e NFs para refletir valores salvos
      const supabase = createClient()
      const { data } = await supabase.from('operacoes').select('*, cedentes(razao_social, cnpj, contrato_url, contrato_assinado_url)').eq('id', opId).single()
      if (data) setOp(data as OperacaoDetalhe)
      const { data: opNfsAprov } = await supabase.from('operacoes_nfs').select('nota_fiscal_id').eq('operacao_id', opId)
      if (opNfsAprov) {
        const ids = (opNfsAprov as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
        if (ids.length > 0) {
          const { data: nfsAprov } = await supabase.from('notas_fiscais').select('id, numero_nf, cnpj_destinatario, razao_social_destinatario, valor_bruto, valor_liquido, valor_antecipado, data_vencimento, status').in('id', ids).order('data_vencimento', { ascending: true })
          setNfs((nfsAprov || []) as NfDaOperacao[])
        }
      }
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setProcessing(false)
  }

  const handleDesembolsar = async () => {
    setDesembolsando(true)
    const result = await desembolsarOperacao(opId)
    if (result?.success) {
      setMessage(result.message || 'Desembolso confirmado!')
      setMessageType('success')
      setTimeout(() => router.push('/gestor/operacoes'), 2000)
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setDesembolsando(false)
  }

  const handleRemoverNf = async (nfId: string) => {
    setRemovendoNf(nfId)
    const result = await removerNfDaOperacao(opId, nfId)
    setMessage(result?.message || 'Erro.')
    setMessageType(result?.success ? 'success' : 'error')
    if (result?.success) {
      const supabase = createClient()
      const { data: opAtual } = await supabase.from('operacoes').select('*, cedentes(razao_social, cnpj, contrato_url, contrato_assinado_url)').eq('id', opId).single()
      if (opAtual) setOp(opAtual as OperacaoDetalhe)
      const { data: opNfs } = await supabase.from('operacoes_nfs').select('nota_fiscal_id').eq('operacao_id', opId)
      if (opNfs) {
        const ids = (opNfs as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
        if (ids.length > 0) {
          const { data: nfsAtt } = await supabase.from('notas_fiscais').select('id, numero_nf, cnpj_destinatario, razao_social_destinatario, valor_bruto, valor_liquido, valor_antecipado, data_vencimento, status').in('id', ids).order('data_vencimento', { ascending: true })
          setNfs((nfsAtt || []) as NfDaOperacao[])
        } else {
          setNfs([])
        }
      }
    }
    setRemovendoNf(null)
  }

  const handleSalvarTestemunhas = async () => {
    if (!test1Id || !test2Id) { setMessage('Selecione as 2 testemunhas.'); setMessageType('error'); return }
    if (test1Id === test2Id) { setMessage('Selecione testemunhas diferentes.'); setMessageType('error'); return }
    setSalvandoTest(true)
    const result = await salvarTestemunhasOperacao(opId, test1Id, test2Id)
    setMessage(result?.message || '')
    setMessageType(result?.success ? 'success' : 'error')
    setSalvandoTest(false)
  }

  const handleGerarCnab = async () => {
    if (!op) return
    setGerandoCnab(true)
    try {
      const res = await fetch('/api/contratos/gerar-cnab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operacao_id: op.id }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erro ao gerar CNAB')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `REMESSA_${op.id.slice(0, 8).toUpperCase()}.REM`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erro ao gerar CNAB.')
      setMessageType('error')
    } finally {
      setGerandoCnab(false)
    }
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
    return <PageSkeleton />
  }

  if (!op) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Operacao nao encontrada.</p>
        <Link href="/gestor/operacoes" className="text-primary mt-2 inline-block">Voltar</Link>
      </div>
    )
  }

  const status = statusConfig[op.status] || statusConfig.solicitada
  const StatusIcon = status.icon
  const canAnalyze = op.status === 'solicitada' || op.status === 'em_analise'
  const canDisburse = op.status === 'aprovada'
  const canRemoveNf = ['solicitada', 'em_analise'].includes(op.status)
  const todasAceitas = nfs.length > 0 && nfs.every((nf) => nf.status === 'aceita')

  // Seção de documentos visível para aprovada, em_andamento, liquidada, inadimplente
  const showDocs = ['aprovada', 'em_andamento', 'liquidada', 'inadimplente'].includes(op.status)

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/gestor/operacoes">
            <Button variant="ghost" size="icon">
              <ArrowLeft size={20} />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Operacao #{op.id.substring(0, 8)}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={status.variant} className={status.className}>
                <StatusIcon size={12} />
                {status.label}
              </Badge>
              <span className="text-sm text-muted-foreground">| {op.cedentes.razao_social} ({formatCNPJ(op.cedentes.cnpj)})</span>
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          messageType === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
            : 'bg-destructive/10 text-destructive border border-destructive/20'
        }`}>
          {message}
        </div>
      )}

      {/* Modal reprovar */}
      {showReprovar && (
        <div className="mb-6 bg-destructive/10 border border-destructive/20 rounded-xl p-4">
          <h3 className="font-semibold text-destructive mb-2">Reprovar Operacao</h3>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo da reprovacao (obrigatorio)..."
            rows={3}
            className="w-full border border-destructive/30 rounded-lg px-3 py-2 text-sm mb-3 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-destructive/50"
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowReprovar(false); setMotivo('') }}>
              Cancelar
            </Button>
            <Button variant="destructive" size="sm" onClick={handleReprovar} disabled={processing}>
              {processing ? <><Loader2 size={14} className="animate-spin" /> Reprovando...</> : 'Confirmar'}
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* NFs da operacao */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText size={18} />
                Notas Fiscais ({nfs.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase">NF</th>
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase">Sacado</th>
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase">Valor</th>
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase">Vl. Antecipado</th>
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase">Prazo</th>
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase">Vencimento</th>
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase">Status</th>
                      {canRemoveNf && <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase">Ação</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {nfs.map((nf) => {
                      const prazoDias = Math.max(1, Math.ceil(
                        (new Date(nf.data_vencimento).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                      ))
                      return (
                      <tr key={nf.id} className={`hover:bg-muted/30 ${nf.status === 'contestada' ? 'bg-orange-50' : ''}`}>
                        <td className="px-3 py-2 font-medium tabular-nums">{nf.numero_nf}</td>
                        <td className="px-3 py-2 max-w-[180px]">
                          <p className="text-foreground truncate" title={nf.razao_social_destinatario}>{nf.razao_social_destinatario}</p>
                          <p className="text-xs text-muted-foreground">{formatCNPJ(nf.cnpj_destinatario)}</p>
                        </td>
                        <td className="px-3 py-2 font-medium tabular-nums">{formatCurrency(nf.valor_bruto)}</td>
                        <td className="px-3 py-2 tabular-nums text-green-700 font-medium">
                          {formatCurrency(
                            (op?.status === 'solicitada' || op?.status === 'em_analise')
                              ? calcularValorAntecipado(nf.valor_liquido || nf.valor_bruto, nf.data_vencimento)
                              : (nf.valor_antecipado ?? nf.valor_liquido ?? nf.valor_bruto)
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground text-xs">{prazoDias}d</td>
                        <td className="px-3 py-2">{formatDate(nf.data_vencimento)}</td>
                        <td className="px-3 py-2">
                          {nf.status === 'aceita' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 whitespace-nowrap">
                              <CheckCircle size={11} /> Aprov. Sacado
                            </span>
                          )}
                          {nf.status === 'contestada' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">Contestada</span>
                          )}
                          {nf.status === 'em_antecipacao' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Aguard. aprovação</span>
                          )}
                        </td>
                        {canRemoveNf && (
                          <td className="px-3 py-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={removendoNf === nf.id}
                              onClick={() => handleRemoverNf(nf.id)}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              {removendoNf === nf.id ? <Loader2 size={14} className="animate-spin" /> : 'Remover'}
                            </Button>
                          </td>
                        )}
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>

            {op.motivo_reprovacao && (
              <div className="p-3 bg-destructive/10 rounded-lg text-sm text-destructive">
                <strong>Motivo da reprovacao:</strong> {op.motivo_reprovacao}
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">

          {/* ETAPA 1: Definir termos (solicitada / em_analise) */}
          {canAnalyze && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calculator size={18} className="text-primary" />
                  Definir Termos
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                {taxasConfig.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Taxas pre-configuradas</p>
                    <div className="space-y-1">
                      {taxasConfig.map((t, i) => (
                        <button
                          key={i}
                          onClick={() => aplicarTaxaConfig(t)}
                          className={`w-full flex justify-between text-xs px-3 py-2 rounded-lg transition-colors ${
                            taxa === t.taxa_percentual
                              ? 'bg-primary/10 text-primary font-medium'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          <span className="tabular-nums">{t.prazo_min}-{t.prazo_max} dias</span>
                          <span className="tabular-nums">{t.taxa_percentual}% a.m.</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="taxa">Taxa (% a.m.)</Label>
                    <Input
                      id="taxa"
                      type="number"
                      step="0.01"
                      min="0"
                      value={taxa}
                      onChange={(e) => setTaxa(parseFloat(e.target.value) || 0)}
                      className="h-11 tabular-nums"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="valorLiquido">Valor Liquido Desembolso</Label>
                    <Input
                      id="valorLiquido"
                      type="number"
                      step="0.01"
                      min="0"
                      value={valorLiquido}
                      onChange={(e) => setValorLiquido(parseFloat(e.target.value) || 0)}
                      className="h-11 tabular-nums"
                    />
                  </div>
                </div>

                {testemunhas.length > 0 && (
                  <div className="space-y-2 border-t pt-4">
                    <p className="text-xs font-medium text-muted-foreground">Testemunhas do Termo</p>
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Testemunha 1</Label>
                        <Select value={test1Id} onValueChange={(v) => setTest1Id(v ?? '')}>
                          <SelectTrigger className="h-9 text-xs w-full">
                            <SelectValue placeholder="Selecionar...">
                              {test1Id ? (
                                <span className="truncate max-w-[160px] block">
                                  {testemunhas.find(t => t.id === test1Id)?.nome ?? test1Id}
                                </span>
                              ) : undefined}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="max-w-[260px]">
                            {testemunhas.filter(t => t.id !== test2Id).map((t) => (
                              <SelectItem key={t.id} value={t.id} className="text-xs">
                                <span className="truncate">{t.nome} — {t.cpf}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Testemunha 2</Label>
                        <Select value={test2Id} onValueChange={(v) => setTest2Id(v ?? '')}>
                          <SelectTrigger className="h-9 text-xs w-full">
                            <SelectValue placeholder="Selecionar...">
                              {test2Id ? (
                                <span className="truncate max-w-[160px] block">
                                  {testemunhas.find(t => t.id === test2Id)?.nome ?? test2Id}
                                </span>
                              ) : undefined}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="max-w-[260px]">
                            {testemunhas.filter(t => t.id !== test1Id).map((t) => (
                              <SelectItem key={t.id} value={t.id} className="text-xs">
                                <span className="truncate">{t.nome} — {t.cpf}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSalvarTestemunhas}
                        disabled={salvandoTest}
                        className="w-full text-xs"
                      >
                        {salvandoTest ? <Loader2 size={12} className="animate-spin" /> : null}
                        Salvar Testemunhas
                      </Button>
                    </div>
                  </div>
                )}

                <div className="p-3 bg-muted/50 rounded-lg space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bruto</span>
                    <span className="font-medium tabular-nums">{formatCurrency(op.valor_bruto_total)}</span>
                  </div>
                  <div className="flex justify-between text-destructive">
                    <span className="tabular-nums">(-) Desconto ({taxa}% a.m., prazo por NF)</span>
                    <span className="tabular-nums">{formatCurrency(op.valor_bruto_total - valorLiquido)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-semibold">Liquido</span>
                    <span className="font-bold text-green-700 dark:text-green-400 text-lg tabular-nums">{formatCurrency(valorLiquido)}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  {!todasAceitas && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2">
                      Aguardando aprovação de todas as NFs pelo sacado antes de aprovar.
                    </p>
                  )}
                  <Button
                    onClick={handleAprovar}
                    disabled={processing || !todasAceitas}
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white h-11 disabled:opacity-50"
                  >
                    {processing ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                    {processing ? 'Processando...' : 'Aprovar e Seguir'}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setShowReprovar(true)}
                    disabled={processing}
                    className="w-full"
                  >
                    <XCircle size={16} />
                    Reprovar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ETAPA 2: Documentos e desembolso (status aprovada) */}
          {canDisburse && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Resumo</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor Bruto</span>
                  <span className="font-bold tabular-nums">{formatCurrency(op.valor_bruto_total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Taxa</span>
                  <span className="font-medium tabular-nums">{op.taxa_desconto}% a.m.</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Prazo</span>
                  <span className="font-medium tabular-nums">{op.prazo_dias} dias</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-semibold">Valor Liquido</span>
                  <span className="font-bold text-green-700 dark:text-green-400 tabular-nums">{formatCurrency(op.valor_liquido_desembolso)}</span>
                </div>
                {op.aprovado_em && (
                  <div className="flex justify-between text-muted-foreground text-xs mt-2">
                    <span>Aprovada em</span>
                    <span>{formatDate(op.aprovado_em)}</span>
                  </div>
                )}

                <div className="border-t pt-4 mt-2 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">Documentos gerados</p>
                  <div className="flex flex-col gap-2">
                    <BotaoDownloadContrato
                      tipo="contrato"
                      id={op.cedente_id}
                      storagePath={op.cedentes.contrato_url}
                      hasSignedDoc={!!op.cedentes.contrato_assinado_url}
                      label="Contrato Mae"
                      className="w-full"
                    />
                    <BotaoDownloadContrato
                      tipo="termo"
                      id={op.id}
                      storagePath={(op as unknown as Record<string, unknown>).termo_url as string | null}
                      hasSignedDoc={!!termoAssinadoUrl}
                      className="w-full"
                    />
                    <BotaoDownloadContrato
                      tipo="notificacao"
                      id={op.id}
                      storagePath={(op as unknown as Record<string, unknown>).notificacao_url as string | null}
                      hasSignedDoc={!!notificacaoAssinadaUrl}
                      label="Notificacao ao Sacado"
                      className="w-full"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGerarCnab}
                    disabled={gerandoCnab}
                    className="w-full gap-2"
                  >
                    {gerandoCnab ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                    {gerandoCnab ? 'Gerando...' : 'Gerar CNAB'}
                  </Button>

                  <p className="text-xs font-medium text-muted-foreground border-t pt-3">Documentos assinados</p>
                  <div className="flex flex-col gap-2">
                    <UploadDocumentoAssinado
                      label="Termo de Cessao Assinado"
                      storagePath={termoAssinadoUrl}
                      uploadPath={`operacoes/${op.id}/termo-cessao-assinado.pdf`}
                      onSuccess={async (path) => {
                        await salvarTermoAssinado(op.id, path)
                        setTermoAssinadoUrl(path)
                      }}
                    />
                    <UploadDocumentoAssinado
                      label="Notificacao ao Sacado Assinada"
                      storagePath={notificacaoAssinadaUrl}
                      uploadPath={`operacoes/${op.id}/notificacao-cessao-assinada.pdf`}
                      onSuccess={async (path) => {
                        await salvarNotificacaoAssinada(op.id, path)
                        setNotificacaoAssinadaUrl(path)
                      }}
                    />
                    <UploadDocumentoAssinado
                      label="Comprovante de Desembolso (TED)"
                      storagePath={comprovanteUrl}
                      uploadPath={`operacoes/${op.id}/comprovante-pagamento.pdf`}
                      accept="application/pdf,image/jpeg,image/png"
                      onSuccess={async (path) => {
                        await salvarComprovantePagamento(op.id, path)
                        setComprovanteUrl(path)
                      }}
                    />
                  </div>

                  {(!termoAssinadoUrl || !comprovanteUrl) && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2">
                      Envie os documentos assinados e o comprovante TED para liberar o desembolso.
                    </p>
                  )}

                  <Button
                    onClick={handleDesembolsar}
                    disabled={desembolsando || !termoAssinadoUrl || !comprovanteUrl}
                    className="w-full bg-green-600 hover:bg-green-700 text-white h-11 disabled:opacity-50"
                  >
                    {desembolsando ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                    {desembolsando ? 'Processando...' : 'Desembolsar'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ETAPA 3: Em andamento / liquidação */}
          {!canAnalyze && !canDisburse && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Resumo</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor Bruto</span>
                  <span className="font-bold tabular-nums">{formatCurrency(op.valor_bruto_total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Taxa</span>
                  <span className="font-medium tabular-nums">{op.taxa_desconto}% a.m.</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Prazo</span>
                  <span className="font-medium tabular-nums">{op.prazo_dias} dias</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-semibold">Valor Liquido</span>
                  <span className="font-bold text-green-700 dark:text-green-400 tabular-nums">{formatCurrency(op.valor_liquido_desembolso)}</span>
                </div>
                {op.aprovado_em && (
                  <div className="flex justify-between text-muted-foreground text-xs mt-2">
                    <span>Aprovada em</span>
                    <span>{formatDate(op.aprovado_em)}</span>
                  </div>
                )}

                {(op.status === 'em_andamento' || op.status === 'inadimplente') && (
                  <div className="space-y-2 border-t pt-4 mt-2">
                    <Button
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
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                    >
                      {processing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                      {processing ? 'Processando...' : 'Confirmar Liquidacao'}
                    </Button>
                    {op.status === 'em_andamento' && (
                      <Button
                        variant="destructive"
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
                        className="w-full"
                      >
                        <AlertCircle size={14} />
                        Marcar Inadimplente
                      </Button>
                    )}
                  </div>
                )}

                {/* Documentos para operacoes legadas (em_andamento sem docs ainda) */}
                {showDocs && !canDisburse && (
                  <div className="border-t pt-4 mt-2 space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">Documentos gerados</p>
                    <div className="flex flex-col gap-2">
                      <BotaoDownloadContrato
                        tipo="contrato"
                        id={op.cedente_id}
                        storagePath={op.cedentes.contrato_url}
                        hasSignedDoc={!!op.cedentes.contrato_assinado_url}
                        label="Contrato Mae"
                        className="w-full"
                      />
                      <BotaoDownloadContrato
                        tipo="termo"
                        id={op.id}
                        storagePath={(op as unknown as Record<string, unknown>).termo_url as string | null}
                        hasSignedDoc={!!termoAssinadoUrl}
                        className="w-full"
                      />
                      <BotaoDownloadContrato
                        tipo="notificacao"
                        id={op.id}
                        storagePath={(op as unknown as Record<string, unknown>).notificacao_url as string | null}
                        hasSignedDoc={!!notificacaoAssinadaUrl}
                        label="Notificacao ao Sacado"
                        className="w-full"
                      />
                    </div>
                    <p className="text-xs font-medium text-muted-foreground border-t pt-3">Documentos assinados</p>
                    <div className="flex flex-col gap-2">
                      <UploadDocumentoAssinado
                        label="Termo de Cessao Assinado"
                        storagePath={termoAssinadoUrl}
                        uploadPath={`operacoes/${op.id}/termo-cessao-assinado.pdf`}
                        onSuccess={async (path) => {
                          await salvarTermoAssinado(op.id, path)
                          setTermoAssinadoUrl(path)
                        }}
                      />
                      <UploadDocumentoAssinado
                        label="Notificacao ao Sacado Assinada"
                        storagePath={notificacaoAssinadaUrl}
                        uploadPath={`operacoes/${op.id}/notificacao-cessao-assinada.pdf`}
                        onSuccess={async (path) => {
                          await salvarNotificacaoAssinada(op.id, path)
                          setNotificacaoAssinadaUrl(path)
                        }}
                      />
                      <UploadDocumentoAssinado
                        label="Comprovante de Pagamento"
                        storagePath={comprovanteUrl}
                        uploadPath={`operacoes/${op.id}/comprovante-pagamento.pdf`}
                        accept="application/pdf,image/jpeg,image/png"
                        onSuccess={async (path) => {
                          await salvarComprovantePagamento(op.id, path)
                          setComprovanteUrl(path)
                        }}
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGerarCnab}
                      disabled={gerandoCnab}
                      className="w-full gap-2"
                    >
                      {gerandoCnab ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                      {gerandoCnab ? 'Gerando...' : 'Gerar CNAB'}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {canAnalyze && (
            <Link
              href={`/gestor/cedentes/${op.cedente_id}`}
              className="block text-center text-sm text-primary hover:underline"
            >
              Gerenciar taxas deste cedente
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
