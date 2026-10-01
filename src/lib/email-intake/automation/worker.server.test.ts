import { describe, expect, it, vi } from 'vitest'
import { IntakeError, type EmailProviderAdapter } from '../contracts'
import type { AutomationRepository } from './repository.server'
import type { AutomationJob } from './job'
import { runOperationalJob } from './worker.server'

vi.mock('../secrets.server', () => ({ protectValue: vi.fn(), revealValue: vi.fn(() => 'opaque-existing-value') }))
const id = '11111111-1111-4111-8111-111111111111'
function job(patch: Partial<AutomationJob> = {}): AutomationJob {
  return { integrationId: id, fundoId: id, token: id, kind: 'DELTA', tenantId: id, mailboxObjectId: id,
    provider: 'OUTLOOK_GRAPH', mailbox: 'qa@example.invalid', folderId: 'inbox', credentialEnvRef: 'EMAIL_INTAKE_QA_TEST',
    credentialCiphertext: null, credentialKeyVersion: null, resource: `users/${id}/mailFolders/inbox/messages`,
    subscriptionId: null, subscriptionStatus: 'MISSING', subscriptionExpiresAt: null, clientStateCiphertext: null,
    clientStateKeyVersion: null, attempt: 1, startAt: '2026-09-23T00:00:00Z', discoveryToken: id,
    revision: 0, cursorCiphertext: null, cursorKeyVersion: null, ...patch }
}
function setup(state = job()) {
  const repository: AutomationRepository = { claim: vi.fn().mockResolvedValue(state), commitPage: vi.fn().mockResolvedValue(1),
    fail: vi.fn().mockResolvedValue(undefined), prepareSubscription: vi.fn().mockResolvedValue(undefined),
    completeSubscription: vi.fn().mockResolvedValue(undefined), healthSnapshots: vi.fn().mockResolvedValue([]), applyHealth: vi.fn().mockResolvedValue(undefined) }
  const adapter: EmailProviderAdapter = { testConnection: vi.fn(), createOrRenewSubscription: vi.fn().mockResolvedValue({ externalId: 'sub', expiresAt: '2026-10-06T00:00:00Z' }),
    findSubscription: vi.fn().mockResolvedValue(null), syncMessages: vi.fn().mockResolvedValue({ messages: [], continuation: 'cursor', complete: true }),
    reconcileMessages: vi.fn().mockResolvedValue({ messages: [], continuation: '', complete: true }), getMessage: vi.fn(),
    listAttachments: vi.fn().mockResolvedValue([]), downloadAttachment: vi.fn(), normalizeExternalIdentity: x => x }
  return { repository, adapter, dependencies: { repository, provider: () => adapter, endpoint: () => 'https://qa.example.test/api/email-intake/graph' } }
}
describe('operational orchestration preserves durable transport', () => {
  it('idle lock does not contact Graph', async () => {
    const s = setup(); vi.mocked(s.repository.claim).mockResolvedValue(null)
    expect(await runOperationalJob('DELTA', s.dependencies)).toEqual({ status: 'IDLE' })
    expect(s.adapter.syncMessages).not.toHaveBeenCalled()
  })
  it('commits discovery before any checkpoint advance and never downloads files', async () => {
    const s = setup(); await runOperationalJob('DELTA', s.dependencies)
    expect(s.repository.commitPage).toHaveBeenCalledOnce(); expect(s.adapter.downloadAttachment).not.toHaveBeenCalled()
  })
  it.each(['THROTTLED', 'PROVIDER_UNAVAILABLE', 'CURSOR_EXPIRED', 'AUTHENTICATION'] as const)('settles %s without moving the checkpoint', async code => {
    const s = setup(), error = new IntakeError(code, code === 'THROTTLED' || code === 'PROVIDER_UNAVAILABLE', 120000)
    vi.mocked(s.adapter.syncMessages).mockRejectedValue(error)
    expect(await runOperationalJob('DELTA', s.dependencies)).toEqual({ status: 'DEFERRED', code })
    expect(s.repository.commitPage).not.toHaveBeenCalled(); expect(s.repository.fail).toHaveBeenCalledWith(expect.anything(), error, 120000)
  })
  it('does not commit a page with partially failed attachment discovery', async () => {
    const s = setup()
    vi.mocked(s.adapter.syncMessages).mockResolvedValue({ messages: [{ externalId: 'mail', receivedAt: '2026-09-30T00:00:00Z', hasAttachments: true, removed: false }], continuation: 'next-page', complete: false })
    vi.mocked(s.adapter.listAttachments).mockRejectedValue(new IntakeError('PROVIDER_UNAVAILABLE', true))
    await runOperationalJob('DELTA', s.dependencies)
    expect(s.repository.commitPage).not.toHaveBeenCalled()
  })
  it('uses the independent reconciliation cursor and regular durable commit', async () => {
    const s = setup(job({ kind: 'RECONCILIATION' })); await runOperationalJob('RECONCILIATION', s.dependencies)
    expect(s.adapter.reconcileMessages).toHaveBeenCalledOnce(); expect(s.adapter.syncMessages).not.toHaveBeenCalled()
    expect(s.repository.commitPage).toHaveBeenCalledOnce()
  })
  it('persists the protected client state before subscription creation', async () => {
    const s = setup(job({ kind: 'SUBSCRIPTION' })); await runOperationalJob('SUBSCRIPTION', s.dependencies)
    expect(s.repository.prepareSubscription).toHaveBeenCalledOnce()
    expect(vi.mocked(s.repository.prepareSubscription).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(s.adapter.createOrRenewSubscription).mock.invocationCallOrder[0])
    expect(s.repository.completeSubscription).toHaveBeenCalledOnce()
  })
  it('adopts the exact remote subscription after interrupted persistence', async () => {
    const s = setup(job({ kind: 'SUBSCRIPTION', clientStateCiphertext: 'protected', clientStateKeyVersion: 'v1' }))
    vi.mocked(s.adapter.findSubscription!).mockResolvedValue({ externalId: 'existing', expiresAt: '2026-10-06T00:00:00Z' })
    await runOperationalJob('SUBSCRIPTION', s.dependencies)
    expect(s.repository.prepareSubscription).not.toHaveBeenCalled()
    expect(s.adapter.createOrRenewSubscription).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'existing' }))
  })
  it('recreates an externally removed subscription after 404 and preserves renewal failures', async () => {
    const s = setup(job({ kind: 'SUBSCRIPTION', subscriptionId: 'removed' }))
    vi.mocked(s.adapter.createOrRenewSubscription).mockRejectedValueOnce(new IntakeError('NOT_FOUND'))
    await runOperationalJob('SUBSCRIPTION', s.dependencies)
    expect(s.adapter.createOrRenewSubscription).toHaveBeenCalledTimes(2)
    expect(s.repository.completeSubscription).toHaveBeenCalledOnce()
  })
})
