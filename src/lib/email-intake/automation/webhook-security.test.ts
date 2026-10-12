import { describe, expect, it, vi } from 'vitest'
import { handleGraphWebhook, matchesNotificationResource, type WebhookRepository } from '../webhook.server'

const tenant = '11111111-1111-4111-8111-111111111111'
const notification = { subscriptionId: 's', tenantId: tenant, clientState: 'secret-state', changeType: 'created',
  resource: "Users('11111111-1111-4111-8111-111111111111')/messages('opaque-id')" }
const request = (value: unknown, contentType = 'application/json') => new Request('https://qa.example.test/webhook',
  { method: 'POST', headers: { 'content-type': contentType }, body: JSON.stringify({ value }) })
function repository(): WebhookRepository {
  return { acceptRequest: vi.fn().mockResolvedValue(true), findBindings: vi.fn().mockResolvedValue(new Map([['s', {
    enabled: true, integrationId: tenant, tenantId: tenant, clientState: 'secret-state', resourcePrefix: `Users/${tenant}/Messages`,
    subscriptionResource: `users/${tenant}/mailFolders/inbox/messages`,
  }]])), enqueue: vi.fn().mockResolvedValue(undefined) }
}
describe('public webhook boundary', () => {
  it('accepts lifecycle signals with omitted or matching resource and ignores foreign resources', async () => {
    for (const resource of [undefined, `users/${tenant}/mailFolders/inbox/messages`, `users('${tenant}')/mailFolders('inbox')/messages`]) {
      const repo = repository()
      await handleGraphWebhook(request([{ subscriptionId: 's', tenantId: tenant, clientState: 'secret-state', lifecycleEvent: 'missed', resource }]), repo)
      expect(repo.enqueue).toHaveBeenCalledOnce()
    }
    for (const resource of ['users/foreign/mailFolders/inbox/messages', `users/${tenant}/mailFolders/other/messages`]) {
      const repo = repository()
      await handleGraphWebhook(request([{ subscriptionId: 's', tenantId: tenant, clientState: 'secret-state', lifecycleEvent: 'missed', resource }]), repo)
      expect(repo.enqueue).not.toHaveBeenCalled()
    }
  })
  it('accepts the official OData resource format and ignores cross-mailbox or malformed resources', async () => {
    const repo = repository()
    expect((await handleGraphWebhook(request([notification]), repo)).status).toBe(202)
    expect(repo.enqueue).toHaveBeenCalledOnce()
    for (const resource of ['Users/other/Messages/a', `Users/${tenant}/Messages/a/extra`, `https://graph.microsoft.com/Users/${tenant}/Messages/a`, `Users/${tenant}/Messages/%`, `Users/${tenant}/Messages/a?spoof=1`]) {
      expect(matchesNotificationResource(resource, `Users/${tenant}/Messages`)).toBe(false)
    }
  })
  it('rejects a wrong HTTP method even for a validation challenge', async () => {
    const repo = repository()
    expect((await handleGraphWebhook(new Request('https://qa.test?validationToken=abc'), repo)).status).toBe(405)
    expect(repo.acceptRequest).not.toHaveBeenCalled()
  })
  it('handshake does not depend on the database and never interprets token contents', async () => {
    const repo = repository(); vi.mocked(repo.acceptRequest!).mockRejectedValue(new Error('unavailable'))
    const response = await handleGraphWebhook(new Request('https://qa.test?validationToken=%3Cscript%3Ex%3C%2Fscript%3E', { method: 'POST' }), repo)
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/plain')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(repo.acceptRequest).not.toHaveBeenCalled()
  })
  it('rate limit delays delivery instead of acknowledging a lost signal', async () => {
    const repo = repository(); vi.mocked(repo.acceptRequest!).mockResolvedValue(false)
    const response = await handleGraphWebhook(request([notification]), repo)
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('60')
    expect(repo.findBindings).not.toHaveBeenCalled()
  })
  it('unavailable rate-limit store returns 503 for Graph retry', async () => {
    const repo = repository(); vi.mocked(repo.acceptRequest!).mockRejectedValue(new Error('database unavailable'))
    expect((await handleGraphWebhook(request([notification]), repo)).status).toBe(503)
  })
  it('rejects misleading media types and contradictory lifecycle payloads', async () => {
    const repo = repository()
    expect((await handleGraphWebhook(request([notification], 'application/jsonp'), repo)).status).toBe(415)
    await handleGraphWebhook(request([{ ...notification, lifecycleEvent: 'missed' }]), repo)
    expect(repo.enqueue).not.toHaveBeenCalled()
  })
})
