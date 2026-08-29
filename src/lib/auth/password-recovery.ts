export const PASSWORD_RECOVERY_NEXT_ALLOWLIST = ['/redefinir-senha'] as const

export type PasswordRecoveryNext = (typeof PASSWORD_RECOVERY_NEXT_ALLOWLIST)[number]

export function normalizarRecoveryNext(value: string | null | undefined): PasswordRecoveryNext {
  return PASSWORD_RECOVERY_NEXT_ALLOWLIST.includes(value as PasswordRecoveryNext)
    ? value as PasswordRecoveryNext
    : '/redefinir-senha'
}

export function sanitizarCodigoErroRecuperacao(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'otp_expired') return 'otp_expired'
  if (normalized === 'access_denied') return 'access_denied'
  if (normalized === 'invalid_request') return 'invalid_request'
  return 'otp_expired'
}

export function deveProcessarCodigoPkce(input: {
  code: string | null | undefined
  error?: string | null | undefined
  errorCode?: string | null | undefined
  alreadyProcessed?: boolean
}) {
  return !!input.code && !input.error && !input.errorCode && !input.alreadyProcessed
}

export function recoveryFlowLogShape(input: {
  hasCode?: boolean
  hasTokenHash?: boolean
  success?: boolean
  errorCode?: string | null
  next?: string | null
}) {
  return {
    fluxo: input.hasTokenHash ? 'token_hash' : input.hasCode ? 'code_pkce' : 'ausente',
    sucesso: input.success ?? null,
    error_code: input.errorCode || null,
    next: input.next || null,
  }
}
