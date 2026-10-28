import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('./mapper', () => ({
  mapSerproNfeResponse: vi.fn(() => ({
    status: 'INCONCLUSIVO',
    severity: 'AMARELO',
    summary: 'Cobertura parcial sintética.',
    checkedAt: '2026-10-28T18:00:00.000Z',
    responseFingerprint: 'a'.repeat(64),
    result: { protocolStatus: '100' },
    differences: [],
    events: [],
  })),
}))
import { SerproNfeError } from './provider.server'
import { runSerproNfeWorkerOnce } from './worker.server'

const job = {
  execution_id: '10000000-0000-4000-8000-000000000001',
  consulta_id: '10000000-0000-4000-8000-000000000002',
  snapshot_id: '10000000-0000-4000-8000-000000000003',
  fundo_id: '10000000-0000-4000-8000-000000000004',
  nota_fiscal_id: '10000000-0000-4000-8000-000000000005',
  lease_token: '10000000-0000-4000-8000-000000000006',
}

const snapshot = {
  chave_acesso: '35261014224864000100550020000021901123456788',
  numero_nf: '2190',
  serie: '2',
  cnpj_emitente: '14224864000100',
  cnpj_destinatario: '98100000000168',
  data_emissao: '2026-10-21',
  valor_total: '1000.00',
}

function enableLocalRuntime() {
  vi.stubEnv('SERPRO_NFE_WORKER_ENABLED', 'true')
  vi.stubEnv('SERPRO_NFE_CONTRACT_VERIFIED', 'true')
  vi.stubEnv('SERPRO_NFE_QUERY_ENABLED', 'true')
  vi.stubEnv('SERPRO_NFE_CONSUMPTION_MODE', 'UNLIMITED_WITH_METERING')
  vi.stubEnv('SERPRO_NFE_CONSUMER_KEY', 'synthetic-key')
  vi.stubEnv('SERPRO_NFE_CONSUMER_SECRET', 'synthetic-secret')
}

function makeDb() {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'nfe_fiscal_operational_recover') return { data: 0, error: null }
    if (name === 'nfe_fiscal_operational_claim') return { data: [job], error: null }
    if (name === 'nfe_fiscal_operational_complete') return { data: true, error: null }
    if (name === 'nfe_fiscal_operational_record_failure') return { data: true, error: null }
    return { data: null, error: { message: 'unexpected rpc' } }
  })
  const maybeSingle = vi.fn(async () => ({ data: snapshot, error: null }))
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { db: { rpc, from }, rpc }
}

beforeEach(() => vi.unstubAllEnvs())
afterEach(() => vi.unstubAllEnvs())

describe('worker fiscal operacional fail-closed', () => {
  it('não toca banco nem provider sem modo ilimitado explícito', async () => {
    vi.stubEnv('SERPRO_NFE_WORKER_ENABLED', 'true')
    vi.stubEnv('SERPRO_NFE_CONTRACT_VERIFIED', 'true')
    vi.stubEnv('SERPRO_NFE_QUERY_ENABLED', 'true')
    vi.stubEnv('SERPRO_NFE_CONSUMPTION_MODE', 'OFF_ZERO_BUDGET')
    const db = { rpc: vi.fn(), from: vi.fn() }
    const query = vi.fn()
    await expect(runSerproNfeWorkerOnce({ db, query })).resolves.toEqual({ processed: 0, skipped: 'CAPABILITY_UNVERIFIED' })
    expect(db.rpc).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('reclama e conclui uma execução S2.2 usando o execution_id', async () => {
    enableLocalRuntime()
    const { db, rpc } = makeDb()
    const query = vi.fn(async () => ({ payload: { synthetic: true }, httpStatus: 200 }))

    await expect(runSerproNfeWorkerOnce({ db, query })).resolves.toMatchObject({
      processed: 1,
      status: 'INCONCLUSIVO',
      severity: 'AMARELO',
    })
    expect(query).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenNthCalledWith(1, 'nfe_fiscal_operational_recover')
    expect(rpc).toHaveBeenNthCalledWith(2, 'nfe_fiscal_operational_claim', { p_limit: 1 })
    expect(rpc).toHaveBeenCalledWith('nfe_fiscal_operational_complete', expect.objectContaining({
      p_execution_id: job.execution_id,
      p_lease_token: job.lease_token,
    }))
  })

  it.each([
    [401, false],
    [403, false],
    [404, false],
    [429, false],
    [500, false],
  ])('classifica HTTP %s com retry=%s sem retry interno', async (status, retryable) => {
    enableLocalRuntime()
    const { db, rpc } = makeDb()
    const query = vi.fn(async () => { throw new SerproNfeError(`QUERY_HTTP_${status}`, status) })

    await expect(runSerproNfeWorkerOnce({ db, query })).resolves.toMatchObject({ processed: 1 })
    expect(query).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('nfe_fiscal_operational_record_failure', expect.objectContaining({
      p_execution_id: job.execution_id,
      p_retryable: retryable,
      p_http_status: status,
    }))
  })
})
