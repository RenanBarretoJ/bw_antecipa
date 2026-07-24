'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cancelarOperacao } from '@/lib/actions/operacao'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  Plus,
  XCircle,
  Clock,
  CheckCircle,
  AlertCircle,
  Banknote,
  Filter,
  Loader2,
  FileCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useNotifications } from '@/components/notifications/notification-provider'

interface OperacaoRecord {
  id: string
  valor_bruto_total: number
  taxa_desconto: number
  prazo_dias: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: string
  aceite_sacado_exigido: boolean | null
  aceite_sacado_status: string | null
  created_at: string
  motivo_reprovacao: string | null
  quitacao_assinada_url: string | null
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link'

const statusConfig: Record<
  string,
  { label: string; variant: BadgeVariant; className: string; icon: typeof CheckCircle }
> = {
  solicitada: {
    label: 'Solicitada',
    variant: 'secondary',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    icon: Clock,
  },
  em_analise: {
    label: 'Em Analise',
    variant: 'secondary',
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    icon: AlertCircle,
  },
  aprovada: {
    label: 'Aprovada',
    variant: 'secondary',
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    icon: CheckCircle,
  },
  em_andamento: {
    label: 'Em Andamento',
    variant: 'secondary',
    className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    icon: Banknote,
  },
  liquidada: {
    label: 'Liquidada',
    variant: 'secondary',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    icon: CheckCircle,
  },
  inadimplente: {
    label: 'Inadimplente',
    variant: 'destructive',
    className: '',
    icon: AlertCircle,
  },
  reprovada: {
    label: 'Reprovada',
    variant: 'destructive',
    className: '',
    icon: XCircle,
  },
  cancelada: {
    label: 'Cancelada',
    variant: 'outline',
    className: 'text-muted-foreground',
    icon: XCircle,
  },
}

function OperacaoSkeleton() {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="h-7 w-20 ml-4" />
        </div>
        <Skeleton className="h-3 w-32 mt-3" />
      </CardContent>
    </Card>
  )
}

function getCedenteOperacaoHint(op: OperacaoRecord) {
  if (op.status === 'aprovada') return 'Aprovada. Aguardando desembolso.'
  if (op.status === 'em_andamento') return 'Desembolso realizado. Operação em andamento.'
  if (op.status === 'liquidada') return 'Operação liquidada.'
  if (op.status === 'inadimplente') return 'Operação inadimplente.'
  if (op.status === 'reprovada' || op.status === 'cancelada') return null
  if (op.aceite_sacado_status === 'contestado') return 'Contestada pelo sacado.'
  if (op.status === 'solicitada' || op.status === 'em_analise') {
    if (op.aceite_sacado_exigido === false || op.aceite_sacado_status === 'dispensado' || op.aceite_sacado_status === 'aceito') {
      return 'Aguardando análise da gestora.'
    }
    return 'Aguardando aceite do sacado.'
  }
  return null
}

