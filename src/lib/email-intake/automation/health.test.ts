import { afterEach, describe, expect, it, vi } from 'vitest'
import { assessEmailHealth, HEALTH_STALE_MS, type HealthSnapshot } from './health'

const now = Date.parse('2026-09-30T12:00:00Z')
function snapshot(patch: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return { integrationId: '11111111-1111-4111-8111-111111111111', name: 'QA', provider: 'OUTLOOK_GRAPH',
    mailbox: 'qa@example.invalid', enabled: true, createdAt: new Date(now).toISOString(), lastConnectionSuccess: null,
    lastDeltaSuccess: new Date(now).toISOString(), lastWebhookSignal: null, lastMessageDiscovered: null,
    lastAttachmentProcessed: null, pendingCount: 0, processingCount: 0, retryableCount: 0, failedCount: 0,
    requiresReviewCount: 0, oldestPendingAt: null, stuckCount: 0, subscriptionStatus: 'ACTIVE',
    subscriptionExpiresAt: new Date(now + 6 * 86400_000).toISOString(), lastReconciliationAt: null,
    lastReconciliationResult: { scanned: 0, missing: 0, recovered: 0, duplicates: 0, errors: 0 },
    lastErrorCode: null, subscriptionError: null, consecutiveFailures: 0, throttledCount: 0, blockedModes: [], ...patch }
}
afterEach(() => vi.useRealTimers())
describe('operational health clock', () => {
  it('changes healthy to degraded on stale sync and recovers after a successful delta', () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const state = snapshot()
    expect(assessEmailHealth(state).status).toBe('HEALTHY')
    vi.advanceTimersByTime(HEALTH_STALE_MS + 1)
    expect(assessEmailHealth(state).alerts).toEqual(['STALE_SYNC'])
    expect(assessEmailHealth({ ...state, lastDeltaSuccess: new Date().toISOString() }).status).toBe('HEALTHY')
  })
  it('warns before subscription expiry and errors when both subscription and delta are stale', () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const state = snapshot({ subscriptionExpiresAt: new Date(now + 3600_001).toISOString() })
    expect(assessEmailHealth(state).status).toBe('HEALTHY')
    vi.advanceTimersByTime(2); expect(assessEmailHealth(state).alerts).toEqual(['SUBSCRIPTION_CRITICAL'])
    vi.advanceTimersByTime(3600_000); expect(assessEmailHealth(state).status).toBe('ERROR')
  })
  it('disabled integrations cannot raise stale alerts', () => {
    expect(assessEmailHealth(snapshot({ enabled: false, subscriptionExpiresAt: null, lastErrorCode: 'AUTHENTICATION' }), now))
      .toEqual({ status: 'DISABLED', alerts: [] })
  })
  it.each([
    [{ oldestPendingAt: new Date(now - HEALTH_STALE_MS - 1).toISOString() }, 'BACKLOG'],
    [{ stuckCount: 1 }, 'WORKER_STUCK'], [{ throttledCount: 3 }, 'THROTTLING'],
    [{ consecutiveFailures: 3 }, 'REPEATED_RETRY'], [{ subscriptionError: 'ACCESS_DENIED' }, 'GRAPH_AUTH'],
    [{ lastReconciliationResult: { scanned: 3, missing: 1, recovered: 1, duplicates: 2, errors: 0 } }, 'RECONCILIATION_GAP'],
  ] as const)('detects operational failure %s', (patch, alert) => {
    expect(assessEmailHealth(snapshot(patch), now).alerts).toContain(alert)
  })
  it('manual review alone is not a stuck worker or error', () => {
    expect(assessEmailHealth(snapshot({ requiresReviewCount: 5 }), now)).toEqual({ status: 'HEALTHY', alerts: [] })
  })
})
