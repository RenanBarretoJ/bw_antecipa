import { afterEach, describe, expect, it, vi } from 'vitest'
import { protectValue, readTestCredentialsFromEnvironment, revealValue, type SecretScope } from './secrets.server'

const scope: SecretScope = { integrationId: '11111111-1111-4111-8111-111111111111',
  fundoId: '22222222-2222-4222-8222-222222222222', purpose: 'GRAPH_CREDENTIAL' }
afterEach(() => vi.unstubAllEnvs())
describe('protected integration credentials', () => {
  it('reuses authenticated encryption with context binding and non-deterministic ciphertext', () => {
    vi.stubEnv('PORTAL_FIDC_CREDENTIAL_KEYS_JSON', JSON.stringify({ v1: '11'.repeat(32) }))
    vi.stubEnv('PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION', 'v1')
    const first = protectValue('test-secret', scope)
    const second = protectValue('test-secret', scope)
    expect(first.ciphertext).not.toContain('test-secret')
    expect(first.ciphertext).not.toBe(second.ciphertext)
    expect(revealValue(first, scope)).toBe('test-secret')
    expect(() => revealValue(first, { ...scope, purpose: 'CURSOR' })).toThrow('CONFIGURATION')
    expect(() => revealValue(first, { ...scope, fundoId: scope.integrationId })).toThrow('CONFIGURATION')
    expect(() => revealValue({ ...first, ciphertext: first.ciphertext.slice(0, -8) }, scope)).toThrow('CONFIGURATION')
  })
  it('does not allow an arbitrary env name', () => {
    expect(() => readTestCredentialsFromEnvironment('SUPABASE_SERVICE_ROLE_KEY')).toThrow('CONFIGURATION')
    expect(() => readTestCredentialsFromEnvironment('EMAIL_INTAKE_QA_MISSING')).toThrow('CONFIGURATION')
  })
})
