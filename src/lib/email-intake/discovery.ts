import type { DiscoveryPage, EmailAttachment, EmailMessage, EmailProviderAdapter } from './contracts'
import { IntakeError } from './contracts'

export type DiscoveredMessage = EmailMessage & { attachments: EmailAttachment[] }
export type DiscoveryLease = { integrationId: string; token: string; revision: number; cursor: string | null }
export interface DiscoveryRepository {
  /** One transaction: verify lease/revision, upsert page/messages/attachments, encrypt checkpoint, increment revision. */
  commitPage(lease: DiscoveryLease, messages: DiscoveredMessage[], page: DiscoveryPage): Promise<DiscoveryLease>
}

/** One bounded page per invocation. Exceptions leave the durable checkpoint untouched. */
export async function discoverPage(input: {
  adapter: EmailProviderAdapter; repository: DiscoveryRepository; lease: DiscoveryLease
  startAt: string; mode: 'DELTA' | 'RECONCILIATION'; concurrency?: number
}): Promise<{ lease: DiscoveryLease; complete: boolean; discovered: number }> {
  const page = input.mode === 'DELTA'
    ? await input.adapter.syncMessages(input.lease.cursor, input.startAt)
    : await input.adapter.reconcileMessages(input.lease.cursor, input.startAt)
  const messages = page.messages.filter(row => !row.removed)
  const discovered = new Array<DiscoveredMessage>(messages.length)
  const limit = Math.max(1, Math.min(4, Math.floor(input.concurrency ?? 2)))
  if (!Number.isFinite(limit)) throw new IntakeError('CONFIGURATION')
  let index = 0
  async function worker() {
    for (;;) {
      const current = index++
      if (current >= messages.length) return
      const message = messages[current]
      discovered[current] = { ...message,
        attachments: message.hasAttachments ? await input.adapter.listAttachments(message.externalId) : [] }
    }
  }
  // Wait for every reader to settle before returning a failure; no detached work.
  const results = await Promise.allSettled(Array.from({ length: limit }, worker))
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  const lease = await input.repository.commitPage(input.lease, discovered, page)
  return { lease, complete: page.complete, discovered: discovered.length }
}
