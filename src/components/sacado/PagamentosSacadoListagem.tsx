'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  Search,
  Send,
  Wallet,
} from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { confirmarPagamento } from '@/lib/actions/sacado'
import type {
  FiltrosPagamentosSacado,
  ResultadoPagamentosSacado,
} from '@/lib/sacado/portal-listagens'
import { buildListUrl } from '@/lib/pagination'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'
import { ListNameCell } from '@/components/data-display/primitives'
import { useNotifications } from '@/components/notifications/notification-provider'
import { ListPagination } from '@/components/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const statusConfig: Record<string, { label: string; className: string }> = {
  em_andamento: {
    label: 'A pagar',
    className: 'border-yellow-200 bg-yellow-100 text-yellow-700',
  },
  liquidada: {
    label: 'Pago',
    className: 'border-green-200 bg-green-100 text-green-700',
  },
  inadimplente: {
    label: 'Inadimplente',
    className: 'border-red-200 bg-red-100 text-red-700',
  },
}

export function PagamentosSacadoListagem({
  filtros,
  resultado,
}: {
  filtros: FiltrosPagamentosSacado
  resultado: ResultadoPagamentosSacado
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const notifications = useNotifications()
  const [isPending, startTransition] = useTransition()
  const [busca, setBusca] = useState(filtros.q)
  const [sending, setSending] = useState<string | null>(null)
  const currentParams = useMemo(
    () => Object.fromEntries(searchParams.entries()),
    [searchParams],
  )

  const navegar = (updates: Record<string, string | number | null>) => {
    startTransition(() => {
      router.replace(buildListUrl(pathname, currentParams, updates))
    })
  }

  useEffect(() => {
    if (busca === filtros.q) return
    const timer = window.setTimeout(
      () => navegar({ q: busca || null, page: 1 }),
      350,
    )
    return () => window.clearTimeout(timer)
    // A navegação é deliberadamente derivada da URL atual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, filtros.q])

  const handleConfirmarPagamento = async (operacaoId: string) => {
    setSending(operacaoId)
    const result = await confirmarPagamento(operacaoId)
    notifications.fromActionResult(
      result,
      'Não foi possível confirmar o pagamento.',
    )
    if (result?.success) startTransition(() => router.refresh())
    setSending(null)
  }

  const hoje = new Date().toISOString().slice(0, 10)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">
          Histórico de Pagamentos
        </h1>
        <p className="text-muted-foreground">
          Acompanhe e confirme pagamentos das operações.
        </p>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="rounded-xl bg-yellow-50 p-5 dark:bg-yellow-950/20">
          <div className="mb-1 flex items-center gap-2">
            <Clock size={18} className="text-yellow-600" />
            <span className="text-xs text-yellow-700 dark:text-yellow-400">
              A pagar nesta página
            </span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-yellow-700 dark:text-yellow-300">
            {formatCurrency(resultado.indicadoresPagina.totalAPagar)}
          </p>
        </div>
        <div className="rounded-xl bg-green-50 p-5 dark:bg-green-950/20">
          <div className="mb-1 flex items-center gap-2">
            <CheckCircle size={18} className="text-green-600" />
            <span className="text-xs text-green-700 dark:text-green-400">
              Pago nesta página
            </span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-green-700 dark:text-green-300">
            {formatCurrency(resultado.indicadoresPagina.totalPago)}
          </p>
        </div>
        <div className="rounded-xl bg-blue-50 p-5 dark:bg-blue-950/20">
          <div className="mb-1 flex items-center gap-2">
            <Wallet size={18} className="text-blue-600" />
            <span className="text-xs text-blue-700 dark:text-blue-400">
              Operações nesta página
            </span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-blue-700 dark:text-blue-300">
            {resultado.indicadoresPagina.totalOperacoes}
          </p>
        </div>
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        Os indicadores consideram os registros exibidos na página atual.
      </p>

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                placeholder="Buscar por cedente..."
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                className="h-11 pl-9"
              />
            </div>
            <select
              value={filtros.status || 'todos'}
              onChange={(event) => navegar({
                status: event.target.value === 'todos' ? null : event.target.value,
                page: 1,
              })}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="todos">Todos</option>
              <option value="em_andamento">A pagar</option>
              <option value="liquidada">Pagos</option>
              <option value="inadimplente">Inadimplentes</option>
            </select>
            <select
              value={`${filtros.sort}:${filtros.direction}`}
              onChange={(event) => {
                const [sort, direction] = event.target.value.split(':')
                navegar({ sort, direction, page: 1 })
              }}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="liquidada_em:desc">Pagamento mais recente</option>
              <option value="data_vencimento:asc">Vencimento mais próximo</option>
              <option value="valor_bruto_total:desc">Maior valor</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {resultado.items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Wallet
              size={48}
              className="mx-auto mb-3 text-muted-foreground/30"
            />
            <p className="text-muted-foreground">
              Nenhuma operação encontrada.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className={isPending ? 'space-y-3 opacity-70' : 'space-y-3'}>
          {resultado.items.map((operacao) => {
            const status = statusConfig[operacao.status]
            const vencido = operacao.status === 'em_andamento'
              && Boolean(operacao.vencimentoEm)
              && operacao.vencimentoEm! < hoje
            const isSending = sending === operacao.id

            return (
              <Card
                key={operacao.id}
                className={vencido ? 'overflow-hidden border-red-300' : 'overflow-hidden'}
              >
                <CardContent className="p-5">
                  <div className="flex flex-col items-start justify-between gap-4 md:flex-row">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-3">
                        <span className="font-mono text-sm tabular-nums text-muted-foreground">
                          #{operacao.codigo}
                        </span>
                        <Badge className={status?.className || 'bg-muted text-foreground'}>
                          {status?.label || operacao.status}
                        </Badge>
                        {vencido && (
                          <Badge className="gap-1 border-red-200 bg-red-100 text-red-700">
                            <AlertTriangle size={12} /> Vencido
                          </Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                        <div className="min-w-0">
                          <span className="text-xs text-muted-foreground">
                            Cedente
                          </span>
                          <ListNameCell
                            name={operacao.cedente.nome}
                            subline={operacao.cedente.cnpj
                              ? formatCNPJ(operacao.cedente.cnpj)
                              : '—'}
                          />
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">
                            Valor
                          </span>
                          <p className="text-lg font-bold tabular-nums">
                            {formatCurrency(operacao.valorOriginal)}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">
                            Vencimento
                          </span>
                          <p className={vencido
                            ? 'font-medium tabular-nums text-destructive'
                            : 'font-medium tabular-nums'}
                          >
                            {operacao.vencimentoEm
                              ? formatDate(operacao.vencimentoEm)
                              : '—'}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">
                            Pago em
                          </span>
                          <p className="font-medium tabular-nums">
                            {operacao.pagoEm ? formatDate(operacao.pagoEm) : '—'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {operacao.status === 'em_andamento' && (
                      <Button
                        onClick={() => handleConfirmarPagamento(operacao.id)}
                        disabled={isSending}
                        className="shrink-0 gap-2 bg-green-600 text-white hover:bg-green-700"
                        size="sm"
                      >
                        {isSending
                          ? <Loader2 size={16} className="animate-spin" />
                          : <Send size={16} />}
                        {isSending ? 'Enviando...' : 'Informar Pagamento'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}

          <ListPagination
            className="rounded-xl border bg-card px-4 py-3"
            pagination={resultado.pagination}
            disabled={isPending}
            onPageChange={(page) => navegar({ page })}
            onPageSizeChange={(pageSize) => navegar({ pageSize, page: 1 })}
          />
        </div>
      )}
    </div>
  )
}
