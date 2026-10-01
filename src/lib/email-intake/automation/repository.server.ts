import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { IntakeError } from '../contracts'
import type { DiscoveryPage } from '../contracts'
import type { DiscoveredMessage } from '../discovery'
import { protectValue, revealValue } from '../secrets.server'
import type { WebhookRepository } from '../webhook.server'
import { automationJobSchema, type AutomationJob, type JobKind } from './job'
import { healthSnapshotSchema, type HealthAssessment } from './health'

function checked<T>(response: { data: T; error: { code?: string } | null }): T {
  if (response.error) throw new IntakeError('PROVIDER_UNAVAILABLE', true)
  return response.data
}

export function createAutomationRepository(client = createAdminClient()) {
  return {
    async findKnownMessages(job: AutomationJob, externalIds: string[]) {
      if (!job.discoveryToken || job.revision === undefined) throw new IntakeError('LEASE_LOST')
      return z.array(z.object({ externalId: z.string(), receivedAt: z.string() })).parse(checked(
        await client.rpc('email_intake_known_messages', { p_id: job.integrationId, p_mode: job.kind,
          p_token: job.discoveryToken, p_revision: job.revision, p_external_ids: externalIds })))
    },
    async claim(kind: JobKind) {
      const data = checked(await client.rpc('email_automation_claim', { p_kind: kind }))
      return data ? automationJobSchema.parse(data) : null
    },
    async commitPage(job: AutomationJob, messages: DiscoveredMessage[], page: DiscoveryPage) {
      if (!job.discoveryToken || job.revision === undefined) throw new IntakeError('LEASE_LOST')
      const cursor = page.continuation ? protectValue(page.continuation,
        { integrationId: job.integrationId, fundoId: job.fundoId, purpose: 'CURSOR' }) : null
      return z.number().int().nonnegative().parse(checked(await client.rpc('email_automation_commit_page', {
        p_id: job.integrationId, p_token: job.token, p_kind: job.kind, p_discovery_token: job.discoveryToken,
        p_revision: job.revision, p_messages: messages.map(m => ({ ...m, attachments: m.attachments.map(a => ({ ...a })) })),
        p_cursor_ciphertext: cursor?.ciphertext ?? null, p_cursor_key_version: cursor?.keyVersion ?? null, p_complete: page.complete,
      })))
    },
    async fail(job: AutomationJob, error: IntakeError, delay: number) {
      checked(await client.rpc('email_automation_fail', { p_id: job.integrationId, p_token: job.token,
        p_code: error.code, p_retry_ms: Math.ceil(delay),
        p_retryable: error.retryable || error.code === 'CURSOR_EXPIRED', p_reset_cursor: error.code === 'CURSOR_EXPIRED' && job.kind === 'DELTA' }))
    },
    async prepareSubscription(job: AutomationJob, clientState: string) {
      const value = protectValue(clientState, { integrationId: job.integrationId, fundoId: job.fundoId, purpose: 'CLIENT_STATE' })
      checked(await client.rpc('email_automation_prepare_subscription', { p_id: job.integrationId, p_token: job.token,
        p_ciphertext: value.ciphertext, p_key_version: value.keyVersion }))
    },
    async completeSubscription(job: AutomationJob, subscription: { externalId: string; expiresAt: string }) {
      checked(await client.rpc('email_automation_complete_subscription', { p_id: job.integrationId,
        p_token: job.token, p_subscription_id: subscription.externalId, p_expires_at: subscription.expiresAt }))
    },
    async healthSnapshots() {
      return z.array(healthSnapshotSchema).parse(checked(await client.rpc('email_automation_health_snapshots', {})))
    },
    async applyHealth(id: string, result: HealthAssessment) {
      checked(await client.rpc('email_automation_apply_health', { p_id: id, p_status: result.status, p_alerts: result.alerts }))
    },
  }
}
export type AutomationRepository = ReturnType<typeof createAutomationRepository>

const bindingsSchema = z.array(z.object({ subscriptionId: z.string(), integrationId: z.uuid(), fundoId: z.uuid(),
  tenantId: z.uuid(), mailboxObjectId: z.uuid(), subscriptionResource: z.string().min(1), clientStateCiphertext: z.string(), clientStateKeyVersion: z.string() }))

export function createWebhookRepository(request: Request, timing: { persistedAt: number | null }): WebhookRepository {
  // Vercel overwrites x-real-ip at the trusted ingress. Hash before persistence; no address is logged.
  const ipHash = createHash('sha256').update(request.headers.get('x-real-ip') ?? 'unknown-ingress').digest('hex')
  return {
    async acceptRequest() {
      return z.boolean().parse(checked(await createAdminClient().rpc('email_automation_webhook_limit', { p_key_hash: ipHash })))
    },
    async findBindings(ids) {
      const rows = bindingsSchema.parse(checked(await createAdminClient().rpc('email_automation_webhook_bindings', { p_subscription_ids: ids })))
      return new Map(rows.map(row => [row.subscriptionId, { integrationId: row.integrationId, tenantId: row.tenantId,
        resourcePrefix: `Users/${row.mailboxObjectId}/Messages`, subscriptionResource: row.subscriptionResource, enabled: true,
        clientState: revealValue({ ciphertext: row.clientStateCiphertext, keyVersion: row.clientStateKeyVersion },
          { integrationId: row.integrationId, fundoId: row.fundoId, purpose: 'CLIENT_STATE' }) }]))
    },
    async enqueue(signals) {
      checked(await createAdminClient().rpc('email_automation_signal', { p_signals: signals.map(s => ({ ...s })) }))
      timing.persistedAt = Date.now()
    },
  }
}
