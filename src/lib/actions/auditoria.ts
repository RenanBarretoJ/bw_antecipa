'use server'

import { createClient } from '@/lib/supabase/server'

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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return

  await supabase.from('logs_auditoria').insert({
    usuario_id: user.id,
    tipo_evento,
    entidade_tipo,
    entidade_id,
    dados_antes,
    dados_depois,
  } as never)
}
