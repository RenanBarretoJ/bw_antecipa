import 'server-only'

import { limparFluxoAutenticacao, marcarFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { obterEstadoMfaUsuario, registrarEventoSeguranca } from '@/lib/auth/mfa'

export async function finalizarConviteConsultorAutenticado(input: {
  supabase: AppSupabaseClient
  userId: string
  password: string
  correlationId: string
}) {
  const { error: passwordError } = await input.supabase.auth.updateUser({ password: input.password })
  if (passwordError) {
    await registrarEventoSeguranca({ tipo_evento: 'PASSWORD_CHANGE_FAILED', usuario_id: input.userId, ator_usuario_id: input.userId, origem: 'convite_consultor', severidade: 'warning', dados: { etapa: 'definir_senha_convite', auth_code: passwordError.code } })
    return { success: false as const, code: 'PASSWORD_UPDATE_FAILED', message: 'Nao foi possivel definir a senha. Solicite um novo convite se o problema persistir.' }
  }
  const { data, error } = await input.supabase.rpc('aceitar_convite_consultor', { p_correlation_id: input.correlationId })
  const activation = data as unknown as { success?: boolean } | null
  if (error || activation?.success !== true) {
    await registrarEventoSeguranca({ tipo_evento: 'PASSWORD_CHANGE_FAILED', usuario_id: input.userId, ator_usuario_id: input.userId, origem: 'convite_consultor', severidade: 'warning', dados: { etapa: 'ativar_convite_consultor', db_code: error?.code || null } })
    return { success: false as const, code: 'INVITE_ACTIVATION_FAILED', message: 'A senha foi definida, mas nao foi possivel ativar o convite. Procure o administrador.' }
  }
  await registrarEventoSeguranca({ tipo_evento: 'PASSWORD_CHANGED', usuario_id: input.userId, ator_usuario_id: input.userId, origem: 'convite_consultor', dados: { convite_concluido: true } })
  const estado = await obterEstadoMfaUsuario(input.supabase)
  if (estado.exigeMfa && !estado.possuiFatorVerificado) {
    await marcarFluxoAutenticacao('mfa_setup_required')
    return { success: true as const, message: 'Convite aceito. Configure o MFA para continuar.', redirectTo: '/mfa/setup' }
  }
  await limparFluxoAutenticacao()
  const segundoFatorValido = estado.sessaoElevadaValida && estado.aalAtual === 'aal2' && estado.sessaoElevadaMetodo === 'totp'
  if ((estado.exigeMfa || estado.possuiFatorVerificado) && !segundoFatorValido) return { success: true as const, message: 'Convite aceito. Confirme o MFA para acessar o portal.', redirectTo: '/mfa/desafio' }
  return { success: true as const, message: 'Convite aceito com sucesso.', redirectTo: '/consultor/dashboard' }
}
