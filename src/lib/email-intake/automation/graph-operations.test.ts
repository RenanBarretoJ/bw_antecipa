import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphHttpClient } from '../providers/graph-http.server'
import { OutlookGraphAdapter } from '../providers/outlook-graph.server'

const id = '11111111-1111-4111-8111-111111111111'
const credentials = { tenantId: id, clientId: id, clientSecret: 'qa-only' }
const token = () => Response.json({ access_token: 'qa-token', expires_in: 3600 })
afterEach(() => vi.useRealTimers())
describe('Graph operational lifecycle', () => {
  it.each([400, 404, 410])('recognizes expired delta at HTTP %i without propagating provider text', async status => {
    const fetcher = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json({ error: { code: 'syncStateNotFound', message: 'sensitive-marker' } }, { status }))
    const client = new GraphHttpClient(credentials, { fetch: fetcher })
    await expect(client.request('/v1.0/users/qa/mailFolders/inbox/messages/delta')).rejects.toMatchObject({ code: 'CURSOR_EXPIRED', message: 'CURSOR_EXPIRED' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('does not classify an ordinary message 404 as cursor expiry', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json({ error: { code: 'syncStateNotFound' } }, { status: 404 }))
    await expect(new GraphHttpClient(credentials, { fetch: fetcher }).request('/v1.0/users/qa/messages/missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('subscription create uses the verified mailbox object ID and six-day expiry', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-30T12:00:00Z')
    const fetcher = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json({ id: 'sub', expirationDateTime: '2026-10-06T12:00:00Z' }))
    const adapter = new OutlookGraphAdapter(new GraphHttpClient(credentials, { fetch: fetcher }), 'qa@example.invalid')
    await adapter.createOrRenewSubscription({ notificationUrl: 'https://qa.test/hook', lifecycleNotificationUrl: 'https://qa.test/hook', clientState: 's'.repeat(48), resource: `users/${id}/mailFolders/inbox/messages` })
    const sent = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(sent.resource).toBe(`users/${id}/mailFolders/inbox/messages`)
    expect(sent.expirationDateTime).toBe('2026-10-06T12:00:00.000Z')
    expect(sent.includeResourceData).toBe(false)
  })
  it('adopts only the exact matching callback, scope and secret', async () => {
    const input = { notificationUrl: 'https://qa.test/hook', lifecycleNotificationUrl: 'https://qa.test/hook', clientState: 's'.repeat(48), resource: `users/${id}/mailFolders/inbox/messages` }
    const matching = { id: 'ours', expirationDateTime: '2099-10-06T12:00:00Z', ...input }
    const fetcher = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json({ value: [matching, { ...matching, id: 'other', clientState: 'other-secret' }] }))
    const adapter = new OutlookGraphAdapter(new GraphHttpClient(credentials, { fetch: fetcher }), 'qa@example.invalid')
    expect(await adapter.findSubscription(input)).toEqual({ externalId: 'ours', expiresAt: matching.expirationDateTime })
  })
})
