import 'server-only'
import { z } from 'zod'
import type { DiscoveryPage, EmailMessage, EmailProviderAdapter, SubscriptionInput } from '../contracts'
import { IntakeError } from '../contracts'
import { MAX_ATTACHMENT_BYTES } from '../policy'
import { GraphHttpClient, readBoundedBody, validateGraphUrl } from './graph-http.server'

const id = z.string().min(1).max(2048)
const messageSchema = z.object({
  id, receivedDateTime: z.iso.datetime({ offset: true }).optional(),
  hasAttachments: z.boolean().optional(), '@removed': z.object({ reason: z.string() }).optional(),
})
const pageSchema = z.object({ value: z.array(messageSchema).max(1000),
  '@odata.nextLink': z.string().optional(), '@odata.deltaLink': z.string().optional() })
const attachmentPageSchema = z.object({
  value: z.array(z.object({ id, name: z.string().max(1024), contentType: z.string().max(256),
    size: z.number().int().nonnegative(), isInline: z.boolean(), '@odata.type': z.string() })).max(1000),
  '@odata.nextLink': z.string().optional(),
})
const subscriptionSchema = z.object({ id, expirationDateTime: z.iso.datetime({ offset: true }) })

function message(row: z.infer<typeof messageSchema>): EmailMessage {
  if (!row['@removed'] && (!row.receivedDateTime || row.hasAttachments === undefined)) {
    throw new IntakeError('INVALID_RESPONSE')
  }
  return { externalId: row.id, receivedAt: row.receivedDateTime ?? '',
    hasAttachments: row.hasAttachments ?? false, removed: Boolean(row['@removed']) }
}

export class OutlookGraphAdapter implements EmailProviderAdapter {
  private readonly mailboxPath: string
  private readonly folderPath: string
  constructor(private readonly http: GraphHttpClient, mailbox: string, folder = 'inbox', private readonly now = Date.now) {
    if (!z.email().safeParse(mailbox).success || !id.safeParse(folder).success) throw new IntakeError('CONFIGURATION')
    this.mailboxPath = `/v1.0/users/${encodeURIComponent(mailbox)}`
    this.folderPath = `${this.mailboxPath}/mailFolders/${encodeURIComponent(folder)}/messages`
  }

  normalizeExternalIdentity(externalId: string): string {
    if (!id.safeParse(externalId).success || externalId.trim() !== externalId) throw new IntakeError('INVALID_RESPONSE')
    // Immutable IDs are case-sensitive opaque strings, never lowercased or decoded.
    return externalId
  }

  async testConnection(): Promise<void> {
    await this.http.json(`${this.folderPath}?$top=1&$select=id,receivedDateTime,hasAttachments`, pageSchema)
  }

