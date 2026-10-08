import 'server-only'
import { timingSafeEqual } from 'node:crypto'

/** Explicit opt-in and exact database binding prevent copied cron configuration from running elsewhere. */
export function automationEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.EMAIL_INTAKE_AUTOMATION_ENABLED !== 'true' || env.VERCEL_ENV === 'production') return false
  // Release-04 is restricted to QA even if a copied env incorrectly labels the production database.
  if (env.EMAIL_INTAKE_EXPECTED_SUPABASE_REF === 'wwsndnuvnjuabpbjwlck') return false
  if (!['preview', 'homolog', 'local'].includes(env.EMAIL_INTAKE_ENVIRONMENT ?? '')) return false
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    return Boolean(env.EMAIL_INTAKE_EXPECTED_SUPABASE_REF && url.protocol === 'https:'
      && !url.username && !url.password
      && url.hostname === `${env.EMAIL_INTAKE_EXPECTED_SUPABASE_REF}.supabase.co`)
  } catch { return false }
}

export function authorizeAutomationJob(request: Request, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (!automationEnabled(env)) return false
  const secret = env.EMAIL_INTAKE_JOB_SECRET
  if (!secret || secret.length < 48) return false
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(request.headers.get('authorization') ?? '')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function notificationEndpoint(): string {
  const url = new URL(process.env.EMAIL_INTAKE_NOTIFICATION_ORIGIN ?? '')
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('EMAIL_NOTIFICATION_ORIGIN_INVALID')
  }
  return new URL('/api/email-intake/graph', url).href
}
