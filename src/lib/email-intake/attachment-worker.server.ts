import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { importFiscalFile, type FiscalImportInput } from '@/lib/fiscal-intake/service.server'
import { createFiscalImportRepository } from '@/lib/fiscal-intake/repository.server'
import { createFiscalStorage, processFiscalCleanup } from '@/lib/fiscal-intake/storage.server'
import type { FiscalImportResult } from '@/lib/fiscal-intake/contracts'
import { IntakeError, type EmailProviderAdapter } from './contracts'
import { attachmentDisposition, validateAttachmentBytes, retryDelayMs } from './policy'
import { createEmailProvider, providerConfigurationSchema } from './provider-factory.server'

const jobSchema = providerConfigurationSchema.extend({
  id: z.uuid(), token: z.uuid(), attempt: z.number().int().positive(), messageId: z.uuid(), integrationId: z.uuid(), fundoId: z.uuid(),
  messageExternalId: z.string().min(1), attachmentExternalId: z.string().min(1), fileName: z.string().min(1),
  contentType: z.string(), size: z.number().int().nonnegative(), inline: z.boolean(), kind: z.enum(['FILE', 'UNSUPPORTED']),
})
type AttachmentJob = z.infer<typeof jobSchema>

/** Transport worker only: there is no fiscal parser or separate Storage path here. */
export async function processAttachmentJob(job: Pick<AttachmentJob,
  'id' | 'token' | 'messageId' | 'integrationId' | 'fundoId' | 'messageExternalId' | 'attachmentExternalId' | 'fileName' | 'contentType' | 'size' | 'inline' | 'kind'>,
provider: Pick<EmailProviderAdapter, 'downloadAttachment'>, importer: (input: FiscalImportInput) => Promise<FiscalImportResult>): Promise<FiscalImportResult | { status: 'IGNORED' }> {
  const metadata = { externalId: job.attachmentExternalId, name: job.fileName, contentType: job.contentType,
    size: job.size, inline: job.inline, kind: job.kind }
  if (attachmentDisposition(metadata) === 'IGNORE_INLINE') return { status: 'IGNORED' }
  const bytes = await provider.downloadAttachment(job.messageExternalId, job.attachmentExternalId)
  const format = validateAttachmentBytes(metadata, bytes)
  // A new owned buffer satisfies File's ArrayBuffer contract without a type cast.
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return importer({ actor: { type: 'SYSTEM', source: 'EMAIL_INTAKE', integrationId: job.integrationId,
    messageId: job.messageId, attachmentId: job.id, attachmentToken: job.token }, fundoId: job.fundoId,
    file: new File([buffer], job.fileName, { type: format === 'XML' ? 'application/xml' : 'application/pdf' }) })
}

/** One independent durable attachment claim per invocation; no public endpoint. */
export async function processNextEmailAttachment(queue: 'TEXT' | 'VISUAL' = 'TEXT') {
  await processFiscalCleanup(10)
  const client = createAdminClient()
  const { data: claims, error: claimError } = await client.rpc('email_intake_claim_attachment', { p_queue: queue })
  if (claimError) throw new IntakeError('PROVIDER_UNAVAILABLE', true)
  const claim = claims?.[0]
  if (!claim) return { status: 'IDLE' as const }
  let result: FiscalImportResult | { status: 'IGNORED' }
  let retryAfter = 0
  try {
    const { data, error } = await client.rpc('email_intake_get_attachment_claim', { p_id: claim.id, p_token: claim.token })
    if (error) throw new IntakeError('LEASE_LOST')
    const job = jobSchema.parse(data)
    result = await processAttachmentJob(job, createEmailProvider(job), input => importFiscalFile(input, {
      repository: createFiscalImportRepository(client), storage: createFiscalStorage(),
    }))
  } catch (error) {
    if (error instanceof IntakeError && error.code === 'LEASE_LOST') return { status: 'LEASE_LOST' as const }
    retryAfter = error instanceof IntakeError ? error.retryAfterMs : 0
    result = { status: error instanceof IntakeError && ['UNSUPPORTED_FILE', 'FILE_TOO_LARGE'].includes(error.code)
      ? 'INVALID' : error instanceof IntakeError && !error.retryable ? 'FAILED' : 'RETRYABLE_ERROR' }
  }
  if (!['IMPORTED', 'REQUIRES_REVIEW', 'COMPANION_LINKED'].includes(result.status)) {
    const { error } = await client.rpc('email_intake_settle_attachment', { p_id: claim.id, p_token: claim.token,
      p_outcome: result.status, p_retry_after_ms: Math.ceil(retryDelayMs(claim.attempt, retryAfter)) })
    if (error) return { status: 'LEASE_LOST' as const }
  }
  // No message body, credentials, external IDs, mailbox, filename or raw errors.
  return { status: result.status }
}
