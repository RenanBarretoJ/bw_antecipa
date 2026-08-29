export const MFA_SESSION_DURATION_MS = 24 * 60 * 60 * 1000

export type MfaSessionStatus = 'valid' | 'missing' | 'expired' | 'revoked' | 'factor_invalid' | 'session_invalid' | 'unauthenticated'

export function calcularTempoRestanteMfa(expiresAt: string, serverNow: string) {
  const expires = Date.parse(expiresAt)
  const now = Date.parse(serverNow)
  if (!Number.isFinite(expires) || !Number.isFinite(now)) return 0
  return Math.max(0, expires - now)
}

export function avaliarValidadeSessaoMfa(input: {
  status: MfaSessionStatus
  expiraEm: string | null
  serverNow: string
}) {
  return input.status === 'valid' && !!input.expiraEm && calcularTempoRestanteMfa(input.expiraEm, input.serverNow) > 0
}
