'use server'

import { AuthorizationError, requireAuthenticated, type AuthContext } from '@/lib/auth/authorization'
import { aceitarNovoCedenteInviteSchema, mensagemAceiteConvite } from '@/lib/auth/novo-cedente-invite'
import { hashTokenConviteNovoCedente } from '@/lib/auth/novo-cedente-invite.server'

export type AceiteConviteCedenteState = {
  success: boolean
  message: string
  redirectTo?: string
  errors?: Record<string, string[]>
} | undefined

export async function aceitarConviteNovoCedente(
  _previousState: AceiteConviteCedenteState,
  formData: FormData,
): Promise<AceiteConviteCedenteState> {
  const validated = aceitarNovoCedenteInviteSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })

  if (!validated.success) {
    return {
      success: false,
      message: 'Revise os dados informados.',
      errors: validated.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  let context: AuthContext
  try {
    context = await requireAuthenticated(undefined, { allowMfaPending: true })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { success: false, message: 'A sessao do convite nao esta valida. Solicite um novo convite.' }
    }
    throw error
  }
  if (context.profile.role !== 'cedente') {
    return { success: false, message: 'Este convite deve ser aceito por um usuario Cedente.' }
  }

  const { error: passwordError } = await context.supabase.auth.updateUser({
    password: validated.data.password,
  })
  if (passwordError) {
    return { success: false, message: 'Nao foi possivel definir a senha. O convite pode ter expirado.' }
  }

  const { data, error } = await context.supabase.rpc('aceitar_convite_novo_cedente', {
    p_token_hash: hashTokenConviteNovoCedente(validated.data.token),
    p_correlation_id: crypto.randomUUID(),
  })

  if (error || !data) {
    console.error('[aceitar-convite-novo-cedente]', {
      codigo: error?.code || 'RPC_EMPTY',
      mensagem: error?.message || 'retorno_vazio',
      usuario_id: context.user.id,
    })
    return { success: false, message: 'Nao foi possivel concluir o aceite. Tente novamente.' }
  }

  const result = data as { ok: boolean; codigo: string }
  if (!result.ok) return { success: false, message: mensagemAceiteConvite(result.codigo) }

  return {
    success: true,
    message: 'Convite aceito. Complete agora o cadastro do Cedente.',
    redirectTo: '/cedente/cadastro',
  }
}
