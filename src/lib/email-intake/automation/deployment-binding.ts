import { z } from 'zod'

export const PRODUCTION_EMAIL_REF = 'wwsndnuvnjuabpbjwlck'
export const PRODUCTION_EMAIL_ORIGIN = 'https://bw-antecipa.better-with.tech'
type Environment = Readonly<Record<string, string | undefined>>
const scopeSchema = z.object({
  integrationId: z.uuid(), fundoId: z.uuid(), mailbox: z.email(), mailboxObjectId: z.uuid(),
  folderId: z.string().min(1), tenantId: z.uuid(),
}).strict()
export type ProductionEmailScope = z.infer<typeof scopeSchema>

export function isProductionEmailTarget(env: Environment): boolean {
  return env.VERCEL_ENV === 'production' || env.EMAIL_INTAKE_ENVIRONMENT === 'production'
    || env.EMAIL_INTAKE_EXPECTED_SUPABASE_REF === PRODUCTION_EMAIL_REF
    || env.NEXT_PUBLIC_SUPABASE_URL?.includes(PRODUCTION_EMAIL_REF) === true
}

/** Reviewed tuples, not independent lists: an integration cannot borrow another fund or mailbox. */
export function productionEmailScopes(env: Environment): ProductionEmailScope[] {
  try {
    const scopes = z.array(scopeSchema).min(1).max(20).parse(JSON.parse(env.EMAIL_INTAKE_PRODUCTION_SCOPES_JSON ?? ''))
    if (new Set(scopes.map(s => s.integrationId)).size !== scopes.length
      || new Set(scopes.map(s => s.mailboxObjectId.toLowerCase())).size !== scopes.length) return []
    return scopes
  } catch { return [] }
}

export function productionEmailBindingValid(env: Environment): boolean {
  return env.EMAIL_INTAKE_PRODUCTION_ENABLED === 'true'
    && env.VERCEL_ENV === 'production' && env.EMAIL_INTAKE_ENVIRONMENT === 'production'
    && env.EMAIL_INTAKE_EXPECTED_SUPABASE_REF === PRODUCTION_EMAIL_REF
    && env.NEXT_PUBLIC_SUPABASE_URL === `https://${PRODUCTION_EMAIL_REF}.supabase.co`
    && env.EMAIL_INTAKE_NOTIFICATION_ORIGIN === PRODUCTION_EMAIL_ORIGIN
    && productionEmailScopes(env).length > 0
}

export function productionEmailScopeAllowed(scope: {
  integrationId: string; fundoId: string; mailbox: string; folderId: string
}, env: Environment): boolean {
  if (!isProductionEmailTarget(env)) return true
  return productionEmailBindingValid(env) && productionEmailScopes(env).some(s =>
    s.integrationId === scope.integrationId && s.fundoId === scope.fundoId
    && s.mailbox.toLowerCase() === scope.mailbox.toLowerCase() && s.folderId === scope.folderId)
}

/** Scheduler uses the same deployment contract plus a strict direct/pooler database binding. */
export function schedulerBindingValid(env: Environment): boolean {
  try {
    const ref = env.EMAIL_INTAKE_EXPECTED_SUPABASE_REF ?? ''
    const db = new URL(env.EMAIL_INTAKE_DATABASE_URL ?? '')
    if (!/^[a-z]{20}$/.test(ref) || !['postgres:', 'postgresql:'].includes(db.protocol)
      || db.hash || db.pathname !== '/postgres') return false
    const direct = db.hostname === `db.${ref}.supabase.co` && decodeURIComponent(db.username) === 'postgres'
    const pooled = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(db.hostname)
      && decodeURIComponent(db.username) === `postgres.${ref}`
    if (!direct && !pooled) return false
    if (isProductionEmailTarget(env)) return env.EMAIL_INTAKE_AUTOMATION_ENABLED === 'true' && productionEmailBindingValid(env)
    return ['preview', 'homolog'].includes(env.EMAIL_INTAKE_ENVIRONMENT ?? '')
      && env.VERCEL_ENV !== 'production' && env.NEXT_PUBLIC_SUPABASE_URL === `https://${ref}.supabase.co`
  } catch { return false }
}
