'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronUp, Loader2, ShieldCheck } from 'lucide-react'
import { carregarDetalheAuditoria, carregarMaisAuditoria } from '@/lib/actions/auditoria-listagem'
import type {
  AuditoriaDetalhe,
  AuditoriaFiltros,
  AuditoriaListagemItem,
  AuditoriaPagina,
} from '@/lib/auditoria/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { LoadMoreButton } from '@/components/pagination/LoadMoreButton'

const EVENT_TONES: Record<string, string> = {
  CEDENTE_APROVADO: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  DOCUMENTO_APROVADO: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  NF_APROVADA: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  OPERACAO_APROVADA: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  CEDENTE_REPROVADO: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  DOCUMENTO_REPROVADO: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  NF_REPROVADA: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  OPERACAO_REPROVADA: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function Detail({ detail }: { detail: AuditoriaDetalhe }) {
  const blocks = [
    ['Dados antes', detail.dadosAntes],
    ['Dados depois', detail.dadosDepois],
  ] as const

  return (
    <div className="grid gap-4 border-t px-4 pb-4 pt-3 md:grid-cols-2">
      {blocks.map(([label, value]) => value ? (
        <div key={label} className="min-w-0">
          <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
          <pre className="max-h-56 overflow-auto rounded-lg bg-muted p-3 text-xs text-foreground">
            {JSON.stringify(value, null, 2)}
          </pre>
        </div>
      ) : null)}
      {!detail.dadosAntes && !detail.dadosDepois && (
        <p className="text-sm text-muted-foreground">Este evento não possui detalhes adicionais.</p>
      )}
    </div>
  )
}

export function AuditoriaListClient({
  initialPage,
  filtros,
}: {
  initialPage: AuditoriaPagina
  filtros: AuditoriaFiltros
}) {
  const [items, setItems] = useState(initialPage.items)
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, AuditoriaDetalhe>>({})
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function toggle(item: AuditoriaListagemItem) {
    if (expanded === item.id) {
      setExpanded(null)
      return
    }

    setExpanded(item.id)
    if (details[item.id]) return
    startTransition(async () => {
      try {
        const detail = await carregarDetalheAuditoria(item.id)
        setDetails((current) => ({ ...current, [item.id]: detail }))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os detalhes.')
      }
    })
  }

  function loadMore() {
    if (!nextCursor || isPending) return
    startTransition(async () => {
      setError(null)
      try {
        const page = await carregarMaisAuditoria({ ...filtros, cursor: nextCursor })
        setItems((current) => {
          const ids = new Set(current.map((item) => item.id))
          return [...current, ...page.items.filter((item) => !ids.has(item.id))]
        })
        setNextCursor(page.nextCursor)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar mais registros.')
      }
    })
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <ShieldCheck className="mx-auto mb-3 size-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">Nenhum log encontrado.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-sm tabular-nums text-muted-foreground">{items.length} registros carregados</p>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {items.map((item) => {
        const isExpanded = expanded === item.id
        return (
          <Card key={item.id} className="overflow-hidden py-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => toggle(item)}
              className="h-auto w-full justify-between rounded-none px-4 py-3 text-left"
              aria-expanded={isExpanded}
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <Badge className={EVENT_TONES[item.tipo] ?? 'bg-muted text-muted-foreground'}>{item.tipo}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm font-normal">
                  {item.ator.nome ?? 'Sistema'}
                  <span className="ml-1 text-muted-foreground">({item.ator.perfil ?? 'sistema'})</span>
                </span>
                <span className="hidden shrink-0 text-xs font-normal text-muted-foreground md:inline">
                  {item.entidadeTipo}{item.entidadeId ? ` #${item.entidadeId.slice(0, 8)}` : ''}
                </span>
              </span>
              <span className="ml-3 flex shrink-0 items-center gap-3">
                <span className="hidden text-xs font-normal tabular-nums text-muted-foreground sm:inline">{formatDate(item.createdAt)}</span>
                {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </span>
            </Button>
            {isExpanded && (
              details[item.id]
                ? <Detail detail={details[item.id]} />
                : <div className="flex items-center gap-2 border-t px-4 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Carregando detalhes...</div>
            )}
          </Card>
        )
      })}
      <div className="flex justify-center pt-3">
        <LoadMoreButton
          hasMore={Boolean(nextCursor)}
          loading={isPending}
          onLoadMore={loadMore}
        />
      </div>
    </div>
  )
}
