import { describe, expect, it, vi } from 'vitest'
import { handleGraphWebhook, type WebhookRepository } from './webhook.server'

const tenantId = '11111111-1111-4111-8111-111111111111'
const state = 'x'.repeat(48)
const notification = { subscriptionId: 'sub', tenantId, clientState: state,
  changeType: 'created', resource: 'Users/mailbox-id/Messages/message-id' }
function repository(): WebhookRepository {
  return { findBindings: vi.fn().mockResolvedValue(new Map([['sub', { integrationId: 'integration', tenantId,
    clientState: state, enabled: true, resourcePrefix: 'Users/mailbox-id/Messages' }]])), enqueue: vi.fn().mockResolvedValue(undefined) }
}
function request(value: unknown) {
  return new Request('https://qa.example.test/api/email-intake/graph', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) })
}
describe('Graph notifications', () => {
  it('answers the validation challenge as plaintext without database access', async () => {
    const repo = repository()
    const result = await handleGraphWebhook(new Request('https://qa.example.test/api?validationToken=abc%2B123', { method: 'POST' }), repo)
    expect(await result.text()).toBe('abc+123')
    expect(result.headers.get('Content-Type')).toContain('text/plain')
    expect(repo.findBindings).not.toHaveBeenCalled()
  })
  it('durably enqueues a notification before acknowledgement', async () => {
    const repo = repository()
    expect((await handleGraphWebhook(request([notification]), repo)).status).toBe(202)
    expect(repo.enqueue).toHaveBeenCalledWith([expect.objectContaining({ integrationId: 'integration', kind: 'DELTA' })])
  })
  it.each([{ clientState: 'wrong' }, { tenantId: '22222222-2222-4222-8222-222222222222' },
    { resource: 'Users/other/Messages/message' }, { subscriptionId: 'other' }])('ignores invalid binding %j', async patch => {
    const repo = repository()
    expect((await handleGraphWebhook(request([{ ...notification, ...patch }]), repo)).status).toBe(202)
    expect(repo.enqueue).not.toHaveBeenCalled()
  })
  it('returns a retriable status when the durable enqueue fails', async () => {
    const repo = repository()
    vi.mocked(repo.enqueue).mockRejectedValue(new Error('database unavailable'))
    expect((await handleGraphWebhook(request([notification]), repo)).status).toBe(503)
  })
  it.each([['missed', 'DELTA'], ['subscriptionRemoved', 'RECREATE'], ['reauthorizationRequired', 'RENEW']])('queues %s lifecycle recovery', async (event, kind) => {
    const repo = repository()
    await handleGraphWebhook(request([{ subscriptionId: 'sub', tenantId, clientState: state, lifecycleEvent: event }]), repo)
    expect(repo.enqueue).toHaveBeenCalledWith([expect.objectContaining({ kind })])
  })
  it('rejects oversized and malformed input without database access', async () => {
    const repo = repository()
    expect((await handleGraphWebhook(request('x'.repeat(270000)), repo)).status).toBe(400)
    expect(repo.findBindings).not.toHaveBeenCalled()
  })
})
