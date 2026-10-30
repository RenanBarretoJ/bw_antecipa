import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const admin = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: admin.create }))
import { readSerproNfeQueueMetrics, type SerproQueueObservationInput } from './monitoring.server'

const now = Date.parse('2026-10-30T15:00:00Z')
const provider = {
  capability_state: 'ENABLED', consumption_mode: 'UNLIMITED_WITH_METERING', circuit_state: 'CLOSED',
  cutover_at: '2026-10-30T12:00:00Z', oauth_dispatch_count: 4, get_dispatch_count: 3,
  http_response_count: 6, estimated_unit_cost: null, cost_currency: 'BRL',
}
const observation = (): SerproQueueObservationInput => ({ provider, pending: 1, inProgress: 2, failed: 3, oldestPendingAt: '2026-10-30T14:54:59Z' })
beforeEach(() => {
  vi.clearAllMocks()
  for (const flag of ['WORKER_ENABLED', 'QUERY_ENABLED', 'CONTRACT_VERIFIED']) vi.stubEnv(`SERPRO_NFE_${flag}`, 'true')
  vi.stubEnv('SERPRO_NFE_CONSUMPTION_MODE', 'UNLIMITED_WITH_METERING')
  vi.stubEnv('SERPRO_NFE_CONSUMER_KEY', 'synthetic')
  vi.stubEnv('SERPRO_NFE_CONSUMER_SECRET', 'synthetic')
})
afterEach(() => vi.unstubAllEnvs())
describe('sanitized operational observations, not billing proof', () => {
  it('reads pending count and oldest row atomically and only through existing read grants', async () => {
    const query = (data: unknown, count: number | null = null) => {
      const result = Promise.resolve({ data, count, error: null })
      const chain = Object.assign(result, {
        select: vi.fn(), eq: vi.fn(), gte: vi.fn(), in: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(() => result),
      })
      for (const fn of [chain.select, chain.eq, chain.gte, chain.in, chain.order, chain.limit]) fn.mockReturnValue(chain)
      return chain
    }
    const state = query(provider), pending = query({ requested_at: '2026-10-30T14:54:59Z' }, 1)
    const inProgress = query(null, 2), failed = query(null, 3)
    const from = vi.fn().mockReturnValueOnce(state).mockReturnValueOnce(pending).mockReturnValueOnce(inProgress).mockReturnValueOnce(failed)
    admin.create.mockReturnValue({ from })
    expect(await readSerproNfeQueueMetrics({ now: () => now })).toMatchObject({ pending: 1, oldestWaitSeconds: 301 })
    expect(from.mock.calls.map(call => call[0])).toEqual(['nfe_fiscal_provider_state', 'nfe_fiscal_execucoes', 'nfe_fiscal_execucoes', 'nfe_fiscal_execucoes'])
    expect(pending.select).toHaveBeenCalledWith('requested_at', { count: 'exact' })
    expect(pending.eq).toHaveBeenCalledWith('eligible_post_cutover', true)
    expect(pending.gte).toHaveBeenCalledWith('requested_at', provider.cutover_at)
    expect(pending.limit).toHaveBeenCalledWith(1)
    expect(admin.create).toHaveBeenCalledOnce()
  })
  it('does not read a database while OFF', async () => {
    vi.stubEnv('SERPRO_NFE_WORKER_ENABLED', 'false')
    const load = vi.fn()
    expect(await readSerproNfeQueueMetrics({ load })).toEqual({ state: 'OFF' })
    expect(load).not.toHaveBeenCalled()
  })
  it('reports cohort backlog and warns only beyond five minutes', async () => {
    const result = await readSerproNfeQueueMetrics({ load: async () => observation(), now: () => now })
    expect(result).toMatchObject({ pending: 1, inProgress: 2, failed: 3, oldestWaitSeconds: 301,
      agingAlert: true, oauthAuthorizations: 4, nfeAuthorizations: 3, httpResponsesObserved: 6,
      estimatedUnitCost: null, estimateAvailable: false, actualChargeVerified: false })
  })
  it('does not invent a zero estimate, fiscal identifiers, or billing from unknown costs', async () => {
    const result = await readSerproNfeQueueMetrics({ load: async () => ({ ...observation(), provider: { ...provider, password: 'never-return', chave_acesso: 'never-return' } }), now: () => now })
    expect(JSON.stringify(result)).not.toContain('never-return')
    expect(JSON.stringify(result)).not.toContain('chave_acesso')
    expect(result).toMatchObject({ estimateAvailable: false, estimatedUnitCost: null })
  })
  it('does not alert at the exact five-minute boundary', async () => {
    const result = await readSerproNfeQueueMetrics({ load: async () => ({ ...observation(), oldestPendingAt: '2026-10-30T14:55:00Z' }), now: () => now })
    expect(result).toMatchObject({ agingAlert: false, oldestWaitSeconds: 300 })
  })
  it('makes clock skew explicit instead of claiming a fresh/zero-age queue', async () => {
    const result = await readSerproNfeQueueMetrics({ load: async () => ({ ...observation(), oldestPendingAt: '2026-10-30T15:00:01Z' }), now: () => now })
    expect(result).toMatchObject({ clockSkew: true, oldestWaitSeconds: null, agingAlert: false })
  })
  it('reports a missing cutover/provider OFF honestly without mutating it', async () => {
    const result = await readSerproNfeQueueMetrics({ load: async () => ({ provider: { ...provider, cutover_at: null, circuit_state: 'OPEN', capability_state: 'UNVERIFIED', consumption_mode: 'OFF_ZERO_BUDGET' }, pending: 0, inProgress: 0, failed: 0, oldestPendingAt: null }), now: () => now })
    expect(result).toMatchObject({ circuitState: 'OPEN', consumptionMode: 'OFF_ZERO_BUDGET', pending: 0, oldestWaitSeconds: null })
  })
  it.each([null, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('fails closed for an invalid count: %s', async pending => {
    await expect(readSerproNfeQueueMetrics({ load: async () => ({ ...observation(), pending }), now: () => now })).rejects.toThrow()
  })
  it('rejects inconsistent counts instead of reporting clean metrics', async () => {
    await expect(readSerproNfeQueueMetrics({ load: async () => ({ ...observation(), pending: 0 }), now: () => now })).rejects.toThrow('SERPRO_METRICS_INCONSISTENT')
  })
  it('propagates read failure without a retry or exposing its text in a result', async () => {
    const load = vi.fn().mockRejectedValue(Error('synthetic infrastructure failure'))
    await expect(readSerproNfeQueueMetrics({ load, now: () => now })).rejects.toThrow()
    expect(load).toHaveBeenCalledOnce()
  })
})
