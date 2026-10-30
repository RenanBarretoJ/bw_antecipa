import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))

import { integrationRuntimeEnvironment } from './resolver.server'

afterEach(() => vi.unstubAllEnvs())

describe('explicit integration environment in a deployed Preview', () => {
  it('rejects Preview as a domain environment in a production Node runtime', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'preview')
    vi.stubEnv('INTEGRATION_RUNTIME_ENV', undefined)
    expect(() => integrationRuntimeEnvironment()).toThrow('INTEGRATION_RUNTIME_ENV deve ser configurado explicitamente')
  })

  it('uses explicit homologacao without interpreting Preview as production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'preview')
    vi.stubEnv('INTEGRATION_RUNTIME_ENV', 'homologacao')
    expect(integrationRuntimeEnvironment()).toBe('homologacao')
  })

  it('keeps an invalid explicit environment fail-closed despite a valid public fallback', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production')
    vi.stubEnv('INTEGRATION_RUNTIME_ENV', 'unexpected')
    expect(() => integrationRuntimeEnvironment()).toThrow('INTEGRATION_RUNTIME_ENV deve ser configurado explicitamente')
  })
})
