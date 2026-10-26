import type { NfPdfExtracted } from '@/lib/pdf-nf-parser'
import { validManualDue } from '@/lib/nfse/persistence'

export type DanfeDueReview = { numero: string; bruto: number; emissao: string }

/** An unprinted payment term is not a due date. Manual input is never a parcel. */
export function resolveDanfeDue(parsed: NfPdfExtracted, manualDue: string, today: string): string | undefined {
  if (parsed.data_vencimento) return parsed.data_vencimento
  return parsed.data_emissao && validManualDue(manualDue, parsed.data_emissao, today) ? manualDue : undefined
}
