import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { readBoundedBody } from './providers/graph-http.server'

const notificationSchema = z.object({
  subscriptionId: z.string().min(1).max(256), clientState: z.string().max(128),
  tenantId: z.uuid(), resource: z.string().min(1).max(4096).optional(),
  lifecycleEvent: z.enum(['missed', 'subscriptionRemoved', 'reauthorizationRequired']).optional(),
  changeType: z.enum(['created', 'updated', 'deleted']).optional(),
})
const bodySchema = z.object({ value: z.array(notificationSchema).min(1).max(100) })
export type NotificationBinding = {
  integrationId: string; tenantId: string; clientState: string
  /** Resource path uses the mailbox object ID returned by Graph, not its address. */
  resourcePrefix: string; enabled: boolean
}
export interface WebhookRepository {
  findBindings(subscriptionIds: string[]): Promise<Map<string, NotificationBinding>>
  /** Durable, coalescing wake-up. Returns only after commit. Must not run a parser. */
  enqueue(input: { integrationId: string; dedupeKey: string; kind: 'DELTA' | 'RENEW' | 'RECREATE' }[]): Promise<void>
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function handleGraphWebhook(request: Request, repository: WebhookRepository): Promise<Response> {
  const token = new URL(request.url).searchParams.get('validationToken')
  if (token !== null) {
    if (!token || token.length > 4096) return new Response(null, { status: 400 })
    return new Response(token, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return new Response(null, { status: 415 })
  let body: z.infer<typeof bodySchema>
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
      if (!notification.lifecycleEvent && (!notification.resource
        || !notification.resource.startsWith(`${binding.resourcePrefix}/`))) continue
      const kind = notification.lifecycleEvent === 'subscriptionRemoved' ? 'RECREATE' as const
        : notification.lifecycleEvent === 'reauthorizationRequired' ? 'RENEW' as const : 'DELTA' as const
      const dedupeKey = createHash('sha256').update(JSON.stringify([notification.subscriptionId, kind,
        notification.resource ?? '', notification.changeType ?? ''])).digest('hex')
      jobs.push({ integrationId: binding.integrationId, dedupeKey, kind })
    }
    if (jobs.length) await repository.enqueue(jobs)
    // Same acknowledgement for valid/invalid bindings prevents credential probing.
    return new Response(null, { status: 202 })
  } catch { return new Response(null, { status: 503 }) }
}
