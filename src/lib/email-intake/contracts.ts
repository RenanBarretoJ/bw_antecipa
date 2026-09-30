/** Transport contracts. No provider types or fiscal rules cross this boundary. */
export type EmailProvider = 'OUTLOOK_GRAPH' | 'IMAP'
export type RoutingMode = 'ALL_ACTIVE_CEDENTES' | 'ALLOWLIST'
export type EmailMessage = {
  externalId: string
  receivedAt: string
  hasAttachments: boolean
  removed: boolean
}
export type EmailAttachment = {
  externalId: string
  name: string
  contentType: string
  size: number
  inline: boolean
  kind: 'FILE' | 'UNSUPPORTED'
}
export type DiscoveryPage = {
  messages: EmailMessage[]
  /** Opaque, sensitive provider value. Encrypt at rest; never log. */
  continuation: string
  complete: boolean
}
export type Subscription = { externalId: string; expiresAt: string }
export type SubscriptionInput = {
  externalId?: string
  notificationUrl: string
  lifecycleNotificationUrl: string
  clientState: string
}
export interface EmailProviderAdapter {
  testConnection(): Promise<void>
  createOrRenewSubscription(input: SubscriptionInput): Promise<Subscription>
  syncMessages(cursor: string | null, startAt: string): Promise<DiscoveryPage>
  reconcileMessages(cursor: string | null, since: string): Promise<DiscoveryPage>
  getMessage(externalId: string): Promise<EmailMessage>
  listAttachments(externalId: string): Promise<EmailAttachment[]>
  downloadAttachment(messageId: string, attachmentId: string): Promise<Uint8Array>
  normalizeExternalIdentity(externalId: string): string
}
export type IntakeErrorCode =
  | 'CONFIGURATION' | 'AUTHENTICATION' | 'ACCESS_DENIED' | 'NOT_FOUND'
  | 'CURSOR_EXPIRED' | 'THROTTLED' | 'PROVIDER_UNAVAILABLE' | 'INVALID_RESPONSE'
  | 'INVALID_CURSOR' | 'UNSUPPORTED_FILE' | 'FILE_TOO_LARGE' | 'LEASE_LOST'
export class IntakeError extends Error {
  constructor(
    readonly code: IntakeErrorCode,
    readonly retryable = false,
    readonly retryAfterMs = 0,
  ) {
    // Never propagate Graph response text, tokens, URLs or attachment names.
    super(code)
    this.name = 'IntakeError'
  }
}
