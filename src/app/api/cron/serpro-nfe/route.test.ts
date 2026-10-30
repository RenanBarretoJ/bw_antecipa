import { afterEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ config: vi.fn(), worker: vi.fn(), metrics: vi.fn() }))
vi.mock('@/lib/serpro-nfe/provider.server', () => ({ readSerproNfeRuntimeConfig: m.config }))
vi.mock('@/lib/serpro-nfe/recovery.server', () => ({ runSerproNfeRecoveryBatch: m.worker }))
vi.mock('@/lib/serpro-nfe/monitoring.server', () => ({ readSerproNfeQueueMetrics: m.metrics }))
import { GET } from './route'
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
describe('dormant durable pickup endpoint', () => {
  it('OFF does not create a client, claim a job or call a provider', async () => {
    m.config.mockReturnValue({ ready: false })
    expect((await GET(new Request('http://localhost/api/cron/serpro-nfe'))).status).toBe(404)
    expect(m.worker).not.toHaveBeenCalled()
    expect(m.metrics).not.toHaveBeenCalled()
  })
  it('requires existing server-side secret; no cookie or user payload substitutes it', async () => {
    m.config.mockReturnValue({ ready: true })
    vi.stubEnv('CRON_SECRET', 'synthetic-qa-secret')
    expect((await GET(new Request('http://localhost/api/cron/serpro-nfe'))).status).toBe(401)
    expect(m.worker).not.toHaveBeenCalled()
    expect(m.metrics).not.toHaveBeenCalled()
  })
  it('invokes one bounded recovery round, not the old generic queue', async () => {
    m.config.mockReturnValue({ ready: true })
    vi.stubEnv('CRON_SECRET', 'synthetic-qa-secret')
    m.worker.mockResolvedValue({ processed: 0, completed: 0, failed: 0, deferred: 0, stopReason: 'NO_JOB_CLAIMED' })
    m.metrics.mockResolvedValue({ state: 'OFF' })
    expect((await GET(new Request('http://localhost/api/cron/serpro-nfe', {
      headers: { authorization: 'Bearer synthetic-qa-secret' },
    }))).status).toBe(200)
    expect(m.worker).toHaveBeenCalledOnce()
  })
  it('rejects query parameters without invoking recovery', async () => {
    m.config.mockReturnValue({ ready: true })
    vi.stubEnv('CRON_SECRET', 'synthetic-qa-secret')
    expect((await GET(new Request('http://localhost/api/cron/serpro-nfe?limit=100', {
      headers: { authorization: 'Bearer synthetic-qa-secret' },
    }))).status).toBe(400)
    expect(m.worker).not.toHaveBeenCalled()
  })
  it('retains bounded partial counts and returns 503 on infrastructure failure', async () => {
    m.config.mockReturnValue({ ready: true })
    vi.stubEnv('CRON_SECRET', 'synthetic-qa-secret')
    m.worker.mockResolvedValue({ processed: 1, completed: 1, failed: 0, deferred: 0, stopReason: 'INFRASTRUCTURE_ERROR' })
    m.metrics.mockResolvedValue({ state: 'OFF' })
    const response = await GET(new Request('http://localhost/api/cron/serpro-nfe', { headers: { authorization: 'Bearer synthetic-qa-secret' } }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ processed: 1, stopReason: 'INFRASTRUCTURE_ERROR' })
    expect(m.worker).toHaveBeenCalledOnce()
  })
  it('does not claim or call a provider if pre-run monitoring is unavailable', async () => {
    m.config.mockReturnValue({ ready: true })
    vi.stubEnv('CRON_SECRET', 'synthetic-qa-secret')
    m.metrics.mockRejectedValue(Error('private diagnostic must not be returned'))
    const response = await GET(new Request('http://localhost/api/cron/serpro-nfe', { headers: { authorization: 'Bearer synthetic-qa-secret' } }))
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('')
    expect(m.worker).not.toHaveBeenCalled()
    expect(m.metrics).toHaveBeenCalledOnce()
  })
  it('preserves partial counts if post-run metrics fail, without another worker call', async () => {
    m.config.mockReturnValue({ ready: true })
    vi.stubEnv('CRON_SECRET', 'synthetic-qa-secret')
    m.metrics.mockResolvedValueOnce({ state: 'OFF' }).mockRejectedValueOnce(Error('do not expose'))
    m.worker.mockResolvedValue({ processed: 1, completed: 1, failed: 0, deferred: 0, stopReason: 'NO_JOB_CLAIMED' })
    const response = await GET(new Request('http://localhost/api/cron/serpro-nfe', { headers: { authorization: 'Bearer synthetic-qa-secret' } }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ processed: 1, completed: 1, stopReason: 'INFRASTRUCTURE_ERROR' })
    expect(m.worker).toHaveBeenCalledOnce()
  })
  it('rejects a request body even with the valid synthetic cron secret', async () => {
    m.config.mockReturnValue({ ready: true })
    vi.stubEnv('CRON_SECRET', 'synthetic-qa-secret')
    const request = { headers: new Headers({ authorization: 'Bearer synthetic-qa-secret' }), url: 'http://localhost/api/cron/serpro-nfe', body: new ReadableStream() } as Request
    expect((await GET(request)).status).toBe(400)
    expect(m.worker).not.toHaveBeenCalled()
    expect(m.metrics).not.toHaveBeenCalled()
  })
})
