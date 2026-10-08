import { describe, expect, it } from 'vitest'
import { automationEnabled, authorizeAutomationJob } from './environment.server'
const env = { EMAIL_INTAKE_AUTOMATION_ENABLED: 'true', EMAIL_INTAKE_ENVIRONMENT: 'homolog',
  EMAIL_INTAKE_EXPECTED_SUPABASE_REF: 'qa-project', NEXT_PUBLIC_SUPABASE_URL: 'https://qa-project.supabase.co',
  EMAIL_INTAKE_JOB_SECRET: 's'.repeat(64), VERCEL_ENV: 'preview' }
describe('internal scheduler access', () => {
  it('requires opt-in, matching database and strong secret', () => {
    const request = new Request('https://example.test/job', { headers: { authorization: `Bearer ${env.EMAIL_INTAKE_JOB_SECRET}` } })
    expect(authorizeAutomationJob(request, env)).toBe(true)
    expect(authorizeAutomationJob(request, { ...env, EMAIL_INTAKE_JOB_SECRET: 'short' })).toBe(false)
    expect(authorizeAutomationJob(request, { ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' })).toBe(false)
    expect(authorizeAutomationJob(request, { ...env, VERCEL_ENV: 'production' })).toBe(false)
    expect(authorizeAutomationJob(new Request(request.url), env)).toBe(false)
  })
  it('does not activate on default or copied production settings', () => {
    expect(automationEnabled({})).toBe(false)
    expect(automationEnabled({ ...env, EMAIL_INTAKE_ENVIRONMENT: 'production' })).toBe(false)
    expect(automationEnabled({ ...env, EMAIL_INTAKE_AUTOMATION_ENABLED: 'false' })).toBe(false)
    expect(automationEnabled({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'http://qa-project.supabase.co' })).toBe(false)
    expect(automationEnabled({ ...env, EMAIL_INTAKE_EXPECTED_SUPABASE_REF: 'wwsndnuvnjuabpbjwlck',
      NEXT_PUBLIC_SUPABASE_URL: 'https://wwsndnuvnjuabpbjwlck.supabase.co' })).toBe(false)
  })
})
