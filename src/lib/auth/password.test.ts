import { describe, expect, it } from 'vitest'
import { avaliarForcaSenha, criarAtributosUpdateSenha, validarNovaSenha } from '@/lib/auth/password'

describe('password security rules', () => {
  it('accepts a password with all required factors', () => {
    const result = avaliarForcaSenha('SenhaForte@2026')
    expect(result.valid).toBe(true)
    expect(result.score).toBe(5)
  })

  it('rejects weak passwords and lists missing factors', () => {
    const result = avaliarForcaSenha('fraca')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Pelo menos 12 caracteres')
    expect(result.errors).toContain('Letra maiuscula')
    expect(result.errors).toContain('Numero')
    expect(result.errors).toContain('Caractere especial')
  })

  it('rejects confirmation mismatch', () => {
    const result = validarNovaSenha({ password: 'SenhaForte@2026', confirmPassword: 'OutraSenha@2026' })
    expect(result.valid).toBe(false)
    expect(result.errors.confirmPassword).toEqual(['As senhas nao conferem.'])
  })

  it('rejects using the same current password in authenticated change', () => {
    const result = validarNovaSenha({ password: 'SenhaForte@2026', confirmPassword: 'SenhaForte@2026', currentPassword: 'SenhaForte@2026' })
    expect(result.valid).toBe(false)
    expect(result.errors.password).toContain('A nova senha deve ser diferente da senha atual.')
  })

  it('does not forward currentPassword to Supabase updateUser payload', () => {
    const payload = criarAtributosUpdateSenha('NovaSenha@2026') as Record<string, unknown>
    expect(payload).toEqual({ password: 'NovaSenha@2026' })
    expect(payload.currentPassword).toBeUndefined()
  })

  it('uses the official nonce field when a password update nonce is provided', () => {
    const payload = criarAtributosUpdateSenha('NovaSenha@2026', '123456') as Record<string, unknown>
    expect(payload).toEqual({ password: 'NovaSenha@2026', nonce: '123456' })
    expect(payload.currentPassword).toBeUndefined()
  })
})
