'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'

interface LogAuditoriaInput {
  tipo_evento: string
  entidade_tipo: string
  entidade_id?: string
  dados_antes?: Record<string, unknown> | null
  dados_depois?: Record<string, unknown> | null
}

export async function registrarLog({
  tipo_evento,
  entidade_tipo,
  entidade_id,
  dados_antes = null,
  dados_depois = null,
}: LogAuditoriaInput) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      console.warn('[registrarLog] Usuario nao autenticado — log nao registrado:', { tipo_evento, entidade_tipo, entidade_id })
      return
    }

    const admin = createAdminClient()
    const { error } = await admin.from('logs_auditoria').insert({
      usuario_id: user.id,
      tipo_evento,
      entidade_tipo,
      entidade_id,
      dados_antes,
      dados_depois,
    } as never)

    if (error) {
      console.error('[registrarLog] Falha ao inserir log:', error.message, { tipo_evento, entidade_tipo, entidade_id })
    }
  } catch (err) {
    console.error('[registrarLog] Erro inesperado:', err)
  }
}
