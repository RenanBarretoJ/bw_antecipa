import 'server-only'
import { randomBytes } from 'node:crypto'
import { IntakeError, type EmailProviderAdapter, type SubscriptionInput } from '../contracts'
import { discoverPage } from '../discovery'
import { createEmailProvider } from '../provider-factory.server'
import { revealValue } from '../secrets.server'
import { retryDelayMs } from '../policy'
import { processNextEmailAttachment } from '../attachment-worker.server'
import { createAutomationRepository, type AutomationRepository } from './repository.server'
import type { AutomationJob, JobKind } from './job'
import { assessEmailHealth } from './health'
import { notificationEndpoint } from './environment.server'

async function sync(job: AutomationJob, repository: AutomationRepository, adapter: EmailProviderAdapter) {
  if (!job.discoveryToken || job.revision === undefined) throw new IntakeError('LEASE_LOST')
  const cursor = job.cursorCiphertext && job.cursorKeyVersion ? revealValue({ ciphertext: job.cursorCiphertext,
    keyVersion: job.cursorKeyVersion }, { integrationId: job.integrationId, fundoId: job.fundoId, purpose: 'CURSOR' }) : null
  return discoverPage({ adapter, startAt: job.startAt, mode: job.kind === 'DELTA' ? 'DELTA' : 'RECONCILIATION',
    lease: { integrationId: job.integrationId, token: job.discoveryToken, revision: job.revision, cursor },
    repository: { async commitPage(lease, messages, page) {
      return { ...lease, revision: await repository.commitPage(job, messages, page), cursor: page.continuation || null }
    } } })
}

async function subscribe(job: AutomationJob, repository: AutomationRepository, adapter: EmailProviderAdapter, endpoint: string) {
  const clientState = job.clientStateCiphertext && job.clientStateKeyVersion
    ? revealValue({ ciphertext: job.clientStateCiphertext, keyVersion: job.clientStateKeyVersion },
      { integrationId: job.integrationId, fundoId: job.fundoId, purpose: 'CLIENT_STATE' })
    : randomBytes(32).toString('hex')
  if (!job.clientStateCiphertext) await repository.prepareSubscription(job, clientState)
  const expectedResource = `users/${job.mailboxObjectId}/mailFolders/${encodeURIComponent(job.folderId)}/messages`
  if (job.resource !== expectedResource) throw new IntakeError('CONFIGURATION')
  const input: SubscriptionInput = { notificationUrl: endpoint, lifecycleNotificationUrl: endpoint, clientState, resource: job.resource }
  let externalId = job.subscriptionId ?? undefined
  if (externalId) {
    try {
      const renewed = await adapter.createOrRenewSubscription({ ...input, externalId })
      await repository.completeSubscription(job, renewed)
      return
    } catch (error) {
      if (!(error instanceof IntakeError) || error.code !== 'NOT_FOUND') throw error
      externalId = undefined
    }
  }
  if (!adapter.findSubscription) throw new IntakeError('CONFIGURATION')
  const existing = await adapter.findSubscription(input)
  const subscription = await adapter.createOrRenewSubscription({ ...input, externalId: existing?.externalId })
  await repository.completeSubscription(job, subscription)
}

export async function runOperationalJob(kind: JobKind, dependencies: {
  repository?: AutomationRepository; provider?: typeof createEmailProvider; endpoint?: () => string
} = {}) {
  const repository = dependencies.repository ?? createAutomationRepository()
  const job = await repository.claim(kind)
  if (!job) return { status: 'IDLE' as const }
  try {
    const adapter = (dependencies.provider ?? createEmailProvider)(job)
    if (kind === 'SUBSCRIPTION') await subscribe(job, repository, adapter, (dependencies.endpoint ?? notificationEndpoint)())
    else await sync(job, repository, adapter)
    return { status: 'COMPLETED' as const }
  } catch (error) {
    const safe = error instanceof IntakeError ? error : new IntakeError('CONFIGURATION')
    await repository.fail(job, safe, retryDelayMs(job.attempt, safe.retryAfterMs))
    return { status: 'DEFERRED' as const, code: safe.code }
  }
}

export async function runEmailHealth(repository = createAutomationRepository(), now = Date.now()) {
  const snapshots = await repository.healthSnapshots()
  for (const snapshot of snapshots) await repository.applyHealth(snapshot.integrationId, assessEmailHealth(snapshot, now))
  return { status: 'COMPLETED' as const, checked: snapshots.length }
}

/** Separate jobs keep slow visual extraction out of discovery and the webhook request. */
export async function runEmailAutomationTask(task: string) {
  if (task === 'delta') return runOperationalJob('DELTA')
  if (task === 'reconciliation') return runOperationalJob('RECONCILIATION')
  if (task === 'subscriptions') return runOperationalJob('SUBSCRIPTION')
  if (task === 'health') return runEmailHealth()
  if (task === 'attachments') return processNextEmailAttachment('TEXT')
  if (task === 'visual') return processNextEmailAttachment('VISUAL')
  throw new IntakeError('CONFIGURATION')
}
