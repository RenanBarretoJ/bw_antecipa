import { describe, expect, it } from 'vitest'
import {
  gerarRecoveryCodes,
  hashRecoveryCode,
  sanitizarCodigoTotp,
  usuarioExigeMfaPorPerfil,
  validarFormatoCodigoTotp,
} from '@/lib/auth/mfa'
import { avaliarValidadeSessaoMfa, calcularTempoRestanteMfa, MFA_SESSION_DURATION_MS } from '@/lib/auth/mfa-session'

describe('MFA policy and helpers', () => {
  it('requires MFA for every supported role by default', () => {
    expect(usuarioExigeMfaPorPerfil('gestor')).toBe(true)
    expect(usuarioExigeMfaPorPerfil('consultor')).toBe(true)
    expect(usuarioExigeMfaPorPerfil('cedente')).toBe(true)
    expect(usuarioExigeMfaPorPerfil('sacado')).toBe(true)
    expect(usuarioExigeMfaPorPerfil('super_admin')).toBe(true)
  })

  it('does not allow override=false to disable mandatory MFA', () => {
    expect(usuarioExigeMfaPorPerfil('cedente', true)).toBe(true)
    expect(usuarioExigeMfaPorPerfil('gestor', false)).toBe(true)
    expect(usuarioExigeMfaPorPerfil('sacado', false)).toBe(true)
  })

  it('accepts only six digit TOTP codes after sanitization', () => {
    expect(sanitizarCodigoTotp('12 34-56')).toBe('123456')
    expect(validarFormatoCodigoTotp('123456')).toBe(true)
    expect(validarFormatoCodigoTotp('12345')).toBe(false)
    expect(validarFormatoCodigoTotp('1234567')).toBe(false)
    expect(validarFormatoCodigoTotp('abcdef')).toBe(false)
  })

  it('generates one-time recovery codes without storing plaintext', () => {
    const codes = gerarRecoveryCodes(10)
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    expect(codes.every((code) => /^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(code))).toBe(true)
  })

  it('hashes recovery codes per user and preserves deterministic lookup', () => {
    const code = 'ABCD-EF12-3456'
    expect(hashRecoveryCode('user-a', code)).toBe(hashRecoveryCode('user-a', 'abcdef123456'))
    expect(hashRecoveryCode('user-a', code)).not.toBe(hashRecoveryCode('user-b', code))
    expect(hashRecoveryCode('user-a', code)).toHaveLength(64)
  })

  it('defines the operational MFA window as exactly 24 hours', () => {
    expect(MFA_SESSION_DURATION_MS).toBe(86_400_000)
    expect(calcularTempoRestanteMfa('2026-08-04T12:00:00.000Z', '2026-08-03T12:00:00.000Z')).toBe(MFA_SESSION_DURATION_MS)
  })

  it('accepts a session before expiry and rejects it at the exact boundary', () => {
    expect(avaliarValidadeSessaoMfa({ status: 'valid', expiraEm: '2026-08-04T12:00:00.000Z', serverNow: '2026-08-04T11:59:59.999Z' })).toBe(true)
    expect(avaliarValidadeSessaoMfa({ status: 'valid', expiraEm: '2026-08-04T12:00:00.000Z', serverNow: '2026-08-04T12:00:00.000Z' })).toBe(false)
    expect(avaliarValidadeSessaoMfa({ status: 'expired', expiraEm: '2026-08-04T12:00:00.000Z', serverNow: '2026-08-04T11:00:00.000Z' })).toBe(false)
  })
})
