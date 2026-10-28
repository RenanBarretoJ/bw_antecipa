import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { createOperationalFetcher } from './outbound.server'
import { querySerproNfe, readSerproNfeRuntimeConfig } from './provider.server'

const job = { execution_id: 'c1000000-0000-4000-8000-000000000001', lease_token: 'c1000000-0000-4000-8000-000000000002' }
const ticket = 'c1000000-0000-4000-8000-000000000003'
beforeEach(() => {
  for (const flag of ['WORKER_ENABLED', 'CONTRACT_VERIFIED', 'QUERY_ENABLED']) vi.stubEnv(`SERPRO_NFE_${flag}`, 'true')
  vi.stubEnv('SERPRO_NFE_CONSUMPTION_MODE', 'UNLIMITED_WITH_METERING')
  vi.stubEnv('SERPRO_NFE_CONSUMER_KEY', 'synthetic-key')
  vi.stubEnv('SERPRO_NFE_CONSUMER_SECRET', 'synthetic-secret')
})
afterEach(() => vi.unstubAllEnvs())

describe('outbound credential gate (provider fetch always synthetic)', () => {
  it('authorizes and observes OAuth AND GET separately, in actual fetch order', async () => {
    const trace: string[] = []
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      trace.push(`${name}:${args.p_phase ?? args.p_http_status}`)
      return { data: name.endsWith('_begin') ? { code: 'AUTHORIZED', ticket } : true, error: null }
    })
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => { trace.push('POST'); return new Response('{"access_token":"synthetic-token"}') })
      .mockImplementationOnce(async () => { trace.push('GET'); return new Response('{"nfeProc":{}}') })
    const config = readSerproNfeRuntimeConfig()
    await querySerproNfe('35261014224864000100550020000021901123456788', config,
      createOperationalFetcher({ rpc }, job, config, fetcher))
    expect(trace).toEqual([
      'nfe_fiscal_operational_http_begin:OAUTH', 'POST', 'nfe_fiscal_operational_http_observed:200',
      'nfe_fiscal_operational_http_begin:GET_NFE', 'GET', 'nfe_fiscal_operational_http_observed:200',
    ])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('WAIT is backpressure, not an extra provider request', async () => {
    let grants = 0
    const rpc = vi.fn(async (name: string) => ({
      data: name.endsWith('_begin')
        ? (++grants === 1 ? { code: 'WAIT' } : { code: 'AUTHORIZED', ticket }) : true,
      error: null,
    }))
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    const pause = vi.fn(async () => {})
    const config = readSerproNfeRuntimeConfig()
    await createOperationalFetcher({ rpc }, job, config, fetcher, pause)(config.tokenUrl)
    expect(pause).toHaveBeenCalledWith(100)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each(['OFF', 'LEASE_LOST', 'ALREADY_AUTHORIZED', 'OUTCOME_UNKNOWN', 'IDENTITY_MISMATCH'])(
    'denies %s before any fetch', async code => {
      const rpc = vi.fn(async () => ({ data: { code }, error: null }))
      const fetcher = vi.fn<typeof fetch>()
      const config = readSerproNfeRuntimeConfig()
      await expect(createOperationalFetcher({ rpc }, job, config, fetcher)(config.tokenUrl)).rejects.toMatchObject({ code: 'OUTBOUND_DENIED' })
      expect(fetcher).not.toHaveBeenCalled()
    },
  )

  it('does not invent a response or repeat fetch after uncertain transport failure', async () => {
    const rpc = vi.fn(async () => ({ data: { code: 'AUTHORIZED', ticket }, error: null }))
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('synthetic disconnect'))
    const config = readSerproNfeRuntimeConfig()
    await expect(createOperationalFetcher({ rpc }, job, config, fetcher)(config.tokenUrl)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('kill switch revalidated immediately before outbound; no gate or provider when OFF', async () => {
    const config = readSerproNfeRuntimeConfig()
    vi.stubEnv('SERPRO_NFE_WORKER_ENABLED', 'false')
    const rpc = vi.fn(), fetcher = vi.fn<typeof fetch>()
    await expect(createOperationalFetcher({ rpc }, job, config, fetcher)(config.tokenUrl)).rejects.toMatchObject({ code: 'CAPABILITY_UNVERIFIED' })
    expect(rpc).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
