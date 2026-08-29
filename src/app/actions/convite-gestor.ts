'use server'

import { randomUUID } from 'node:crypto'
import { limparFluxoAutenticacao, obterFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import { finalizarConviteGestorAutenticado, type GestorInviteRole } from '@/lib/auth/gestor-invite-completion.server'
import { registrarEventoSeguranca } from '@/lib/auth/mfa'
import { validarNovaSenha } from '@/lib/auth/password'
import { createClient } from '@/lib/supabase/server'

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

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return {
      success: false,
      message: 'A sessao deste convite nao esta valida. Solicite um novo convite ao administrador.',
      notification: { type: 'error', message: 'A sessao deste convite nao esta valida.' },
    }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, status')
    .eq('id', user.id)
    .maybeSingle()
  const fluxo = await obterFluxoAutenticacao()
  if (fluxo !== 'gestor_invite' || !profile || !['gestor', 'super_admin'].includes(profile.role)) {
    await registrarEventoSeguranca({
      tipo_evento: 'ACESSO_NEGADO',
      usuario_id: user.id,
      ator_usuario_id: user.id,
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

  const statusEsperado = profile.role === 'gestor' ? 'inativo' : 'ativo'
  if (profile.status !== statusEsperado) {
    await limparFluxoAutenticacao()
    return {
      success: false,
      message: 'Este convite foi cancelado ou o acesso foi revogado.',
      notification: { type: 'error', message: 'Este convite foi cancelado ou o acesso foi revogado.' },
    }
  }

  const result = await finalizarConviteGestorAutenticado({
    supabase,
    userId: user.id,
    role: profile.role as GestorInviteRole,
    password,
    correlationId: randomUUID(),
  })
  return {
    ...result,
    notification: {
      type: result.success ? 'success' : 'error',
      message: result.message,
    },
  }
}
