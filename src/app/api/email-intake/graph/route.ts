import { handleGraphWebhook } from '@/lib/email-intake/webhook.server'
import { createWebhookRepository } from '@/lib/email-intake/automation/repository.server'
import { automationEnabled } from '@/lib/email-intake/automation/environment.server'

export const runtime = 'nodejs'
export const maxDuration = 10

export async function POST(request: Request) {
  if (!automationEnabled()) return new Response(null, { status: 404 })
  const receivedAt = Date.now(), timing = { persistedAt: null as number | null }
  const response = await handleGraphWebhook(request, createWebhookRepository(request, timing))
  const responseAt = Date.now()
  console.info('email_webhook_timing', { receivedAt, persistedAt: timing.persistedAt, responseAt,
    durationMs: responseAt - receivedAt, status: response.status })
  return response
}
