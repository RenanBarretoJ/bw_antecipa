import { describe, expect, it, vi } from 'vitest'
import { discoverPage, type DiscoveryRepository } from './discovery'
import type { EmailProviderAdapter } from './contracts'

function fixture() {
  const adapter: EmailProviderAdapter = {
    testConnection: vi.fn(), createOrRenewSubscription: vi.fn(), getMessage: vi.fn(),
    normalizeExternalIdentity: value => value, downloadAttachment: vi.fn(),
    syncMessages: vi.fn().mockResolvedValue({ messages: [
      { externalId: 'm1', receivedAt: '2026-09-29T00:00:00Z', hasAttachments: true, removed: false },
      { externalId: 'm2', receivedAt: '2026-09-29T00:00:00Z', hasAttachments: true, removed: false },
    ], continuation: 'opaque', complete: true }),
    reconcileMessages: vi.fn(), listAttachments: vi.fn().mockResolvedValue([]),
  }
  const lease = { integrationId: 'integration', token: 'token', revision: 2, cursor: null }
  const repository: DiscoveryRepository = { commitPage: vi.fn().mockResolvedValue({ ...lease, revision: 3, cursor: 'opaque' }) }
  return { adapter, repository, lease, mode: 'DELTA' as const, startAt: '2026-09-29T00:00:00Z' }
}

describe('durable discovery', () => {
  it('commits the entire page and checkpoint only after every attachment listing', async () => {
    const input = fixture()
    const events: string[] = []
    vi.mocked(input.adapter.listAttachments).mockImplementation(async id => { events.push(id); return [] })
    vi.mocked(input.repository.commitPage).mockImplementation(async lease => { events.push('commit'); return lease })
    await discoverPage(input)
    expect(events).toEqual(['m1', 'm2', 'commit'])
    expect(input.repository.commitPage).toHaveBeenCalledOnce()
  })
  it('does not advance after partial download/list failure', async () => {
    const input = fixture()
    vi.mocked(input.adapter.listAttachments).mockRejectedValueOnce(new Error('transient'))
    await expect(discoverPage(input)).rejects.toThrow('transient')
    expect(input.repository.commitPage).not.toHaveBeenCalled()
    expect(input.lease.cursor).toBeNull()
  })
  it('preserves caller checkpoint if the database commit fails', async () => {
    const input = fixture()
    vi.mocked(input.repository.commitPage).mockRejectedValue(new Error('transaction rollback'))
    await expect(discoverPage(input)).rejects.toThrow('transaction rollback')
    expect(input.lease).toMatchObject({ revision: 2, cursor: null })
  })
  it('uses an independent reconciliation cursor', async () => {
    const input = fixture()
    vi.mocked(input.adapter.reconcileMessages).mockResolvedValue({ messages: [], complete: true, continuation: '' })
    await discoverPage({ ...input, mode: 'RECONCILIATION' })
    expect(input.adapter.syncMessages).not.toHaveBeenCalled()
    expect(input.adapter.reconcileMessages).toHaveBeenCalledWith(null, input.startAt)
  })
})
