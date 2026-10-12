'use server'

import { z } from 'zod'
import { requireAuthenticated } from '@/lib/auth/authorization'
import { resolverContextoOperacionalNotaFiscal } from '@/lib/notas-fiscais/contexto-operacional.server'
import { readEmailFiscalReview, readEmailReviewOriginal } from '@/lib/fiscal-intake/email-review.server'
import { uploadNFs, type NfActionState } from './nota-fiscal'

const scopeSchema = z.string().uuid().optional()

export async function temRevisaoEmailPendente(cedenteId?: string): Promise<boolean> {
  const auth = await requireAuthenticated()
  const scope = await resolverContextoOperacionalNotaFiscal(auth, scopeSchema.parse(cedenteId))
  const { data, error } = await auth.supabase.rpc('fiscal_intake_read_email_review', {
    p_fundo_id: scope.fundoId, p_cedente_fundo_id: scope.cedenteFundoId,
  })
  if (error) {
    console.warn('[fiscal-review]', { code: 'REVIEW_AVAILABILITY_UNAVAILABLE' })
    return false
  }
  return data !== null
}

export async function abrirProximaRevisaoEmail(cedenteId?: string) {
  try {
    const auth = await requireAuthenticated()
    const scope = await resolverContextoOperacionalNotaFiscal(auth, scopeSchema.parse(cedenteId))
    const result = await readEmailFiscalReview({ client: auth.supabase, fundoId: scope.fundoId, cedenteFundoId: scope.cedenteFundoId })
    if (!result) return { status: 'EMPTY' as const }
    return { status: 'REVIEW' as const, review: result.review, fileName: result.file.name }
  } catch {
    return { status: 'ERROR' as const, message: 'Não foi possível abrir a revisão. Confira seu acesso e tente novamente.' }
  }
}

export async function concluirRevisaoEmail(input: { reviewId: string; manualDue: string; cedenteId?: string }): Promise<NfActionState> {
  try {
    const parsed = z.object({ reviewId: z.uuid(), manualDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), cedenteId: scopeSchema }).parse(input)
    const auth = await requireAuthenticated()
    const scope = await resolverContextoOperacionalNotaFiscal(auth, parsed.cedenteId)
    const result = await readEmailReviewOriginal({ client: auth.supabase, fundoId: scope.fundoId,
      cedenteFundoId: scope.cedenteFundoId, reviewId: parsed.reviewId })
    if (!result) return { success: false, message: 'Esta revisão não está mais disponível. Atualize a página.' }
    const data = new FormData()
    data.append('arquivos', result.file)
    data.append('cedente_id', scope.cedente.id)
    data.append('nfse_review_intent', parsed.reviewId)
    data.append('nfse_vencimento_manual', parsed.manualDue)
    // Official manual action reauthenticates, reextracts and submits the SAME receipt.
    const outcome = await uploadNFs(data)
    if (outcome?.uploadBatch) {
      outcome.uploadBatch.results = outcome.uploadBatch.results.map(item => item.status === 'REQUIRES_REVIEW'
        ? { ...item, review: { ...item.review, sourceChannel: 'EMAIL_INTAKE' as const } } : item)
    }
    return outcome
  } catch {
    return { success: false, message: 'Não foi possível concluir a revisão. Confira o vencimento e seu acesso.' }
  }
}
