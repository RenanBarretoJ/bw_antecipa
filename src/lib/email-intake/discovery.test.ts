import { describe, expect, it, vi } from 'vitest'
import { discoverPage, type DiscoveryRepository } from './discovery'
import type { EmailMessage, EmailProviderAdapter } from './contracts'

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
  const repository: DiscoveryRepository = { findKnownMessages: vi.fn().mockResolvedValue([]), commitPage: vi.fn().mockResolvedValue({ ...lease, revision: 3, cursor: 'opaque' }) }
  return { adapter, repository, lease, mode: 'DELTA' as const, startAt: '2026-09-29T00:00:00Z' }
}

describe('durable discovery', () => {
  const at = '2026-10-01T16:33:55.572Z'
  const row = (externalId: string, receivedAt = at, removed = false): EmailMessage => ({ externalId, receivedAt, removed, hasAttachments: true })
  it('advances an all-old page with zero attachment calls or processable metadata', async () => {
    const input = { ...fixture(), startAt: at }
    vi.mocked(input.adapter.syncMessages).mockResolvedValue({ messages: Array.from({ length: 10 }, (_, i) => row(`old-${i}`, '2026-09-30T00:00:00Z')), continuation: 'next', complete: false })
    const result = await discoverPage(input)
    expect(result).toMatchObject({ complete: false, discovered: 0, metrics: { oldMessagesSkipped: 10, attachmentsListed: 0 } })
    expect(input.adapter.listAttachments).not.toHaveBeenCalled()
    expect(input.adapter.downloadAttachment).not.toHaveBeenCalled()
    expect(input.repository.commitPage).toHaveBeenCalledWith(input.lease, [], expect.objectContaining({ continuation: 'next' }))
  })
  it('admits boundary/new rows, applies a known tombstone and skips an unknown tombstone', async () => {
    const input = { ...fixture(), startAt: at }
    vi.mocked(input.repository.findKnownMessages).mockResolvedValue([{ externalId: 'known', receivedAt: at }])
    vi.mocked(input.adapter.syncMessages).mockResolvedValue({ messages: [row('old', '2026-10-01T16:33:55.571Z'), row('equal'), row('new', '2026-10-01T16:33:55.573Z'), row('known', '', true), row('unknown', '', true)], continuation: 'delta', complete: true })
    const result = await discoverPage(input)
    expect(result.metrics).toMatchObject({ oldMessagesSkipped: 1, newMessagesAdmitted: 2, tombstonesApplied: 1, unknownTombstones: 1, attachmentsListed: 2 })
    expect(vi.mocked(input.adapter.listAttachments).mock.calls).toEqual([['equal'], ['new']])
    expect(vi.mocked(input.repository.commitPage).mock.calls[0][1].map(m => [m.externalId, m.removed])).toEqual([['equal', false], ['new', false], ['known', true]])
  })
  it.each(['DELTA', 'RECONCILIATION'] as const)('fails closed per invalid timestamp in %s and advances safely', async mode => {
    const input = { ...fixture(), startAt: at, mode }
    const provider = mode === 'DELTA' ? input.adapter.syncMessages : input.adapter.reconcileMessages
    vi.mocked(provider).mockResolvedValue({ messages: [row('absent', ''), row('bad', 'invalid'), row('new')], continuation: 'cursor', complete: true })
    const result = await discoverPage(input)
    expect(result.metrics.invalidTimestamps).toBe(2)
    expect(vi.mocked(input.adapter.listAttachments).mock.calls).toEqual([['new']])
    expect(result.lease.revision).toBe(3)
  })
  it('reconciliation uses integration admission boundary independently from its rolling query window', async () => {
    const input = { ...fixture(), mode: 'RECONCILIATION' as const, startAt: '2026-09-01T00:00:00Z', querySince: at }
    vi.mocked(input.repository.findKnownMessages).mockResolvedValue([{ externalId: 'known', receivedAt: '2026-08-01T00:00:00Z' }])
    vi.mocked(input.adapter.reconcileMessages).mockResolvedValue({ messages: [row('old', '2026-08-31T00:00:00Z'), row('missing', '2026-09-02T00:00:00Z'), row('known', '')], continuation: '', complete: true })
    const result = await discoverPage(input)
    expect(input.adapter.reconcileMessages).toHaveBeenCalledWith(null, at)
    expect(result.metrics).toMatchObject({ oldMessagesSkipped: 1, newMessagesAdmitted: 1, existingMessages: 1 })
    expect(vi.mocked(input.adapter.listAttachments).mock.calls).toEqual([['missing'], ['known']])
  })
  it('resumes from durable pages and completes only at the final delta link', async () => {
    const input = { ...fixture(), startAt: at }
    vi.mocked(input.adapter.syncMessages)
      .mockResolvedValueOnce({ messages: [row('old', '2026-09-30T00:00:00Z')], continuation: 'next-1', complete: false })
      .mockResolvedValueOnce({ messages: [row('old2', '2026-09-30T00:00:00Z'), row('equal')], continuation: 'next-2', complete: false })
      .mockResolvedValueOnce({ messages: [row('new', '2026-10-02T00:00:00Z')], continuation: 'delta', complete: true })
    vi.mocked(input.repository.commitPage).mockImplementation(async (lease, _rows, page) => ({ ...lease, cursor: page.continuation, revision: lease.revision + 1 }))
    const first = await discoverPage(input)
    expect(first.complete).toBe(false)
    const resumed = await discoverPage({ ...input, lease: first.lease })
    expect(resumed.complete).toBe(false)
    const final = await discoverPage({ ...input, lease: resumed.lease })
    expect(final.complete).toBe(true)
    expect(final.lease).toMatchObject({ cursor: 'delta', revision: 5 })
    expect(vi.mocked(input.adapter.syncMessages).mock.calls.map(args => args[0])).toEqual([null, 'next-1', 'next-2'])
  })
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
