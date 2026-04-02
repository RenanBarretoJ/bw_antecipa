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

interface OperacaoRecord {
  id: string
  valor_bruto_total: number
  taxa_desconto: number
  prazo_dias: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: string
  created_at: string
  motivo_reprovacao: string | null
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

export default function OperacoesCedentePage() {
  const [ops, setOps] = useState<OperacaoRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const loadOps = async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('operacoes')
      .select('id, valor_bruto_total, taxa_desconto, prazo_dias, valor_liquido_desembolso, data_vencimento, status, created_at, motivo_reprovacao')
      .order('created_at', { ascending: false })

    setOps((data || []) as OperacaoRecord[])
    setLoading(false)
  }

  useEffect(() => { loadOps() }, [])

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

      {/* Feedback message */}
      {message && (
        <div className="mb-4 p-3 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">
          {message}
        </div>
      )}

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

            return (
              <Card key={op.id}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-sm font-mono text-muted-foreground">
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
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">Valor Bruto</span>
                          <p className="font-bold tabular-nums">{formatCurrency(op.valor_bruto_total)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Taxa</span>
                          <p className="font-medium tabular-nums">
                            {op.taxa_desconto > 0 ? `${op.taxa_desconto}% a.m.` : 'A definir'}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Prazo</span>
                          <p className="font-medium tabular-nums">{op.prazo_dias} dias</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Valor Liquido</span>
                          <p className="font-bold text-green-700 dark:text-green-400 tabular-nums">
                            {formatCurrency(op.valor_liquido_desembolso)}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Vencimento</span>
                          <p className="font-medium">{formatDate(op.data_vencimento)}</p>
                        </div>
                      </div>
                      {op.motivo_reprovacao && (
                        <p className="mt-2 text-sm text-destructive">
                          Motivo: {op.motivo_reprovacao}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 ml-4">
                      {canCancel && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleCancel(op.id)}
                          disabled={cancelling === op.id}
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
                  <div className="mt-2 text-xs text-muted-foreground">
                    Criada em {formatDate(op.created_at)}
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
