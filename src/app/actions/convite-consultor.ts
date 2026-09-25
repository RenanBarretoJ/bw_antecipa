'use server'

import { randomUUID } from 'node:crypto'
import { limparFluxoAutenticacao, obterFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import { finalizarConviteConsultorAutenticado } from '@/lib/auth/consultor-invite-completion.server'
import { validarNovaSenha } from '@/lib/auth/password'
import { createClient } from '@/lib/supabase/server'

export type ConviteConsultorActionState = { success: boolean; message: string; redirectTo?: string; errors?: Record<string, string[]>; notification?: { type: 'success' | 'error' | 'warning'; message: string } } | undefined

export async function concluirConviteConsultor(_state: ConviteConsultorActionState, formData: FormData): Promise<ConviteConsultorActionState> {
  const password = String(formData.get('password') || '')
  const confirmPassword = String(formData.get('confirmPassword') || '')
  const validation = validarNovaSenha({ password, confirmPassword })
  if (!validation.valid) return { success: false, message: 'Revise os campos informados.', errors: validation.errors, notification: { type: 'warning', message: 'Revise os campos informados.' } }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || await obterFluxoAutenticacao() !== 'consultor_invite') return { success: false, message: 'A sessao deste convite nao esta valida.', notification: { type: 'error', message: 'A sessao deste convite nao esta valida.' } }
  const { data: profile } = await supabase.from('profiles').select('role, status').eq('id', user.id).maybeSingle()
  if (!profile || profile.role !== 'consultor' || profile.status !== 'inativo') {
    await limparFluxoAutenticacao()
    return { success: false, message: 'Este convite foi cancelado ou o acesso foi revogado.', notification: { type: 'error', message: 'Este convite foi cancelado ou o acesso foi revogado.' } }
  }
  const result = await finalizarConviteConsultorAutenticado({ supabase, userId: user.id, password, correlationId: randomUUID() })
  return { ...result, notification: { type: result.success ? 'success' : 'error', message: result.message } }
}
