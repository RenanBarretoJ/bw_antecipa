import { describe, expect, it, vi } from 'vitest'
import { GraphHttpClient, readBoundedBody, validateGraphUrl } from './graph-http.server'
import { OutlookGraphAdapter } from './outlook-graph.server'

const credentials = { tenantId: '11111111-1111-4111-8111-111111111111', clientId: '22222222-2222-4222-8222-222222222222', clientSecret: 'test-only-secret' }
const mailbox = 'qa@example.test'
const path = '/v1.0/users/qa%40example.test/mailFolders/inbox/messages/delta'
function setup(responses: Response[]) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: 'test-token', expires_in: 3600 }))
  for (const response of responses) fetcher.mockResolvedValueOnce(response)
  const http = new GraphHttpClient(credentials, { fetch: fetcher })
  return { fetcher, http, adapter: new OutlookGraphAdapter(http, mailbox) }
}

describe('Graph transport', () => {
  it('retains page progress when a row needs per-message timestamp rejection', async () => {
    const { adapter } = setup([Response.json({ value: [
      { id: 'missing', hasAttachments: true }, { id: 'invalid', receivedDateTime: 'bad', hasAttachments: true },
      { id: 'null', receivedDateTime: null, hasAttachments: true }, { id: 'removed', '@removed': { reason: 'deleted' } },
    ], '@odata.nextLink': `https://graph.microsoft.com${path}?$skiptoken=next` })])
    expect(await adapter.syncMessages(null, '2026-10-01T00:00:00Z')).toMatchObject({ complete: false, messages: [
      { externalId: 'missing', receivedAt: '' }, { externalId: 'invalid', receivedAt: 'bad' },
      { externalId: 'null', receivedAt: '' }, { externalId: 'removed', removed: true },
    ] })
  })
  it('uses app credentials and immutable IDs without fetching message bodies', async () => {
    const { adapter, fetcher } = setup([Response.json({ value: [], '@odata.deltaLink': `https://graph.microsoft.com${path}?$deltatoken=opaque` })])
    const page = await adapter.syncMessages(null, '2026-09-29T00:00:00Z')
    expect(page.complete).toBe(true)
    const auth = fetcher.mock.calls[0][1]
    expect(String(auth?.body)).toContain('grant_type=client_credentials')
    const [url, init] = fetcher.mock.calls[1]
    expect(String(url)).not.toContain('bodyPreview')
    expect(new Headers(init?.headers).get('Prefer')).toBe('IdType="ImmutableId"')
    expect(init?.redirect).toBe('error')
  })
  it('shares an in-flight token request and caches it only inside the client', async () => {
    const { adapter, fetcher } = setup([Response.json({ value: [] }), Response.json({ value: [] })])
    await Promise.all([adapter.testConnection(), adapter.testConnection()])
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it.each(['https://evil.test/v1.0/users/u', 'https://graph.microsoft.com.evil.test/v1.0/users/u',
    'https://user:pass@graph.microsoft.com/v1.0/users/u', 'http://graph.microsoft.com/v1.0/users/u'])('rejects untrusted cursor %s', url => {
    expect(() => validateGraphUrl(url)).toThrow('INVALID_CURSOR')
  })
  it('rejects cursors for another mailbox before sending any credentials', async () => {
    const { adapter, fetcher } = setup([])
    await expect(adapter.syncMessages('https://graph.microsoft.com/v1.0/users/other/mailFolders/inbox/messages/delta', '2026-09-29T00:00:00Z')).rejects.toThrow('INVALID_CURSOR')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('follows Graph OData folder selectors without rewriting opaque cursors', async () => {
    const cursor = "https://graph.microsoft.com/v1.0/users/qa@example.test/mailFolders('inbox')/messages/delta?$skiptoken=opaque%2Bvalue"
    const final = "https://graph.microsoft.com/v1.0/users('qa%40example.test')/mailFolders('inbox')/messages/delta?$deltatoken=opaque"
    const { adapter, fetcher } = setup([
      Response.json({ value: [], '@odata.nextLink': cursor }),
      Response.json({ value: [], '@odata.deltaLink': final }),
    ])
    const first = await adapter.syncMessages(null, '2026-09-29T00:00:00Z')
    expect(first).toMatchObject({ complete: false, continuation: cursor })
    const last = await adapter.syncMessages(first.continuation, '2026-09-29T00:00:00Z')
    expect(last).toMatchObject({ complete: true, continuation: final })
    expect(String(fetcher.mock.calls[2][0])).toBe(cursor)
  })
  it.each([
    "users('other@example.test')/mailFolders('inbox')/messages/delta",
    "users('qa@example.test')/mailFolders('archive')/messages/delta",
    "users('qa@example.test')/mailFolders('inbox')/messages",
    "users('qa@example.test%2FmailFolders%2Finbox')/messages/delta",
    "users/qa%40example.test/mailFolders('%ZZ')/messages/delta",
  ])('rejects a different or malformed selector path %s before auth', async suffix => {
    const { adapter, fetcher } = setup([])
    await expect(adapter.syncMessages(`https://graph.microsoft.com/v1.0/${suffix}`, '2026-09-29T00:00:00Z')).rejects.toThrow('INVALID_CURSOR')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('returns durable retry metadata without raw provider error', async () => {
    const { adapter } = setup([new Response('secret body mailbox pii', { status: 429, headers: { 'Retry-After': '120' } })])
    await expect(adapter.testConnection()).rejects.toMatchObject({ code: 'THROTTLED', retryable: true, retryAfterMs: 120000, message: 'THROTTLED' })
  })
  it('bounds streamed bytes even without Content-Length', async () => {
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(8)); controller.close()
    } }))
    await expect(readBoundedBody(response, 10)).rejects.toThrow('FILE_TOO_LARGE')
  })
  it('rejects incomplete delta responses instead of resetting the cursor', async () => {
    const { adapter } = setup([Response.json({ value: [] })])
    await expect(adapter.syncMessages(null, '2026-09-29T00:00:00Z')).rejects.toThrow('INVALID_RESPONSE')
  })
  it('preserves case-sensitive external IDs', () => {
    const { adapter } = setup([])
    expect(adapter.normalizeExternalIdentity('AAAbBc==')).toBe('AAAbBc==')
  })
})
