import 'server-only'
import { z } from 'zod'
import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { createAdminClient } from '@/lib/supabase/server'
import { createEmailProvider, providerConfigurationSchema } from '@/lib/email-intake/provider-factory.server'
import { validateAttachmentBytes } from '@/lib/email-intake/policy'
import { sha256, fiscalFingerprint } from '@/lib/nfse/review-facts'
import { prepareNfsePersistence } from '@/lib/nfse/persistence'
import { parseFiscalFile } from './parse.server'
import { FiscalIntakeError } from './contracts'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const receiptSchema = z.object({ id: z.uuid(), fileSha256: hash, fiscalSha256: hash, identitySha256: hash })
const sourceSchema = providerConfigurationSchema.extend({ messageExternalId: z.string().min(1), attachmentExternalId: z.string().min(1),
  fileName: z.string().min(1), contentType: z.string(), size: z.number().int().positive(), inline: z.boolean(), kind: z.enum(['FILE', 'UNSUPPORTED']) })

/** The caller resolves real Auth/MFA/scope. Never sends original bytes or provider config to the browser. */
export async function readEmailReviewOriginal(input: {
  client: AppSupabaseClient; fundoId: string; cedenteFundoId: string; reviewId?: string
}) {
  const { data, error } = await input.client.rpc('fiscal_intake_read_email_review', {
    p_fundo_id: input.fundoId, p_cedente_fundo_id: input.cedenteFundoId, p_review_id: input.reviewId ?? null,
  })
  if (error) throw new FiscalIntakeError('DENIED')
  if (data === null) return null
  const receipt = receiptSchema.parse(data)
  const sourceResult = await createAdminClient().rpc('fiscal_intake_get_review_source', {
    p_review_id: receipt.id, p_fundo_id: input.fundoId, p_cedente_fundo_id: input.cedenteFundoId,
  })
  if (sourceResult.error) throw new FiscalIntakeError('DENIED')
  const source = sourceSchema.parse(sourceResult.data)
  const bytes = await createEmailProvider(source).downloadAttachment(source.messageExternalId, source.attachmentExternalId)
  validateAttachmentBytes({ externalId: source.attachmentExternalId, name: source.fileName, contentType: source.contentType,
    size: source.size, inline: source.inline, kind: source.kind }, bytes)
  const owned = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(owned).set(bytes)
  const file = new File([owned], source.fileName, { type: source.contentType })
  if (sha256(Buffer.from(bytes)) !== receipt.fileSha256) throw new FiscalIntakeError('INVALID')
  return { file, receipt }
}

export async function readEmailFiscalReview(input: Parameters<typeof readEmailReviewOriginal>[0]) {
  const original = await readEmailReviewOriginal(input)
  if (!original) return null
  const { file, receipt } = original
  const facts = await parseFiscalFile(file)
  if (facts.kind !== 'NFSE' || fiscalFingerprint(facts.parsed) !== receipt.fiscalSha256 || sha256(facts.key) !== receipt.identitySha256) {
    throw new FiscalIntakeError('INVALID')
  }
  const prepared = prepareNfsePersistence(facts.parsed, '', receipt.fileSha256, new Date().toISOString().slice(0, 10))
  if (prepared.kind !== 'review') throw new FiscalIntakeError('INVALID')
  return { file, review: { ...prepared.review, intentId: receipt.id, sourceChannel: 'EMAIL_INTAKE' as const } }
}