  async createOrRenewSubscription(input: SubscriptionInput) {
    const expiresAt = new Date(this.now() + 6 * 24 * 60 * 60 * 1000).toISOString()
    if (input.externalId) {
      const result = await this.http.json(`/v1.0/subscriptions/${encodeURIComponent(this.normalizeExternalIdentity(input.externalId))}`,
        subscriptionSchema, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expirationDateTime: expiresAt }) })
      return { externalId: result.id, expiresAt: result.expirationDateTime }
    }
    for (const raw of [input.notificationUrl, input.lifecycleNotificationUrl]) {
      let url: URL
      try { url = new URL(raw) } catch { throw new IntakeError('CONFIGURATION') }
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new IntakeError('CONFIGURATION')
    }
    if (input.clientState.length < 32 || input.clientState.length > 128) throw new IntakeError('CONFIGURATION')
    const result = await this.http.json('/v1.0/subscriptions', subscriptionSchema, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changeType: 'created', notificationUrl: input.notificationUrl,
        lifecycleNotificationUrl: input.lifecycleNotificationUrl, resource: this.subscriptionResource(input),
        expirationDateTime: expiresAt, clientState: input.clientState, includeResourceData: false }),
    })
    return { externalId: result.id, expiresAt: result.expirationDateTime }
  }

  private subscriptionResource(input: SubscriptionInput): string {
    if (!input.resource) return this.folderPath.replace('/v1.0/', '')
    const match = /^users\/([a-f0-9-]{36})\/mailFolders\/([^/]+)\/messages$/i.exec(input.resource)
    if (!match || !z.uuid().safeParse(match[1]).success) throw new IntakeError('CONFIGURATION')
    return input.resource
  }

  /** Adopt only our exact subscription after a create succeeded remotely but persistence failed. */
  async findSubscription(input: SubscriptionInput) {
    const schema = z.object({ value: z.array(subscriptionSchema.extend({
      resource: z.string(), notificationUrl: z.string(), lifecycleNotificationUrl: z.string().optional(), clientState: z.string().nullable().optional(),
    })), '@odata.nextLink': z.string().optional() })
    let next: string | undefined = '/v1.0/subscriptions'
    const matches = []
    const seen = new Set<string>()
    while (next) {
      if (seen.has(next) || seen.size >= 20) throw new IntakeError('INVALID_RESPONSE')
      seen.add(next)
      const page: z.infer<typeof schema> = await this.http.json(next, schema)
      matches.push(...page.value.filter(s => s.resource === this.subscriptionResource(input)
        && s.notificationUrl === input.notificationUrl && s.lifecycleNotificationUrl === input.lifecycleNotificationUrl
        && s.clientState === input.clientState && Date.parse(s.expirationDateTime) > this.now()))
      next = page['@odata.nextLink']
      if (next) validateGraphUrl(next, '/v1.0/subscriptions')
    }
    if (matches.length > 1) throw new IntakeError('CONFIGURATION')
    return matches[0] ? { externalId: matches[0].id, expiresAt: matches[0].expirationDateTime } : null
  }

  async deleteSubscription(externalId: string): Promise<void> {
    const response = await this.http.request(`/v1.0/subscriptions/${encodeURIComponent(this.normalizeExternalIdentity(externalId))}`, { method: 'DELETE' })
    await response.body?.cancel()
  }

  async syncMessages(cursor: string | null, startAt: string): Promise<DiscoveryPage> {
    const path = `${this.folderPath}/delta`
    const url = cursor ? validateGraphUrl(cursor, path).href : this.initialUrl(path, startAt)
    const page = await this.http.json(url, pageSchema)
    const continuation = page['@odata.nextLink'] ?? page['@odata.deltaLink']
    if (!continuation || (page['@odata.nextLink'] && page['@odata.deltaLink'])) throw new IntakeError('INVALID_RESPONSE')
    validateGraphUrl(continuation, path)
    return { messages: page.value.map(message), continuation, complete: !page['@odata.nextLink'] }
  }

  async reconcileMessages(cursor: string | null, since: string): Promise<DiscoveryPage> {
    const url = cursor ? validateGraphUrl(cursor, this.folderPath).href : this.initialUrl(this.folderPath, since)
    const page = await this.http.json(url, pageSchema)
    const next = page['@odata.nextLink']
    if (next) validateGraphUrl(next, this.folderPath)
    return { messages: page.value.map(message), continuation: next ?? '', complete: !next }
  }

  private initialUrl(path: string, since: string): string {
    if (!z.iso.datetime({ offset: true }).safeParse(since).success) throw new IntakeError('CONFIGURATION')
    const query = new URLSearchParams({ '$select': 'id,receivedDateTime,hasAttachments',
      '$filter': `receivedDateTime ge ${since}`, '$top': '100' })
    return `${path}?${query}`
  }

  async getMessage(externalId: string): Promise<EmailMessage> {
    return message(await this.http.json(`${this.messagePath(externalId)}?$select=id,receivedDateTime,hasAttachments`, messageSchema))
  }

  private messagePath(externalId: string): string {
    return `${this.mailboxPath}/messages/${encodeURIComponent(this.normalizeExternalIdentity(externalId))}`
  }

  async listAttachments(externalId: string) {
    const path = `${this.messagePath(externalId)}/attachments`
    let url: string | undefined = `${path}?$select=id,name,contentType,size,isInline&$top=100`
    const attachments = []
    const seen = new Set<string>()
    while (url) {
      if (seen.has(url) || seen.size >= 20) throw new IntakeError('INVALID_RESPONSE')
      seen.add(url)
      const page: z.infer<typeof attachmentPageSchema> = await this.http.json(url, attachmentPageSchema)
      attachments.push(...page.value.map(row => ({ externalId: row.id, name: row.name,
        contentType: row.contentType, size: row.size, inline: row.isInline,
        kind: row['@odata.type'] === '#microsoft.graph.fileAttachment' ? 'FILE' as const : 'UNSUPPORTED' as const })))
      url = page['@odata.nextLink']
      if (url) validateGraphUrl(url, path)
    }
    return attachments
  }

  async downloadAttachment(messageId: string, attachmentId: string): Promise<Uint8Array> {
    const response = await this.http.request(`${this.messagePath(messageId)}/attachments/${encodeURIComponent(this.normalizeExternalIdentity(attachmentId))}/$value`)
    return readBoundedBody(response, MAX_ATTACHMENT_BYTES)
  }
}
