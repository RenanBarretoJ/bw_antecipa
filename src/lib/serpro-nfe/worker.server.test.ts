import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
import { runSerproNfeWorkerOnce } from './worker.server'

afterEach(() => vi.unstubAllEnvs())

describe('worker fiscal fail-closed', () => {
  it('não toca banco nem provider sem capacidade contratual comprovada', async () => {
    vi.stubEnv('SERPRO_NFE_WORKER_ENABLED', 'false')
    const db = { rpc: vi.fn(), from: vi.fn() }
    const query = vi.fn()
    await expect(runSerproNfeWorkerOnce({ db, query })).resolves.toEqual({ processed: 0, skipped: 'CAPABILITY_UNVERIFIED' })
    expect(db.rpc).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })
})
