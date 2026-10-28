import { afterEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ config: vi.fn(), worker: vi.fn() }))
vi.mock('@/lib/serpro-nfe/provider.server', () => ({ readSerproNfeRuntimeConfig: m.config }))
vi.mock('@/lib/serpro-nfe/worker.server', () => ({ runSerproNfeWorkerOnce: m.worker }))
import { GET } from './route'
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
describe('dormant durable pickup endpoint', () => {
  it('OFF does not create a client, claim a job or call a provider', async () => {
    m.config.mockReturnValue({ ready: false })
    expect((await GET(new Request('http://localhost/api/cron/serpro-nfe'))).status).toBe(404)
    expect(m.worker).not.toHaveBeenCalled()
  })
  it('requires existing server-side secret; no cookie or user payload substitutes it', async () => {
    m.config.mockReturnValue({ ready: true })
    vi.stubEnv('CRON_SECRET', 'synthetic-qa-secret')
    expect((await GET(new Request('http://localhost/api/cron/serpro-nfe'))).status).toBe(401)
    expect(m.worker).not.toHaveBeenCalled()
  })
  it('invokes the same worker once, not the old generic queue', async () => {
    m.config.mockReturnValue({ ready: true })
    vi.stubEnv('CRON_SECRET', 'synthetic-qa-secret')
    m.worker.mockResolvedValue({ processed: 0, skipped: 'EMPTY_QUEUE' })
    expect((await GET(new Request('http://localhost/api/cron/serpro-nfe', {
      headers: { authorization: 'Bearer synthetic-qa-secret' },
    }))).status).toBe(200)
    expect(m.worker).toHaveBeenCalledOnce()
  })
})
