'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ExternalLink, Loader2, MoreVertical } from 'lucide-react'
import { cn, formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'

export interface OperacaoNotaFiscalView {
  id: string
  numero_nf: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  valor_antecipado: number | null
  prazo_dias: number
  data_vencimento: string
  status: string
}

export function prazoDiasAteVencimento(dataVencimento: string, nowMs = Date.now()) {
  return Math.max(1, Math.ceil((new Date(dataVencimento).getTime() - nowMs) / (1000 * 60 * 60 * 24)))
}

export function resolveStatusCurtoDaNota(status: string, statusLogistico?: string | null, aceiteDispensado = false) {
  if (statusLogistico === 'em_transito') return 'Em trânsito'
  if (statusLogistico === 'aguardando_validacao') return 'Em análise'
  if (statusLogistico === 'entregue') return 'Entregue'
  if (statusLogistico === 'entrega_com_pendencia') return 'Pendência'
  if (status === 'aceita') return 'Aprovada'
  if (status === 'contestada') return 'Rejeitada'
  if (status === 'em_antecipacao' && aceiteDispensado) return 'Aceite dispensado'
  if (status === 'em_antecipacao') return 'Pendente'
  if (status === 'aprovada') return 'Aprovada'
  if (status === 'liquidada') return 'Liquidada'
  return status
}

export function buildOperacaoNotaFiscalView({
  notaFiscal,
  valorAntecipado,
  nowMs,
}: {
  notaFiscal: Omit<OperacaoNotaFiscalView, 'valor_antecipado' | 'prazo_dias'>
  valorAntecipado: number | null
  nowMs?: number
}): OperacaoNotaFiscalView {
  return {
    ...notaFiscal,
    valor_antecipado: valorAntecipado,
    prazo_dias: prazoDiasAteVencimento(notaFiscal.data_vencimento, nowMs),
  }
}

export function OperacaoNotaFiscalCard({
  notaFiscal,
  statusNode,
  href,
  canRemove,
  removing,
  onRemove,
  menuPlacement = 'bottom',
}: {
  notaFiscal: OperacaoNotaFiscalView
  statusNode: ReactNode
  href: string
  canRemove?: boolean
  removing?: boolean
  onRemove?: () => void
  menuPlacement?: 'top' | 'bottom'
}) {
  return (
    <article className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex min-w-0 flex-col gap-4 2xl:flex-row 2xl:items-center">
        <div className="min-w-0 2xl:w-[260px] 2xl:shrink-0">
          <p className="font-semibold text-foreground">NF {notaFiscal.numero_nf || '—'}</p>
          <p className="mt-1 truncate text-sm font-medium text-foreground" title={notaFiscal.razao_social_destinatario}>
            {notaFiscal.razao_social_destinatario || 'Sacado não informado'}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums" title={formatCNPJ(notaFiscal.cnpj_destinatario)}>CNPJ {formatCNPJ(notaFiscal.cnpj_destinatario)}</p>
        </div>

        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Bruto" value={formatCurrency(notaFiscal.valor_bruto)} />
          <Metric label="Antecipado" value={notaFiscal.valor_antecipado === null ? '—' : formatCurrency(notaFiscal.valor_antecipado)} highlight />
          <Metric label="Prazo" value={`${notaFiscal.prazo_dias} dias`} />
          <Metric label="Vencimento" value={formatDate(notaFiscal.data_vencimento)} />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 2xl:justify-end">
          {statusNode}
          <Link
            href={href}
            className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Ver NF ${notaFiscal.numero_nf || ''}`}
          >
            Ver NF
          </Link>
          <details className="relative z-10 open:z-50">
            <summary className="inline-flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-border bg-background hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Mais ações">
              <MoreVertical size={15} />
            </summary>
            <div
              className={cn(
                'absolute right-0 z-50 min-w-44 rounded-lg border bg-popover p-1 text-sm shadow-lg',
                menuPlacement === 'top' ? 'bottom-full mb-2' : 'mt-2',
              )}
            >
              <Link href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-muted">
                <ExternalLink size={14} />
                Abrir em nova aba
              </Link>
              {canRemove && (
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={removing}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  {removing ? <Loader2 size={14} className="animate-spin" /> : null}
                  Remover da operação
                </button>
              )}
            </div>
          </details>
        </div>
      </div>
    </article>
  )
}

function Metric({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate whitespace-nowrap font-semibold tabular-nums ${highlight ? 'text-success-foreground' : 'text-foreground'}`} title={value}>{value}</p>
    </div>
  )
}
