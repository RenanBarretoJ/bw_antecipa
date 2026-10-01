import { z } from 'zod'

export const HEALTH_STALE_MS = 15 * 60_000
export const SUBSCRIPTION_CRITICAL_MS = 60 * 60_000
export const ALERT_COOLDOWN_MS = 60 * 60_000
export const alertCodeSchema = z.enum(['STALE_SYNC', 'BACKLOG', 'SUBSCRIPTION_CRITICAL', 'GRAPH_AUTH',
  'THROTTLING', 'WORKER_STUCK', 'RECONCILIATION_GAP', 'REPEATED_RETRY'])
export type AlertCode = z.infer<typeof alertCodeSchema>
export const healthSnapshotSchema = z.object({
  integrationId: z.uuid(), name: z.string(), provider: z.string(), mailbox: z.string(), enabled: z.boolean(),
  createdAt: z.string(), lastConnectionSuccess: z.string().nullable(), lastDeltaSuccess: z.string().nullable(),
  lastWebhookSignal: z.string().nullable(), lastMessageDiscovered: z.string().nullable(),
  lastAttachmentProcessed: z.string().nullable(), pendingCount: z.number(), processingCount: z.number(),
  retryableCount: z.number(), failedCount: z.number(), requiresReviewCount: z.number(),
  oldestPendingAt: z.string().nullable(), stuckCount: z.number(), subscriptionStatus: z.string(),
  subscriptionExpiresAt: z.string().nullable(), lastReconciliationAt: z.string().nullable(),
  lastReconciliationResult: z.object({ scanned: z.number(), missing: z.number(), recovered: z.number(), duplicates: z.number(), errors: z.number() }),
  lastErrorCode: z.string().nullable(), subscriptionError: z.string().nullable(),
  consecutiveFailures: z.number(), throttledCount: z.number(), blockedModes: z.array(z.string()),
})
export type HealthSnapshot = z.infer<typeof healthSnapshotSchema>
export type HealthAssessment = { status: 'HEALTHY' | 'DEGRADED' | 'ERROR' | 'DISABLED'; alerts: AlertCode[] }

/** Time is injected: operational thresholds do not depend on render timing. */
export function assessEmailHealth(s: HealthSnapshot, now = Date.now()): HealthAssessment {
  if (!s.enabled) return { status: 'DISABLED', alerts: [] }
  const alerts: AlertCode[] = []
  const stale = (date: string | null) => date !== null && now - Date.parse(date) > HEALTH_STALE_MS
  if (stale(s.lastDeltaSuccess ?? s.createdAt)) alerts.push('STALE_SYNC')
  if (stale(s.oldestPendingAt)) alerts.push('BACKLOG')
  const expired = !s.subscriptionExpiresAt || Date.parse(s.subscriptionExpiresAt) <= now
  if (s.subscriptionStatus !== 'ACTIVE' || expired || Date.parse(s.subscriptionExpiresAt!) - now < SUBSCRIPTION_CRITICAL_MS) alerts.push('SUBSCRIPTION_CRITICAL')
  const authFailure = [s.lastErrorCode, s.subscriptionError].some(c => c === 'AUTHENTICATION' || c === 'ACCESS_DENIED')
  if (authFailure) alerts.push('GRAPH_AUTH')
  if (s.throttledCount >= 3) alerts.push('THROTTLING')
  if (s.stuckCount > 0) alerts.push('WORKER_STUCK')
  if (s.lastReconciliationResult.missing > 0) alerts.push('RECONCILIATION_GAP')
  if (s.consecutiveFailures >= 3 || s.failedCount > 0 || s.blockedModes.length > 0) alerts.push('REPEATED_RETRY')
  return { status: authFailure || s.blockedModes.length > 0 || (expired && stale(s.lastDeltaSuccess ?? s.createdAt))
    ? 'ERROR' : alerts.length ? 'DEGRADED' : 'HEALTHY', alerts }
}
