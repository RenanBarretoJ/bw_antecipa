// O GoTrue hospedado atualmente retorna hashed_token hexadecimal com 56
// caracteres. Convites legados do projeto usavam 64, por isso ambos permanecem
// aceitos na validacao sintatica do GET scanner-safe.
export const GESTOR_INVITE_TOKEN_PATTERN = /^(?:[0-9a-f]{56}|[0-9a-f]{64})$/i

export type GestorInviteErrorCode =
  | 'AUTH_TOKEN_INVALID'
  | 'AUTH_TOKEN_EXPIRED'
  | 'AUTH_TOKEN_ALREADY_USED'
  | 'CONVITE_GESTOR_EXPIRADO'
  | 'CONVITE_GESTOR_CANCELADO'
  | 'CONVITE_GESTOR_JA_ACEITO'
  | 'EMAIL_MISMATCH'
  | 'PROFILE_INVALID'

const GESTOR_INVITE_ERROR_CODES: readonly GestorInviteErrorCode[] = [
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_TOKEN_ALREADY_USED',
  'CONVITE_GESTOR_EXPIRADO',
  'CONVITE_GESTOR_CANCELADO',
  'CONVITE_GESTOR_JA_ACEITO',
  'EMAIL_MISMATCH',
  'PROFILE_INVALID',
]

type AuthErrorLike = {
  code?: string | null
  message?: string | null
  status?: number | null
}

export type GestorInviteAuthUser = {
  id: string
  email: string | null
}

export type GestorInviteProfile = {
  id: string
  email: string
  role: string
  status: string
  senha_alterada_em?: string | null
}

export type GestorInviteState = {
  id: string
  status: 'PENDENTE' | 'ACEITO' | 'EXPIRADO' | 'CANCELADO'
  expires_at: string
}

export type GestorInviteConfirmationResult =
  | { success: true; user: GestorInviteAuthUser; profile: GestorInviteProfile }
  | { success: false; code: GestorInviteErrorCode; authCode?: string; authStatus?: number }

export type GestorInviteConfirmationDependencies = {
  verifyOtp: (tokenHash: string) => Promise<{
    user: GestorInviteAuthUser | null
    error: AuthErrorLike | null
  }>
  loadProfile: (userId: string) => Promise<GestorInviteProfile | null>
  loadInvitation: (userId: string) => Promise<GestorInviteState | null>
}

export function isGestorInviteToken(value: string | null | undefined) {
  return GESTOR_INVITE_TOKEN_PATTERN.test(value || '')
}

export function isGestorInviteErrorCode(value: string | null | undefined): value is GestorInviteErrorCode {
  return GESTOR_INVITE_ERROR_CODES.includes(value as GestorInviteErrorCode)
}

export function classificarErroAuthConviteGestor(error: AuthErrorLike | null | undefined): GestorInviteErrorCode {
  const code = String(error?.code || '').toLowerCase()
  const message = String(error?.message || '').toLowerCase()

  if (message.includes('already used') || message.includes('already been used') || message.includes('ja foi utilizado')) {
    return 'AUTH_TOKEN_ALREADY_USED'
  }
  if (code === 'otp_expired' || message.includes('expired')) return 'AUTH_TOKEN_EXPIRED'
  return 'AUTH_TOKEN_INVALID'
}

export async function confirmarTokenConviteGestor(
  tokenHash: string,
  dependencies: GestorInviteConfirmationDependencies,
): Promise<GestorInviteConfirmationResult> {
  if (!isGestorInviteToken(tokenHash)) return { success: false, code: 'AUTH_TOKEN_INVALID' }

  const verified = await dependencies.verifyOtp(tokenHash)
  if (verified.error) {
    return {
      success: false,
      code: classificarErroAuthConviteGestor(verified.error),
      authCode: verified.error.code || undefined,
      authStatus: verified.error.status || undefined,
    }
  }
  if (!verified.user?.id || !verified.user.email) return { success: false, code: 'AUTH_TOKEN_INVALID' }

  const profile = await dependencies.loadProfile(verified.user.id)
  if (!profile || !['gestor', 'super_admin'].includes(profile.role)) {
    return { success: false, code: 'PROFILE_INVALID' }
  }
  if (profile.senha_alterada_em) return { success: false, code: 'CONVITE_GESTOR_JA_ACEITO' }
  if (profile.email.trim().toLowerCase() !== verified.user.email.trim().toLowerCase()) {
    return { success: false, code: 'EMAIL_MISMATCH' }
  }

  if (profile.role === 'gestor') {
    const invitation = await dependencies.loadInvitation(verified.user.id)
    if (!invitation) return { success: false, code: 'PROFILE_INVALID' }
    if (invitation.status === 'ACEITO') return { success: false, code: 'CONVITE_GESTOR_JA_ACEITO' }
    if (invitation.status === 'EXPIRADO') return { success: false, code: 'CONVITE_GESTOR_EXPIRADO' }
    if (invitation.status === 'CANCELADO') return { success: false, code: 'CONVITE_GESTOR_CANCELADO' }
    if (profile.status !== 'inativo') return { success: false, code: 'PROFILE_INVALID' }
  } else if (profile.status !== 'ativo') {
    return { success: false, code: 'CONVITE_GESTOR_CANCELADO' }
  }

  return { success: true, user: verified.user, profile }
}

export function mensagemConviteGestor(code: GestorInviteErrorCode) {
  if (code === 'AUTH_TOKEN_EXPIRED' || code === 'CONVITE_GESTOR_EXPIRADO') {
    return 'Este convite expirou. Solicite um novo convite ao administrador.'
  }
  if (code === 'AUTH_TOKEN_ALREADY_USED' || code === 'CONVITE_GESTOR_JA_ACEITO') {
    return 'Este convite ja foi utilizado. Entre com sua conta ou solicite um novo convite.'
  }
  if (code === 'CONVITE_GESTOR_CANCELADO') {
    return 'Este convite foi cancelado ou o acesso foi revogado. Procure o administrador.'
  }
  if (code === 'EMAIL_MISMATCH') {
    return 'O convite nao corresponde ao e-mail do usuario autenticado.'
  }
  if (code === 'PROFILE_INVALID') {
    return 'O provisionamento deste convite nao foi concluido. Procure o administrador.'
  }
  return 'O convite e invalido. Solicite um novo convite ao administrador.'
}

export function gestorInviteLogShape(input: {
  success: boolean
  code?: GestorInviteErrorCode
  authCode?: string
  authStatus?: number
  correlationId: string
  userId?: string
}) {
  return {
    fluxo: 'convite_gestor',
    success: input.success,
    code: input.code || null,
    auth_code: input.authCode || null,
    auth_status: input.authStatus || null,
    correlation_id: input.correlationId,
    user_id: input.userId || null,
  }
}
