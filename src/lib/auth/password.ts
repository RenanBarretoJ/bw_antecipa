export const PASSWORD_MIN_LENGTH = 12

export type PasswordStrengthCheck = {
  key: 'length' | 'uppercase' | 'lowercase' | 'number' | 'special'
  label: string
  valid: boolean
}

export type PasswordStrength = {
  score: number
  valid: boolean
  checks: PasswordStrengthCheck[]
  errors: string[]
}

export function avaliarForcaSenha(password: string): PasswordStrength {
  const checks: PasswordStrengthCheck[] = [
    { key: 'length', label: `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres`, valid: password.length >= PASSWORD_MIN_LENGTH },
    { key: 'uppercase', label: 'Letra maiuscula', valid: /[A-Z]/.test(password) },
    { key: 'lowercase', label: 'Letra minuscula', valid: /[a-z]/.test(password) },
    { key: 'number', label: 'Numero', valid: /\d/.test(password) },
    { key: 'special', label: 'Caractere especial', valid: /[^a-zA-Z0-9]/.test(password) },
  ]

  const errors = checks.filter((check) => !check.valid).map((check) => check.label)
  return {
    score: checks.filter((check) => check.valid).length,
    valid: errors.length === 0,
    checks,
    errors,
  }
}

export function validarNovaSenha(input: { password: string; confirmPassword: string; currentPassword?: string }) {
  const errors: Record<string, string[]> = {}
  const strength = avaliarForcaSenha(input.password)

  if (!strength.valid) errors.password = strength.errors
  if (input.password !== input.confirmPassword) errors.confirmPassword = ['As senhas nao conferem.']
  if (input.currentPassword !== undefined && input.password === input.currentPassword) {
    errors.password = [...(errors.password || []), 'A nova senha deve ser diferente da senha atual.']
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    strength,
  }
}

export function criarAtributosUpdateSenha(password: string, nonce?: string | null) {
  return nonce ? { password, nonce } : { password }
}
