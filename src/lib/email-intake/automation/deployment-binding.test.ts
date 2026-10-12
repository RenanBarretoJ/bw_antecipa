import { describe, expect, it } from 'vitest'
import { automationEnabled } from './environment.server'
import { productionEmailScopeAllowed, schedulerBindingValid, PRODUCTION_EMAIL_REF, PRODUCTION_EMAIL_ORIGIN } from './deployment-binding'

const scope = { integrationId: '11111111-1111-4111-8111-111111111111', fundoId: '22222222-2222-4222-8222-222222222222',
  mailbox: 'qa@example.invalid', mailboxObjectId: '33333333-3333-4333-8333-333333333333', folderId: 'inbox',
  tenantId: '44444444-4444-4444-8444-444444444444' }
const env = { VERCEL_ENV: 'production', EMAIL_INTAKE_ENVIRONMENT: 'production', EMAIL_INTAKE_PRODUCTION_ENABLED: 'true',
  EMAIL_INTAKE_AUTOMATION_ENABLED: 'true', EMAIL_INTAKE_EXPECTED_SUPABASE_REF: PRODUCTION_EMAIL_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_EMAIL_REF}.supabase.co`, EMAIL_INTAKE_NOTIFICATION_ORIGIN: PRODUCTION_EMAIL_ORIGIN,
  EMAIL_INTAKE_PRODUCTION_SCOPES_JSON: JSON.stringify([scope]), EMAIL_INTAKE_DATABASE_URL: `postgresql://postgres:local-fixture@db.${PRODUCTION_EMAIL_REF}.supabase.co:5432/postgres` }

describe('production executor is opt-in and cannot be relabeled as QA', () => {
  it('accepts only the complete reviewed binding', () => {
    expect(automationEnabled(env)).toBe(true)
    expect(schedulerBindingValid(env)).toBe(true)
    expect(productionEmailScopeAllowed(scope, env)).toBe(true)
    expect(automationEnabled({})).toBe(false)
  })
  it('pausing automation preserves an explicitly scoped human review without starting the scheduler', () => {
    const paused = { ...env, EMAIL_INTAKE_AUTOMATION_ENABLED: 'false' }
    expect(automationEnabled(paused)).toBe(false)
    expect(schedulerBindingValid(paused)).toBe(false)
    expect(productionEmailScopeAllowed(scope, paused)).toBe(true)
  })
  it.each(Object.keys(env).filter(k => k !== 'EMAIL_INTAKE_DATABASE_URL'))('fails closed when %s is omitted', key => {
    expect(automationEnabled({ ...env, [key]: undefined })).toBe(false)
  })
  it.each(['VERCEL_ENV', 'EMAIL_INTAKE_ENVIRONMENT'])('rejects copied prod credentials labeled homolog in %s', key => {
    expect(automationEnabled({ ...env, [key]: 'homolog' })).toBe(false)
  })
  it.each(['integrationId', 'fundoId', 'mailbox', 'folderId'])('rejects mismatched %s before provider access', key => {
    expect(productionEmailScopeAllowed({ ...scope, [key]: 'other' }, env)).toBe(false)
  })
  it.each(['https://other.example.invalid', PRODUCTION_EMAIL_ORIGIN + '/', PRODUCTION_EMAIL_ORIGIN + '?q=1'])('rejects a different origin %s', origin => {
    expect(automationEnabled({ ...env, EMAIL_INTAKE_NOTIFICATION_ORIGIN: origin })).toBe(false)
  })
  it.each(['[]', '[{}]', '{', JSON.stringify([scope, scope])])('rejects empty, malformed or ambiguous tuples %s', scopes => {
    expect(automationEnabled({ ...env, EMAIL_INTAKE_PRODUCTION_SCOPES_JSON: scopes })).toBe(false)
  })
  it.each([`postgresql://postgres.${PRODUCTION_EMAIL_REF}@evil.invalid/postgres`,
    `postgresql://postgres@db.other.supabase.co/postgres`, `https://db.${PRODUCTION_EMAIL_REF}.supabase.co/postgres`])('rejects mismatched DB %s', database => {
    expect(schedulerBindingValid({ ...env, EMAIL_INTAKE_DATABASE_URL: database })).toBe(false)
  })
})
