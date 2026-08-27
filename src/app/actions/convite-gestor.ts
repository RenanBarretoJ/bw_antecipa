'use server'

import { requireAuthenticated } from '@/lib/auth/authorization'
import { limparFluxoAutenticacao, obterFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import { finalizarConviteGestorAutenticado, type GestorInviteRole } from '@/lib/auth/gestor-invite-completion.server'
import { registrarEventoSeguranca } from '@/lib/auth/mfa'
import { validarNovaSenha } from '@/lib/auth/password'

export type ConviteGestorActionState = {
  success: boolean
  message: string
  redirectTo?: string
  errors?: Record<string, string[]>
  notification?: {
    type: 'success' | 'error' | 'warning'
    message: string
  }
} | undefined

export async function concluirConviteGestor(
  _previousState: ConviteGestorActionState,
  formData: FormData,
): Promise<ConviteGestorActionState> {
  const password = String(formData.get('password') || '')
  const confirmPassword = String(formData.get('confirmPassword') || '')
  const validation = validarNovaSenha({ password, confirmPassword })
  if (!validation.valid) {
    return {
      success: false,
      message: 'Revise os campos informados.',
      errors: validation.errors,
      notification: { type: 'warning', message: 'Revise os campos informados.' },
    }
  }

  const context = await requireAuthenticated(undefined, { allowMfaPending: true })
  const fluxo = await obterFluxoAutenticacao()
  if (fluxo !== 'gestor_invite' || !['gestor', 'super_admin'].includes(context.profile.role)) {
    await registrarEventoSeguranca({
      tipo_evento: 'ACESSO_NEGADO',
      usuario_id: context.user.id,
      ator_usuario_id: context.user.id,
      origem: 'convite_gestor',
      severidade: 'warning',
      dados: { causa: 'CONVITE_GESTOR_JA_ACEITO', fluxo },
    })
    return {
      success: false,
      message: 'A sessao deste convite nao esta valida. Solicite um novo convite ao administrador.',
      notification: { type: 'error', message: 'A sessao deste convite nao esta valida.' },
    }
  }

  if (context.profile.status !== 'ativo') {
    await limparFluxoAutenticacao()
    return {
      success: false,
      message: 'Este convite foi cancelado ou o acesso foi revogado.',
      notification: { type: 'error', message: 'Este convite foi cancelado ou o acesso foi revogado.' },
    }
  }

  const result = await finalizarConviteGestorAutenticado({
    supabase: context.supabase,
    userId: context.user.id,
    role: context.profile.role as GestorInviteRole,
    password,
  })
  return {
    ...result,
    notification: {
      type: result.success ? 'success' : 'error',
      message: result.message,
    },
  }
}
