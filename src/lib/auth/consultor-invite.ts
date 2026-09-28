export const CONSULTOR_INVITE_TOKEN_PATTERN = /^(?:[0-9a-f]{56}|[0-9a-f]{64})$/i

export type ConsultorInviteErrorCode =
  | 'AUTH_TOKEN_INVALID'
  | 'AUTH_TOKEN_EXPIRED'
  | 'AUTH_TOKEN_ALREADY_USED'
  | 'CONVITE_CONSULTOR_EXPIRADO'
  | 'CONVITE_CONSULTOR_CANCELADO'
  | 'CONVITE_CONSULTOR_JA_ACEITO'
  | 'EMAIL_MISMATCH'
  | 'PROFILE_INVALID'

const CODES: readonly ConsultorInviteErrorCode[] = [
  'AUTH_TOKEN_INVALID', 'AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_ALREADY_USED',
  'CONVITE_CONSULTOR_EXPIRADO', 'CONVITE_CONSULTOR_CANCELADO',
  'CONVITE_CONSULTOR_JA_ACEITO', 'EMAIL_MISMATCH', 'PROFILE_INVALID',
]

type AuthErrorLike = { code?: string | null; message?: string | null; status?: number | null }
export type ConsultorInviteState = {
  consultor_id: string
  consultor_nome: string
  papel: 'OWNER' | 'ADMIN' | 'OPERADOR' | 'LEITOR'
  status: 'PENDENTE' | 'ACEITO' | 'EXPIRADO' | 'CANCELADO'
  expires_at: string
}

export function isConsultorInviteToken(value: string | null | undefined) {
  return CONSULTOR_INVITE_TOKEN_PATTERN.test(value || '')
}

export function isConsultorInviteErrorCode(value: string | null | undefined): value is ConsultorInviteErrorCode {
  return CODES.includes(value as ConsultorInviteErrorCode)
}

function classificarErro(error: AuthErrorLike | null | undefined): ConsultorInviteErrorCode {
  const code = String(error?.code || '').toLowerCase()
  const message = String(error?.message || '').toLowerCase()
  if (message.includes('already used') || message.includes('already been used')) return 'AUTH_TOKEN_ALREADY_USED'
  if (code === 'otp_expired' || message.includes('expired')) return 'AUTH_TOKEN_EXPIRED'
  return 'AUTH_TOKEN_INVALID'
}

export async function confirmarTokenConviteConsultor(tokenHash: string, dependencies: {
  verifyOtp: (tokenHash: string) => Promise<{ user: { id: string; email: string | null } | null; error: AuthErrorLike | null }>
  loadProfile: (userId: string) => Promise<{ id: string; email: string; role: string; status: string; senha_alterada_em?: string | null } | null>
  loadInvitation: () => Promise<ConsultorInviteState | null>
}) {
  if (!isConsultorInviteToken(tokenHash)) return { success: false as const, code: 'AUTH_TOKEN_INVALID' as const }
  const verified = await dependencies.verifyOtp(tokenHash)
  if (verified.error) return { success: false as const, code: classificarErro(verified.error), authCode: verified.error.code || undefined, authStatus: verified.error.status || undefined }
  if (!verified.user?.id || !verified.user.email) return { success: false as const, code: 'AUTH_TOKEN_INVALID' as const }
  const profile = await dependencies.loadProfile(verified.user.id)
  if (!profile || profile.role !== 'consultor' || profile.status !== 'inativo') return { success: false as const, code: 'PROFILE_INVALID' as const }
  if (profile.senha_alterada_em) return { success: false as const, code: 'CONVITE_CONSULTOR_JA_ACEITO' as const }
  if (profile.email.trim().toLowerCase() !== verified.user.email.trim().toLowerCase()) return { success: false as const, code: 'EMAIL_MISMATCH' as const }
  const invitation = await dependencies.loadInvitation()
  if (!invitation) return { success: false as const, code: 'PROFILE_INVALID' as const }
  if (invitation.status === 'ACEITO') return { success: false as const, code: 'CONVITE_CONSULTOR_JA_ACEITO' as const }
  if (invitation.status === 'EXPIRADO') return { success: false as const, code: 'CONVITE_CONSULTOR_EXPIRADO' as const }
  if (invitation.status === 'CANCELADO') return { success: false as const, code: 'CONVITE_CONSULTOR_CANCELADO' as const }
  return { success: true as const, user: verified.user, profile, invitation }
}

export function mensagemConviteConsultor(code: ConsultorInviteErrorCode) {
  if (code === 'AUTH_TOKEN_EXPIRED' || code === 'CONVITE_CONSULTOR_EXPIRADO') return 'Este convite expirou. Solicite um novo convite ao administrador.'
  if (code === 'AUTH_TOKEN_ALREADY_USED' || code === 'CONVITE_CONSULTOR_JA_ACEITO') return 'Este convite ja foi utilizado. Entre com sua conta ou solicite um novo convite.'
  if (code === 'CONVITE_CONSULTOR_CANCELADO') return 'Este convite foi cancelado ou o acesso foi revogado. Procure o administrador.'
  if (code === 'EMAIL_MISMATCH') return 'O convite nao corresponde ao e-mail do usuario autenticado.'
  if (code === 'PROFILE_INVALID') return 'O provisionamento deste convite nao foi concluido. Procure o administrador.'
  return 'O convite e invalido. Solicite um novo convite ao administrador.'
}
