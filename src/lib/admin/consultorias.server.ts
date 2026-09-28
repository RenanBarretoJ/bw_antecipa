import 'server-only'

import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import type { AdminConsultoriaDetalhe, AdminConsultoriaListResult } from './consultorias'

export async function listarAdminConsultorias(input: {
  busca: string
  status: 'todos' | 'ativo' | 'inativo'
  pagina: number
  porPagina: number
}): Promise<AdminConsultoriaListResult> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_listar_consultorias', {
    p_busca: input.busca || null,
    p_status: input.status,
    p_pagina: input.pagina,
    p_por_pagina: input.porPagina,
  })
  if (error) throw new Error('Nao foi possivel carregar as Consultorias.')
  return data as unknown as AdminConsultoriaListResult
}

export async function obterAdminConsultoria(consultorId: string): Promise<AdminConsultoriaDetalhe | null> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_obter_consultoria', { p_consultor_id: consultorId })
  if (error) throw new Error('Nao foi possivel carregar a Consultoria.')
  return data as unknown as AdminConsultoriaDetalhe | null
}
