import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import { limparFluxoAutenticacao, marcarFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import { obterEstadoMfaUsuario, registrarEventoSeguranca } from '@/lib/auth/mfa'
import { requireRoleRedirect } from '@/lib/auth/role-routing'
import type { AppSupabaseClient } from '@/lib/auth/authorization'

export type GestorInviteRole = 'gestor' | 'super_admin'

export type GestorInviteCompletionResult =
  | { success: true; message: string; redirectTo: string }
  | { success: false; message: string; code: 'PASSWORD_UPDATE_FAILED' | 'PROFILE_UPDATE_FAILED' }

export async function finalizarConviteGestorAutenticado(input: {
  supabase: AppSupabaseClient
  userId: string
  role: GestorInviteRole
  password: string
}): Promise<GestorInviteCompletionResult> {
  const { error: passwordError } = await input.supabase.auth.updateUser({ password: input.password })
  if (passwordError) {
    await registrarEventoSeguranca({
      tipo_evento: 'PASSWORD_CHANGE_FAILED',
      usuario_id: input.userId,
      ator_usuario_id: input.userId,
      origem: 'convite_gestor',
      severidade: 'warning',
      dados: { etapa: 'definir_senha_convite', auth_code: passwordError.code, auth_status: passwordError.status },
    })
    return {
      success: false,
      code: 'PASSWORD_UPDATE_FAILED',
      message: 'Nao foi possivel definir a senha. Solicite um novo convite se o problema persistir.',
    }
  }

  const { error: profileUpdateError } = await createAdminClient()
    .from('profiles')
    .update({ senha_alterada_em: new Date().toISOString() } as never)
    .eq('id', input.userId)

  if (profileUpdateError) {
    await registrarEventoSeguranca({
      tipo_evento: 'PASSWORD_CHANGE_FAILED',
      usuario_id: input.userId,
      ator_usuario_id: input.userId,
      origem: 'convite_gestor',
      severidade: 'warning',
      dados: { etapa: 'registrar_senha_alterada', db_code: profileUpdateError.code },
    })
    return {
      success: false,
      code: 'PROFILE_UPDATE_FAILED',
      message: 'A senha foi definida, mas a conclusao do convite requer reconciliacao administrativa.',
    }
  }

  await registrarEventoSeguranca({
    tipo_evento: 'PASSWORD_CHANGED',
    usuario_id: input.userId,
    ator_usuario_id: input.userId,
    origem: 'convite_gestor',
    dados: { convite_concluido: true },
  })

  const estado = await obterEstadoMfaUsuario(input.supabase)
  if (estado.exigeMfa && !estado.possuiFatorVerificado) {
    await marcarFluxoAutenticacao('mfa_setup_required')
    return {
      success: true,
      message: 'Convite aceito. Configure o MFA para continuar.',
      redirectTo: '/mfa/setup',
    }
  }

  await limparFluxoAutenticacao()
  const segundoFatorValido = estado.sessaoElevadaValida
    && estado.aalAtual === 'aal2'
    && estado.sessaoElevadaMetodo === 'totp'
  if ((estado.exigeMfa || estado.possuiFatorVerificado) && !segundoFatorValido) {
    return {
      success: true,
      message: 'Convite aceito. Confirme o MFA para acessar o portal.',
      redirectTo: '/mfa/desafio',
    }
  }

  return {
    success: true,
    message: 'Convite aceito com sucesso.',
    redirectTo: requireRoleRedirect(input.role),
  }
}
