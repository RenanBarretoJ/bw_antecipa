'use client'

import { useEffect, useState } from 'react'
import { Filter, RotateCcw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { FiltrosOnboarding } from './types'

type Props = {
  filters: FiltrosOnboarding
  politicas: Array<{ id: string; nome: string }>
  onChange: (patch: Record<string, string | number | null>) => void
  onClear: () => void
}

export function OnboardingToolbar({ filters, politicas, onChange, onClear }: Props) {
  const [query, setQuery] = useState(filters.busca)

  useEffect(() => {
    if (query === filters.busca) return
    const handle = window.setTimeout(() => onChange({ q: query || null, page: 1 }), 350)
    return () => window.clearTimeout(handle)
  }, [filters.busca, onChange, query])

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_190px_180px_190px_auto] lg:items-center">
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

        <label>
          <span className="sr-only">Politica</span>
          <select
            value={filters.politicaId || 'todos'}
            onChange={(event) => onChange({ politica: event.target.value === 'todos' ? null : event.target.value, page: 1 })}
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="todos">Politica: todas</option>
            {politicas.map((politica) => <option key={politica.id} value={politica.id}>{politica.nome}</option>)}
          </select>
        </label>

        <label>
          <span className="sr-only">Status cadastral</span>
          <select
            value={filters.statusCadastral || 'todos'}
            onChange={(event) => onChange({ status: event.target.value === 'todos' ? null : event.target.value, page: 1 })}
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="todos">Status: todos</option>
            <option value="pendente">Pendente</option>
            <option value="em_analise">Em analise</option>
            <option value="ativo">Ativo</option>
            <option value="reprovado">Reprovado</option>
            <option value="bloqueado">Bloqueado</option>
          </select>
        </label>

        <label>
          <span className="sr-only">Ordenacao</span>
          <select
            value={`${filters.ordenacao}:${filters.direcao}`}
            onChange={(event) => {
              const [sort, direction] = event.target.value.split(':')
              onChange({ sort, direction, page: 1 })
            }}
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="created_at:asc">Mais antigos</option>
            <option value="created_at:desc">Mais recentes</option>
            <option value="updated_at:desc">Atualizados recentemente</option>
            <option value="razao_social:asc">Razao social A-Z</option>
            <option value="razao_social:desc">Razao social Z-A</option>
          </select>
        </label>

        <Button type="button" variant="outline" size="sm" onClick={onClear} className="justify-center">
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Limpar
        </Button>
      </div>
      <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Filter className="size-3.5" aria-hidden="true" />
        Filtros, ordenacao e pagina ficam preservados na URL.
      </p>
    </div>
  )
}
