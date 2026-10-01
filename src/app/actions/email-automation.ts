'use server'

import { z } from 'zod'
import { requireRole } from '@/lib/auth/authorization'
import { requireSessaoMfaValida } from '@/lib/auth/mfa'
import { healthSnapshotSchema } from '@/lib/email-intake/automation/health'
import { automationEnabled } from '@/lib/email-intake/automation/environment.server'

async function operator() {
  const context = await requireRole(['gestor', 'super_admin'])
  await requireSessaoMfaValida(context)
  return context
}

export async function carregarSaudeEmail(fundoId: string) {
  const context = await operator()
  const { data, error } = await context.supabase.rpc('email_automation_operator_health', { p_fundo_id: z.uuid().parse(fundoId) })
  if (error) throw new Error('Não foi possível consultar a integração de e-mail.')
  return z.array(healthSnapshotSchema).parse(data)
}

export async function sinalizarSincronizacaoEmail(integrationId: string): Promise<
  { status: 'QUEUED' | 'ALREADY_PENDING' } | { status: 'ERROR'; message: string }
> {
  try {
    if (!automationEnabled()) return { status: 'ERROR', message: 'A automação de e-mail não está ativa neste ambiente.' }
    const context = await operator()
    const { data, error } = await context.supabase.rpc('email_automation_manual_sync', { p_id: z.uuid().parse(integrationId) })
    if (error) throw new Error('EMAIL_SYNC_DENIED')
    return { status: data ? 'QUEUED' : 'ALREADY_PENDING' }
  } catch {
    return { status: 'ERROR', message: 'Não foi possível solicitar a sincronização. Confira seu acesso e a integração.' }
  }
}
