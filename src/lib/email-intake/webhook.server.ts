import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { readBoundedBody } from './providers/graph-http.server'

const notificationSchema = z.object({
  subscriptionId: z.string().min(1).max(256), clientState: z.string().max(128),
  tenantId: z.uuid(), resource: z.string().min(1).max(4096).optional(),
  lifecycleEvent: z.enum(['missed', 'subscriptionRemoved', 'reauthorizationRequired']).optional(),
  changeType: z.enum(['created', 'updated', 'deleted']).optional(),
  id: z.string().max(512).optional(),
  subscriptionExpirationDateTime: z.iso.datetime({ offset: true }).optional(),
})
const bodySchema = z.object({ value: z.array(notificationSchema).min(1).max(100) })
export type NotificationBinding = {
  integrationId: string; tenantId: string; clientState: string
  /** Resource path uses the mailbox object ID returned by Graph, not its address. */
  resourcePrefix: string; subscriptionResource?: string; enabled: boolean
}
export interface WebhookRepository {
  acceptRequest?(): Promise<boolean>
  findBindings(subscriptionIds: string[]): Promise<Map<string, NotificationBinding>>
  /** Durable, coalescing wake-up. Returns only after commit. Must not run a parser. */
  enqueue(input: { integrationId: string; dedupeKey: string; kind: 'DELTA' | 'RENEW' | 'RECREATE' }[]): Promise<void>
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Graph uses both slash and OData selector paths, with case-insensitive labels. */
export function matchesNotificationResource(resource: string, prefix: string): boolean {
  function parts(value: string): string[] | null {
    if (value.includes('?') || value.includes('#') || value.includes('://')) return null
    try {
      return value.replace(/^\//, '').split('/').flatMap(raw => {
        const segment = decodeURIComponent(raw)
        const match = /^(users|messages)\('((?:[^']|'')+)'\)$/i.exec(segment)
        return match ? [match[1], match[2].replaceAll("''", "'")] : [segment]
      })
    } catch { return null }
  }
  const actual = parts(resource), expected = parts(prefix)
  return Boolean(actual && expected && expected.length === 3 && actual.length === 4
    && actual[0].toLowerCase() === 'users' && actual[2].toLowerCase() === 'messages'
    && expected[0].toLowerCase() === 'users' && expected[2].toLowerCase() === 'messages'
    && actual[1].toLowerCase() === expected[1].toLowerCase() && actual[3].length > 0)
}

/** Lifecycle payloads may omit resource; when present it must identify this subscription. */
export function matchesLifecycleResource(resource: string, expected: string): boolean {
  const normalize = (value: string): string[] | null => {
    if (/[?#]/.test(value) || value.includes('://')) return null
    try {
      return value.replace(/^\//, '').split('/').flatMap(segment => {
        const decoded = decodeURIComponent(segment)
        const match = /^(users|mailFolders)\('((?:[^']|'')+)'\)$/i.exec(decoded)
        return match ? [match[1], match[2].replaceAll("''", "'")] : [decoded]
      })
    } catch { return null }
  }
  const actual = normalize(resource), target = normalize(expected)
  return Boolean(actual && target && target.length === 5 && actual.length === 5
    && actual[0].toLowerCase() === 'users' && target[0].toLowerCase() === 'users'
    && actual[1].toLowerCase() === target[1].toLowerCase()
    && actual[2].toLowerCase() === 'mailfolders' && target[2].toLowerCase() === 'mailfolders'
    && actual[3] === target[3]
    && actual[4].toLowerCase() === 'messages' && target[4].toLowerCase() === 'messages')
}

export async function handleGraphWebhook(request: Request, repository: WebhookRepository): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  const token = new URL(request.url).searchParams.get('validationToken')
  if (token !== null) {
    if (!token || token.length > 4096) return new Response(null, { status: 400 })
    return new Response(token, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return new Response(null, { status: 415 })
  let body: z.infer<typeof bodySchema>
  try {
    if (repository.acceptRequest && !await repository.acceptRequest()) {
      return new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
    }
  } catch { return new Response(null, { status: 503 }) }
  try {
    const bytes = await readBoundedBody(new Response(request.body, { headers: request.headers }), 256 * 1024)
    const parsed = bodySchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
    if (!parsed.success) return new Response(null, { status: 400 })
    body = parsed.data
  } catch { return new Response(null, { status: 400 }) }
  try {
    const bindings = await repository.findBindings([...new Set(body.value.map(row => row.subscriptionId))])
    const jobs = []
    for (const notification of body.value) {
      const binding = bindings.get(notification.subscriptionId)
      if (!binding?.enabled || !equal(notification.clientState, binding.clientState)
        || notification.tenantId.toLowerCase() !== binding.tenantId.toLowerCase()) continue
      if (notification.lifecycleEvent && notification.changeType) continue
      if (notification.lifecycleEvent && notification.resource
        && (!binding.subscriptionResource || !matchesLifecycleResource(notification.resource, binding.subscriptionResource))) continue
      if (!notification.lifecycleEvent && (!notification.resource || !notification.changeType
        || !matchesNotificationResource(notification.resource, binding.resourcePrefix))) continue
      const kind = notification.lifecycleEvent === 'subscriptionRemoved' ? 'RECREATE' as const
        : notification.lifecycleEvent === 'reauthorizationRequired' ? 'RENEW' as const : 'DELTA' as const
      const dedupeKey = createHash('sha256').update(JSON.stringify([notification.subscriptionId, kind,
        notification.resource ?? '', notification.changeType ?? '', notification.id ?? '',
        notification.subscriptionExpirationDateTime ?? '',
        notification.lifecycleEvent && !notification.id && !notification.subscriptionExpirationDateTime
          ? Math.floor(Date.now() / 300_000) : 0])).digest('hex')
      jobs.push({ integrationId: binding.integrationId, dedupeKey, kind })
    }
    if (jobs.length) await repository.enqueue(jobs)
    // Same acknowledgement for valid/invalid bindings prevents credential probing.
    return new Response(null, { status: 202 })
  } catch { return new Response(null, { status: 503 }) }
}
