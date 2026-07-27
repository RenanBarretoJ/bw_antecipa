'use client'

import { useMemo, useState } from 'react'
import { Building2, Check, ChevronDown, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCNPJ } from '@/lib/utils'
import { useFundoAtivo } from './fundo-ativo-provider'

export function FundoAtivoSelector() {
  const { loading, fundos, fundoAtivo, bloqueado, trocarFundo } = useFundoAtivo()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [switching, setSwitching] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return fundos
    return fundos.filter((fundo) => `${fundo.nome} ${fundo.cnpj || ''}`.toLowerCase().includes(term))
  }, [fundos, query])

  if (loading) {
    return (
      <div className="hidden h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground md:flex">
        <Loader2 size={14} className="animate-spin" />
        Carregando fundo...
      </div>
    )
  }

  if (bloqueado || fundos.length === 0) {
    return (
      <div className="hidden max-w-[260px] rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive md:block">
        Nenhum fundo autorizado
      </div>
    )
  }

  const label = fundoAtivo?.nome || 'Selecionar fundo'

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="max-w-[220px] justify-between gap-2 md:max-w-[280px]"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="fundo-ativo-dropdown"
        title={label}
      >
        <Building2 size={14} />
        <span className="hidden text-xs text-muted-foreground sm:inline">Fundo ativo:</span>
        <span className="truncate">{label}</span>
        <ChevronDown size={14} />
      </Button>

      {open && (
        <div id="fundo-ativo-dropdown" className="absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-2rem))] rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl">
          <div className="relative mb-2">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar fundo ou CNPJ"
              className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoFocus
            />
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhum fundo encontrado.</p>
            ) : filtered.map((fundo) => {
              const active = fundo.id === fundoAtivo?.id
              return (
                <button
                  key={fundo.id}
                  type="button"
                  disabled={!!switching || active}
                  onClick={async () => {
                    setSwitching(fundo.id)
                    const ok = await trocarFundo(fundo.id)
                    setSwitching(null)
                    if (ok) setOpen(false)
                  }}
                  className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted disabled:cursor-default disabled:opacity-70"
                >
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    {switching === fundo.id ? <Loader2 size={14} className="animate-spin" /> : active ? <Check size={14} /> : <Building2 size={14} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{fundo.nome}</span>
                    <span className="block text-xs text-muted-foreground">{fundo.cnpj ? formatCNPJ(fundo.cnpj) : 'CNPJ não informado'} · {fundo.status}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
