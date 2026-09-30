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
