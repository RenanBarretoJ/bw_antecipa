import type { DiscoveryPage, EmailAttachment, EmailMessage, EmailProviderAdapter } from './contracts'
import { IntakeError } from './contracts'
import { emailTimestamp, evaluateEmailMessageAdmission, type KnownEmailMessage } from './admission'

export type DiscoveredMessage = EmailMessage & { attachments: EmailAttachment[] }
export type DiscoveryLease = { integrationId: string; token: string; revision: number; cursor: string | null }
export interface DiscoveryRepository {
  findKnownMessages(lease: DiscoveryLease, externalIds: string[]): Promise<KnownEmailMessage[]>
  /** One transaction: verify lease/revision, upsert page/messages/attachments, encrypt checkpoint, increment revision. */
  commitPage(lease: DiscoveryLease, messages: DiscoveredMessage[], page: DiscoveryPage): Promise<DiscoveryLease>
}

/** One bounded page per invocation. Exceptions leave the durable checkpoint untouched. */
export async function discoverPage(input: {
  adapter: EmailProviderAdapter; repository: DiscoveryRepository; lease: DiscoveryLease
  startAt: string; querySince?: string; mode: 'DELTA' | 'RECONCILIATION'; concurrency?: number
}) {
  if (emailTimestamp(input.startAt) === null) throw new IntakeError('CONFIGURATION')
  const page = input.mode === 'DELTA'
    ? await input.adapter.syncMessages(input.lease.cursor, input.querySince ?? input.startAt)
    : await input.adapter.reconcileMessages(input.lease.cursor, input.querySince ?? input.startAt)
  const identities = page.messages.map(row => input.adapter.normalizeExternalIdentity(row.externalId))
  const known = new Map((await input.repository.findKnownMessages(input.lease, [...new Set(identities)]))
    .map(row => [row.externalId, row]))
  const metrics = { oldMessagesSkipped: 0, newMessagesAdmitted: 0, existingMessages: 0,
    invalidTimestamps: 0, tombstonesApplied: 0, unknownTombstones: 0, attachmentsListed: 0 }
  const messages: EmailMessage[] = []
  for (const [index, raw] of page.messages.entries()) {
    const row = { ...raw, externalId: identities[index] }
    const admission = evaluateEmailMessageAdmission(row, input.startAt, known.get(row.externalId))
    switch (admission.kind) {
      case 'ADMIT':
        metrics[admission.existing ? 'existingMessages' : 'newMessagesAdmitted']++
        messages.push({ ...row, receivedAt: admission.receivedAt })
        break
      case 'TOMBSTONE_EXISTING':
        metrics.tombstonesApplied++
        messages.push({ ...row, receivedAt: '', hasAttachments: false })
        break
      case 'TOMBSTONE_UNKNOWN': metrics.unknownTombstones++; break
      case 'SKIP_BEFORE_START_AT': metrics.oldMessagesSkipped++; break
      case 'INVALID_TIMESTAMP': metrics.invalidTimestamps++; break
    }
  }
  const discovered = new Array<DiscoveredMessage>(messages.length)
  const limit = Math.max(1, Math.min(4, Math.floor(input.concurrency ?? 2)))
  if (!Number.isFinite(limit)) throw new IntakeError('CONFIGURATION')
  let index = 0
  async function worker() {
    for (;;) {
      const current = index++
      if (current >= messages.length) return
      const message = messages[current]
      if (message.hasAttachments) metrics.attachmentsListed++
      discovered[current] = { ...message,
        attachments: message.hasAttachments ? await input.adapter.listAttachments(message.externalId) : [] }
    }
  }
  // Wait for every reader to settle before returning a failure; no detached work.
  const results = await Promise.allSettled(Array.from({ length: limit }, worker))
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  const lease = await input.repository.commitPage(input.lease, discovered, page)
  return { lease, complete: page.complete, discovered: discovered.filter(row => !row.removed).length, metrics }
}
