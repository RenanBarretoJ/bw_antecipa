import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { criptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'
import { resolveEmailCredential, createVaultEmailProvider, testEmailMailbox } from './credentials.server'
import { createEmailProvider } from '../provider-factory.server'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))
const integrationId = '11111111-1111-4111-8111-111111111111', fundoId = '22222222-2222-4222-8222-222222222222'
const tenantId = '33333333-3333-4333-8333-333333333333', clientId = '44444444-4444-4444-8444-444444444444'
const objectId = '55555555-5555-4555-8555-555555555555'
function material() {
  const identity = criptografarPortalFidcValor(JSON.stringify({ tenantId, clientId }))
  return { integrationId, fundoId, mailbox: 'qa@example.invalid', objectId, folderId: 'inbox',
    identityCiphertext: identity.ciphertext, secretCiphertext: criptografarPortalFidcValor('QA-SECRET-NOT-REAL').ciphertext, keyVersion: identity.chaveVersao }
}
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('PORTAL_FIDC_CREDENTIAL_KEYS_JSON', JSON.stringify({ qa: Buffer.alloc(32, 7).toString('base64') }))
  vi.stubEnv('PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION', 'qa')
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.rpc.mockResolvedValue({ data: material(), error: null })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('existing credential vault for email', () => {
  it('never resolves a credential under a different fund or integration', async () => {
    await expect(resolveEmailCredential(integrationId, objectId)).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    mocks.rpc.mockResolvedValue({ data: { ...material(), integrationId: objectId }, error: null })
    await expect(resolveEmailCredential(integrationId, fundoId)).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('does not fall back to env when a vault record is revoked or unreadable', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'database details must never escape' } })
    const provider = createVaultEmailProvider(integrationId, fundoId)
    await expect(provider.testConnection()).rejects.toThrow('CONFIGURATION')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('sanitizes corrupted ciphertext and validates the identity at runtime', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...material(), secretCiphertext: 'sensitive-corrupt-secret' }, error: null })
    await expect(resolveEmailCredential(integrationId, fundoId)).rejects.toThrow('CONFIGURATION')
  })
  it('resolves once per claimed job and keeps Graph operations in the existing adapter', async () => {
    mocks.fetch.mockImplementation(async (url: URL | string) => String(url).includes('login.microsoftonline.com')
      ? json({ access_token: 'QA-TOKEN', expires_in: 3600 }) : json({ value: [] }))
    const provider = createVaultEmailProvider(integrationId, fundoId)
    await Promise.all([provider.testConnection(), provider.testConnection()])
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls.filter(([url]) => String(url).includes('login.microsoftonline.com'))).toHaveLength(1)
  })
  it('checks that object ID and address refer to the same folder without subscribing or reading content', async () => {
    mocks.fetch.mockImplementation(async (url: URL | string) => String(url).includes('login.microsoftonline.com')
      ? json({ access_token: 'QA-TOKEN', expires_in: 3600 }) : String(url).includes('/messages?') ? json({ value: [] }) : json({ id: 'same-folder' }))
    await expect(testEmailMailbox(integrationId, fundoId)).resolves.toBe(tenantId)
    const urls = mocks.fetch.mock.calls.map(([url]) => String(url)).join('\n')
    expect(urls).toContain(objectId); expect(urls).toContain('qa%40example.invalid')
    expect(urls).not.toMatch(/subscriptions|\$value|attachments|body/)
    mocks.fetch.mockImplementation(async (url: URL | string) => String(url).includes('login.microsoftonline.com')
      ? json({ access_token: 'QA-TOKEN', expires_in: 3600 }) : json({ id: String(url).includes(objectId) ? 'one' : 'other' }))
    await expect(testEmailMailbox(integrationId, fundoId)).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
  })
  it('keeps the explicit legacy QA environment configuration available', async () => {
    vi.stubEnv('EMAIL_INTAKE_QA_TEST_TENANT_ID', tenantId); vi.stubEnv('EMAIL_INTAKE_QA_TEST_CLIENT_ID', clientId)
    vi.stubEnv('EMAIL_INTAKE_QA_TEST_CLIENT_SECRET', 'QA-LEGACY')
    mocks.fetch.mockImplementation(async (url: URL | string) => String(url).includes('login.microsoftonline.com')
      ? json({ access_token: 'QA-TOKEN', expires_in: 3600 }) : json({ value: [] }))
    await createEmailProvider({ integrationId, fundoId, provider: 'OUTLOOK_GRAPH', mailbox: 'qa@example.invalid', folderId: 'inbox',
      credentialEnvRef: 'EMAIL_INTAKE_QA_TEST', credentialCiphertext: null, credentialKeyVersion: null }).testConnection()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