export default function OperacoesCedentePage() {
  const notifications = useNotifications()
  const [ops, setOps] = useState<OperacaoRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [baixandoQuitacao, setBaixandoQuitacao] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!message) return
    notifications.notify({ type: message.toLowerCase().includes('erro') ? 'error' : 'success', message, dedupeKey: `operacoes:${message}` })
    queueMicrotask(() => setMessage(''))
  }, [message, notifications])

  const loadOps = async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('operacoes')
      .select('id, valor_bruto_total, taxa_desconto, prazo_dias, valor_liquido_desembolso, data_vencimento, status, created_at, motivo_reprovacao, quitacao_assinada_url, aceite_sacado_exigido, aceite_sacado_status')
      .order('created_at', { ascending: false })

    setOps((data || []) as OperacaoRecord[])
    setLoading(false)
  }

  useEffect(() => { loadOps() }, [])

  const handleBaixarQuitacao = async (op: OperacaoRecord) => {
    if (!op.quitacao_assinada_url) return
    setBaixandoQuitacao(op.id)
    try {
      const params = new URLSearchParams({
        tipo_entidade: 'operacao',
        entidade_id: op.id,
        tipo_documento: 'quitacao_assinada',
      })
      const res = await fetch(`/api/contratos/download?${params.toString()}`)
      const data = await res.json()
      if (data.url) window.open(data.url, '_blank')
      else setMessage('Erro ao obter link do termo de quitacao.')
    } catch {
      setMessage('Erro ao baixar termo de quitacao.')
    } finally {
      setBaixandoQuitacao(null)
    }
  }

  const handleCancel = async (id: string) => {
    setCancelling(id)
    const result = await cancelarOperacao(id)
    if (result?.success) {
      setMessage(result.message || 'Cancelada.')
      await loadOps()
    } else {
      setMessage(result?.message || 'Erro.')
    }
    setCancelling(null)
  }

  const opsFiltradas = filtroStatus === 'todos' ? ops : ops.filter((o) => o.status === filtroStatus)

  const valorAtivo = ops
    .filter((o) => o.status === 'em_andamento')
    .reduce((acc, o) => acc + o.valor_liquido_desembolso, 0)

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Minhas Operacoes</h1>
          <p className="text-muted-foreground">Acompanhe suas solicitacoes de antecipacao.</p>
        </div>
        <Link href="/cedente/operacoes/nova">
          <Button>
            <Plus />
            Nova Solicitacao
          </Button>
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card className="bg-blue-50 dark:bg-blue-900/20 ring-blue-200 dark:ring-blue-800">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Total</p>
            <div className="text-2xl font-bold text-blue-700 dark:text-blue-300 tabular-nums">
              {loading ? <Skeleton className="h-8 w-10 mt-1" /> : ops.length}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-yellow-50 dark:bg-yellow-900/20 ring-yellow-200 dark:ring-yellow-800">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-medium text-yellow-600 dark:text-yellow-400">Pendentes</p>
            <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-300 tabular-nums">
              {loading ? (
                <Skeleton className="h-8 w-10 mt-1" />
              ) : (
                ops.filter((o) => o.status === 'solicitada' || o.status === 'em_analise').length
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-purple-50 dark:bg-purple-900/20 ring-purple-200 dark:ring-purple-800">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-medium text-purple-600 dark:text-purple-400">Em Andamento</p>
            <div className="text-2xl font-bold text-purple-700 dark:text-purple-300 tabular-nums">
              {loading ? (
                <Skeleton className="h-8 w-10 mt-1" />
              ) : (
                ops.filter((o) => o.status === 'em_andamento').length
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-green-50 dark:bg-green-900/20 ring-green-200 dark:ring-green-800">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-medium text-green-600 dark:text-green-400">Valor Ativo</p>
            <div className="text-2xl font-bold text-green-700 dark:text-green-300 tabular-nums">
              {loading ? <Skeleton className="h-8 w-28 mt-1" /> : formatCurrency(valorAtivo)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <Card className="mb-4">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-muted-foreground shrink-0" />
            <Select value={filtroStatus} onValueChange={(v) => { if (v) setFiltroStatus(v) }}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="solicitada">Solicitadas</SelectItem>
                <SelectItem value="em_andamento">Em Andamento</SelectItem>
                <SelectItem value="liquidada">Liquidadas</SelectItem>
                <SelectItem value="reprovada">Reprovadas</SelectItem>
                <SelectItem value="cancelada">Canceladas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <OperacaoSkeleton key={i} />
          ))}
        </div>
      ) : opsFiltradas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Banknote size={48} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhuma operacao encontrada.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {opsFiltradas.map((op) => {
            const status = statusConfig[op.status] || statusConfig.solicitada
            const StatusIcon = status.icon
            const canCancel = op.status === 'solicitada' || op.status === 'em_analise'
            const operationHint = getCedenteOperacaoHint(op)

            return (
              <Card key={op.id} className="overflow-hidden transition-colors hover:border-primary/35 hover:shadow-sm">
                <CardContent className="p-0">
                  <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
                    <Link
                      href={`/cedente/operacoes/${op.id}`}
                      className="min-w-0 flex-1 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Ver detalhes da operação ${op.id.substring(0, 8)}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-foreground">
                              #{op.id.substring(0, 8)}
                            </span>
                            <Badge
                              variant={status.variant}
                              className={status.className || undefined}
                            >
                              <StatusIcon size={12} />
                              {status.label}
                            </Badge>
                          </div>
                          {operationHint && <p className="mt-2 text-sm text-muted-foreground">{operationHint}</p>}
                          {op.motivo_reprovacao && (
                            <p className="mt-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                              Motivo: {op.motivo_reprovacao}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground sm:justify-end">
                          <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1">
                            Criada em {formatDate(op.created_at)}
                          </span>
                          <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1">
                            Vence em {formatDate(op.data_vencimento)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
                        <div className="rounded-xl border border-border bg-muted/25 p-3">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Valor bruto</span>
                          <p className="mt-1 text-base font-bold tabular-nums text-foreground">{formatCurrency(op.valor_bruto_total)}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-muted/25 p-3">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Taxa</span>
                          <p className="mt-1 text-base font-semibold tabular-nums text-foreground">
                            {op.taxa_desconto > 0 ? `${op.taxa_desconto}% a.m.` : 'A definir'}
                          </p>
                        </div>
                        <div className="rounded-xl border border-border bg-muted/25 p-3">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Prazo</span>
                          <p className="mt-1 text-base font-semibold tabular-nums text-foreground">{op.prazo_dias} dias</p>
                        </div>
                        <div className="rounded-xl border border-success/25 bg-success/10 p-3">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-success-foreground/75">Valor líquido</span>
                          <p className="mt-1 text-base font-bold text-success-foreground tabular-nums">
                            {formatCurrency(op.valor_liquido_desembolso)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-border bg-muted/25 p-3">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Vencimento</span>
                          <p className="mt-1 text-base font-semibold tabular-nums text-foreground">{formatDate(op.data_vencimento)}</p>
                        </div>
                      </div>
                    </Link>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border pt-4 lg:min-w-[150px] lg:flex-col lg:items-stretch lg:border-t-0 lg:pt-0">
                      <Link
                        href={`/cedente/operacoes/${op.id}`}
                        className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
                      >
                        Ver detalhes
                      </Link>
                      {op.status === 'liquidada' && op.quitacao_assinada_url && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleBaixarQuitacao(op)}
                          disabled={baixandoQuitacao === op.id}
                          className="justify-center"
                        >
                          {baixandoQuitacao === op.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <FileCheck size={14} />
                          )}
                          Termo de Quitacao
                        </Button>
                      )}
                      {canCancel && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleCancel(op.id)}
                          disabled={cancelling === op.id}
                          className="justify-center"
                        >
                          {cancelling === op.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <XCircle size={14} />
                          )}
                          {cancelling === op.id ? 'Cancelando...' : 'Cancelar'}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
