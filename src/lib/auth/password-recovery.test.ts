import { describe, expect, it } from 'vitest'
import { deveProcessarCodigoPkce, normalizarRecoveryNext, recoveryFlowLogShape, sanitizarCodigoErroRecuperacao } from '@/lib/auth/password-recovery'

describe('password recovery flow helpers', () => {
  it('accepts only allowlisted next paths', () => {
    expect(normalizarRecoveryNext('/redefinir-senha')).toBe('/redefinir-senha')
    expect(normalizarRecoveryNext('/gestor/dashboard')).toBe('/redefinir-senha')
    expect(normalizarRecoveryNext('https://evil.test/redefinir-senha')).toBe('/redefinir-senha')
  })

  it('sanitizes recovery error codes', () => {
    expect(sanitizarCodigoErroRecuperacao('otp_expired')).toBe('otp_expired')
    expect(sanitizarCodigoErroRecuperacao('access_denied')).toBe('access_denied')
    expect(sanitizarCodigoErroRecuperacao('anything_else')).toBe('otp_expired')
  })

  it('processes PKCE code only once and never when Supabase returned an error', () => {
    expect(deveProcessarCodigoPkce({ code: 'abc', alreadyProcessed: false })).toBe(true)
    expect(deveProcessarCodigoPkce({ code: 'abc', alreadyProcessed: true })).toBe(false)
    expect(deveProcessarCodigoPkce({ code: 'abc', error: 'access_denied' })).toBe(false)
    expect(deveProcessarCodigoPkce({ code: null })).toBe(false)
  })

  it('logs only safe flow metadata', () => {
    expect(recoveryFlowLogShape({ hasTokenHash: true, success: false, errorCode: 'otp_expired', next: '/redefinir-senha' })).toEqual({
      fluxo: 'token_hash',
      sucesso: false,
      error_code: 'otp_expired',
      next: '/redefinir-senha',
    })
  })
})
