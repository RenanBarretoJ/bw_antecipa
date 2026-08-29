'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Calendar, Search } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ListPagination } from '@/components/pagination'
import { RemoteEntitySelector } from '@/components/selectors/RemoteEntitySelector'
import { Input } from '@/components/ui/input'
import {
  buildListUrl,
  type PaginationMeta,
} from '@/lib/pagination'
import type { RelatorioFiltros } from '@/lib/analytics/contracts'

export function RelatorioFilters({
  filtros,
  meses,
  statusOptions,
}: {
  filtros: RelatorioFiltros
  meses: string[]
  statusOptions: Array<{ value: string; label: string }>
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const current = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams])
  const [busca, setBusca] = useState(filtros.q)
  const [isPending, startTransition] = useTransition()

  const navegar = (updates: Record<string, string | number | null>) => {
    startTransition(() => router.replace(buildListUrl(pathname, current, updates)))
  }

  useEffect(() => {
    if (busca === filtros.q) return
    const timer = window.setTimeout(() => navegar({ q: busca || null, page: 1 }), 350)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, filtros.q])

  const mesesExibidos = meses.includes(filtros.mes)
    ? meses
    : [filtros.mes, ...meses]

  return (
    <div className={`rounded-xl border bg-card p-4 ${isPending ? 'opacity-70' : ''}`}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar cedente ou CNPJ..."
          />
        </div>
        <RemoteEntitySelector
          tipo="cedente"
          value={filtros.cedenteId}
          placeholder="Todos os cedentes"
          onChange={(value) => navegar({ cedente: value, page: 1 })}
        />
        <label className="relative">
          <span className="sr-only">Mês de referência</span>
          <Calendar className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <select
            className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm"
            value={filtros.mes}
            onChange={(event) => navegar({ mes: event.currentTarget.value, page: 1 })}
          >
            {mesesExibidos.map((mes) => (
              <option key={mes} value={mes}>{mes}</option>
            ))}
          </select>
        </label>
        <select
          aria-label="Status da operação"
          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
          value={filtros.status ?? ''}
          onChange={(event) => navegar({ status: event.currentTarget.value || null, page: 1 })}
        >
          <option value="">Todos os status</option>
          {statusOptions.map((status) => (
            <option key={status.value} value={status.value}>{status.label}</option>
          ))}
        </select>
        <label className="space-y-1 text-xs text-muted-foreground">
          Período total: início
          <Input
            type="date"
            value={filtros.dataInicial ?? ''}
            onChange={(event) => navegar({ dataInicial: event.currentTarget.value || null, page: 1 })}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Período total: fim
          <Input
            type="date"
            value={filtros.dataFinal ?? ''}
            onChange={(event) => navegar({ dataFinal: event.currentTarget.value || null, page: 1 })}
          />
        </label>
        <select
          aria-label="Ordenar relatório por"
          className="h-9 self-end rounded-lg border border-input bg-background px-3 text-sm"
          value={filtros.sort}
          onChange={(event) => navegar({ sort: event.currentTarget.value, page: 1 })}
        >
          <option value="volume_total">Volume total</option>
          <option value="volume_mes">Volume do mês</option>
          <option value="operacoes_total">Quantidade de operações</option>
          <option value="cedente">Cedente</option>
        </select>
        <select
          aria-label="Direção da ordenação"
          className="h-9 self-end rounded-lg border border-input bg-background px-3 text-sm"
          value={filtros.direction}
          onChange={(event) => navegar({ direction: event.currentTarget.value, page: 1 })}
        >
          <option value="desc">Decrescente</option>
          <option value="asc">Crescente</option>
        </select>
      </div>
    </div>
  )
}
export function RelatorioPagination({ pagination }: { pagination: PaginationMeta }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const current = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams])
  const [isPending, startTransition] = useTransition()
  const navegar = (updates: Record<string, string | number | null>) => {
    startTransition(() => router.replace(buildListUrl(pathname, current, updates)))
  }

  return (
    <ListPagination
      className="border-t px-4 py-3"
      pagination={pagination}
      disabled={isPending}
      onPageChange={(page) => navegar({ page })}
      onPageSizeChange={(pageSize) => navegar({ pageSize, page: 1 })}
    />
  )
}
