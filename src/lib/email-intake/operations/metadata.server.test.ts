import { beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshEmailMetadata } from './metadata.server'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), json: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('../provider-factory.server', async importOriginal => {
  const original = await importOriginal<typeof import('../provider-factory.server')>()
  return { ...original, createEmailGraphClient: mocks.client }
})
const fund = '11111111-1111-4111-8111-111111111111', integration = '22222222-2222-4222-8222-222222222222'
const token = '33333333-3333-4333-8333-333333333333'
const source = (count: number) => [{ integrationId: integration, fundoId: fund, provider: 'OUTLOOK_GRAPH', mailbox: 'qa@example.invalid', folderId: 'inbox',
  credentialEnvRef: null, credentialCiphertext: null, credentialKeyVersion: null,
  messages: Array.from({ length: count }, (_, index) => ({ id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`, externalId: `private-message-${index}` })) }]

beforeEach(() => { vi.resetAllMocks(); mocks.client.mockResolvedValue({ json: mocks.json }) })
describe('operator metadata enrichment', () => {
  it('batches at most 20 requests and stores only redacted presentation fields', async () => {
    mocks.rpc.mockImplementation(async (name: string, args: { p_rows?: unknown[] }) => name === 'email_operator_metadata_source' ? { data: source(25), error: null } : { data: args.p_rows?.length ?? 0, error: null })
    mocks.json.mockImplementation(async (_path: string, _schema: unknown, init: RequestInit) => {
      const requests = JSON.parse(String(init.body)).requests as { id: string; url: string }[]
      expect(requests.length).toBeLessThanOrEqual(20)
      expect(requests.every(row => row.url.endsWith('?$select=subject,sender'))).toBe(true)
      return { responses: requests.map(row => ({ id: row.id, status: 200, body: { subject: 'NF secret=private-key', sender: { emailAddress: { address: 'financeiro@example.invalid' } }, body: 'must not be persisted' } })) }
    })
    expect(await refreshEmailMetadata(fund, token)).toEqual({ updated: 25, failed: 0 })
    expect(mocks.json).toHaveBeenCalledTimes(2)
    const persisted = mocks.rpc.mock.calls.filter(([name]) => name === 'email_operator_complete_metadata').map(([, args]) => args)
    const text = JSON.stringify(persisted)
    expect(text).toContain('f***@example.invalid')
    expect(text).not.toMatch(/private-message|private-key|financeiro@|must not be persisted|externalId/)
  })
  it('never queries a provider for data belonging to a different fund', async () => {
    mocks.rpc.mockResolvedValue({ data: source(1), error: null })
    await expect(refreshEmailMetadata(integration, token)).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('keeps failed provider responses out of persistence and reports partial success', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'email_operator_metadata_source' ? { data: source(2), error: null } : { data: 1, error: null })
    mocks.json.mockResolvedValue({ responses: [{ id: '0', status: 403, body: { message: 'private provider details' } }, { id: '1', status: 200, body: { subject: 'NF recebida' } }] })
    expect(await refreshEmailMetadata(fund, token)).toEqual({ updated: 1, failed: 1 })
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('private provider details')
  })
  it('counts a persistence failure once, including responses that already failed at the provider', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'email_operator_metadata_source' ? { data: source(2), error: null } : { data: null, error: { code: '08006' } })
    mocks.json.mockResolvedValue({ responses: [{ id: '0', status: 403, body: {} }, { id: '1', status: 200, body: { subject: 'NF recebida' } }] })
    expect(await refreshEmailMetadata(fund, token)).toEqual({ updated: 0, failed: 2 })
  })
  it('reports an expired metadata lease as an unsuccessful update', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'email_operator_metadata_source' ? { data: source(1), error: null } : { data: 0, error: null })
    mocks.json.mockResolvedValue({ responses: [{ id: '0', status: 200, body: { subject: 'NF recebida' } }] })
    expect(await refreshEmailMetadata(fund, token)).toEqual({ updated: 0, failed: 1 })
  })
})
