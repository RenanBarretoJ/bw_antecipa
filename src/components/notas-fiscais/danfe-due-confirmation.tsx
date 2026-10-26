'use client'

import type { DanfeDueReview } from '@/lib/danfe/due-date'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export function DanfeDueConfirmation({ review, value, disabled, inputId, onDueChange }: {
  review: DanfeDueReview; value: string; disabled: boolean; inputId: string; onDueChange: (value: string) => void
}) {
  return <fieldset className="mt-3 rounded-lg border border-border bg-muted/30 p-4 space-y-2">
    <legend className="px-1 font-medium">NF-e {review.numero} — confirmar vencimento</legend>
    <p className="text-sm">Total da NF: {formatCurrency(review.bruto)} · Emissão: {formatDate(review.emissao)}</p>
    <p id={`${inputId}-help`} className="text-sm text-muted-foreground">O PDF não informa vencimento expresso. Confirme a data acordada com o pagador; um prazo em texto livre não comprova essa data.</p>
    <label className="block text-sm font-medium" htmlFor={inputId}>Vencimento acordado *</label>
    <Input id={inputId} type="date" required disabled={disabled}
      aria-describedby={`${inputId}-help ${inputId}-state`}
      className="w-full sm:max-w-xs" value={value} min={review.emissao}
      onChange={event => onDueChange(event.target.value)} />
    <p id={`${inputId}-state`} className="text-xs text-muted-foreground">Nenhuma nota foi criada ainda. Use uma data válida, não anterior à emissão nem ao dia de hoje. Ao reenviar, a data será registrada como manual e a nota será salva somente como rascunho, sem gerar duplicatas ou aprovar a cessão.</p>
  </fieldset>
}
