'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { normalizarAtorAuditoria, type AuditoriaAtor } from '@/lib/auth/audit-actor'

export interface LogAuditoriaInput {
  tipo_evento: string
  entidade_tipo: string
  entidade_id?: string
  dados_antes?: Record<string, unknown> | null
  dados_depois?: Record<string, unknown> | null
  ator?: AuditoriaAtor
}

export async function registrarLog({
  tipo_evento,
  entidade_tipo,
  entidade_id,
  dados_antes = null,
  dados_depois = null,
  ator,
}: LogAuditoriaInput) {
  try {
    let currentUserId: string | null = null
    if (!ator || ator.tipo === 'usuario') {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      currentUserId = user?.id ?? null
    }

    const normalizedActor = normalizarAtorAuditoria(ator, currentUserId)

    if (normalizedActor.ator_tipo === 'usuario' && !normalizedActor.usuario_id) {
      console.warn('[registrarLog] Usuário não autenticado — log não registrado:', { tipo_evento, entidade_tipo, entidade_id })
      return
    }

    const admin = createAdminClient()
    const { error } = await admin.from('logs_auditoria').insert({
      ...normalizedActor,
      tipo_evento,
      entidade_tipo,
      entidade_id,
      dados_antes,
      dados_depois,
    })

    if (error) {
      console.error('[registrarLog] Falha ao inserir log:', error.message, { tipo_evento, entidade_tipo, entidade_id, ator: normalizedActor.ator_tipo })
    }
  } catch (err) {
    console.error('[registrarLog] Erro inesperado:', err)
  }
}
