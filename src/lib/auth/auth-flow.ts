export const AUTH_FLOW_COOKIE = 'bw_auth_flow'
export const AUTH_FLOW_MAX_AGE_SECONDS = 15 * 60

export type AuthFlow = 'password_recovery' | 'mfa_setup_required' | 'mfa_recovery_temporary'

const AUTH_FLOW_COOKIE_VERSION = 'v1'

export function isAuthFlow(value: string | null | undefined): value is AuthFlow {
  return value === 'password_recovery' || value === 'mfa_setup_required' || value === 'mfa_recovery_temporary'
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function hmacSha256(message: string, secret: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return base64UrlEncode(new Uint8Array(signature))
}

function authFlowSecret() {
  return process.env.AUTH_FLOW_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

export async function assinarAuthFlowCookie(flow: AuthFlow, issuedAt = Date.now()) {
  const secret = authFlowSecret()
  if (!secret) throw new Error('AUTH_FLOW_COOKIE_SECRET nao configurado.')
  const payload = `${AUTH_FLOW_COOKIE_VERSION}.${flow}.${issuedAt}`
  const signature = await hmacSha256(payload, secret)
  return `${payload}.${signature}`
}

export async function lerAuthFlowCookieAssinado(value: string | null | undefined): Promise<AuthFlow | null> {
  if (!value) return null

  if (isAuthFlow(value)) return null

  const [version, flow, issuedAtRaw, signature, ...extra] = value.split('.')
  if (extra.length || version !== AUTH_FLOW_COOKIE_VERSION || !isAuthFlow(flow) || !issuedAtRaw || !signature) return null

  const issuedAt = Number(issuedAtRaw)
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > AUTH_FLOW_MAX_AGE_SECONDS * 1000) return null

  const secret = authFlowSecret()
  if (!secret) return null

  const payload = `${version}.${flow}.${issuedAtRaw}`
  const expected = await hmacSha256(payload, secret)
  return expected === signature ? flow : null
}

export function isPasswordRecoveryAllowedPath(pathname: string) {
  return pathname === '/redefinir-senha' || pathname.startsWith('/mfa') || pathname === '/login'
}

export function isMfaSetupAllowedPath(pathname: string) {
  return pathname.startsWith('/mfa') || pathname === '/login'
}

export function getAuthFlowRedirect(flow: AuthFlow): string {
  if (flow === 'password_recovery') return '/redefinir-senha'
  return '/mfa/setup'
}
