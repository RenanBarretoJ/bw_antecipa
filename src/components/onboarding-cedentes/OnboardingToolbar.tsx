'use client'

import { useEffect, useState } from 'react'
import { Filter, RotateCcw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EtapaOnboarding, FundoResumo, OrdenacaoOnboarding, PoliticaResumo } from './types'

export type OnboardingToolbarFilters = {
  etapa: EtapaOnboarding
  busca: string
  fundoId: string
  politicaId: string
  status: string
  ordenar: OrdenacaoOnboarding
}

type Props = {
  filters: OnboardingToolbarFilters
  fundos: FundoResumo[]
  politicas: PoliticaResumo[]
  onChange: (patch: Partial<OnboardingToolbarFilters>) => void
  onClear: () => void
}

export function OnboardingToolbar({ filters, fundos, politicas, onChange, onClear }: Props) {
  const [query, setQuery] = useState(filters.busca)

  useEffect(() => {
    const handle = setTimeout(() => {
      if (query !== filters.busca) onChange({ busca: query })
    }, 300)
    return () => clearTimeout(handle)
  }, [filters.busca, onChange, query])

  const politicasFiltradas = filters.fundoId === 'todos'
    ? politicas
    : politicas.filter((politica) => politica.fundo_id === filters.fundoId)

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_180px_180px_150px_160px_auto] lg:items-center">
        <label className="relative block">
          <span className="sr-only">Buscar cedente</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por razao social, nome fantasia ou CNPJ"
            className="pl-9"
          />
        </label>

        <label className="flex items-center gap-2">
          <span className="sr-only">Fundo</span>
          <select
            value={filters.fundoId}
            onChange={(event) => onChange({ fundoId: event.target.value, politicaId: 'todos' })}
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="todos">Fundo: todos</option>
            {fundos.map((fundo) => <option key={fundo.id} value={fundo.id}>{fundo.nome}</option>)}
          </select>
        </label>

        <label>
          <span className="sr-only">Politica</span>
          <select
            value={filters.politicaId}
            onChange={(event) => onChange({ politicaId: event.target.value })}
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="todos">Politica: todas</option>
            {politicasFiltradas.map((politica) => <option key={politica.id} value={politica.id}>{politica.nome}</option>)}
          </select>
        </label>

        <label>
          <span className="sr-only">Status cadastral</span>
          <select
            value={filters.status}
            onChange={(event) => onChange({ status: event.target.value })}
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="todos">Status: todos</option>
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
            <option value="suspenso">Suspenso</option>
          </select>
        </label>

        <label>
          <span className="sr-only">Ordenacao</span>
          <select
            value={filters.ordenar}
            onChange={(event) => onChange({ ordenar: event.target.value as OrdenacaoOnboarding })}
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="mais_antigo">Mais antigos</option>
            <option value="mais_recente">Mais recentes</option>
            <option value="razao_social">Razao social</option>
          </select>
        </label>

        <Button type="button" variant="outline" size="sm" onClick={onClear} className="justify-center">
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Limpar
        </Button>
      </div>
      <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Filter className="size-3.5" aria-hidden="true" />
        Filtros preservam a URL para compartilhamento e retorno.
      </p>
    </div>
  )
}
