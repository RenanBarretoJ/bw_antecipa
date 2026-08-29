import 'server-only'

import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import type {
  AdminFundoAuditoriaItem,
  AdminFundoDetalhe,
  AdminFundoListResult,
  AdminFundoPageSize,
  AdminFundoResumo,
  AdminFundoStatus,
} from '@/lib/admin/fundos'

export async function carregarResumoAdminFundos(): Promise<AdminFundoResumo> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_resumo_fundos')
  if (error) throw new Error('Nao foi possivel carregar o resumo dos fundos.')
  return data as unknown as AdminFundoResumo
}

export async function listarAdminFundos(input: {
  busca: string
  status: AdminFundoStatus
  pagina: number
  porPagina: AdminFundoPageSize
}): Promise<AdminFundoListResult> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_listar_fundos', {
    p_busca: input.busca || null,
    p_status: input.status,
    p_pagina: input.pagina,
    p_por_pagina: input.porPagina,
  })
  if (error) throw new Error('Nao foi possivel carregar os fundos.')
  return data as unknown as AdminFundoListResult
}

export async function obterAdminFundo(fundoId: string): Promise<AdminFundoDetalhe | null> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_obter_fundo', { p_fundo_id: fundoId })
  if (error) throw new Error('Nao foi possivel carregar o fundo.')
  return data as unknown as AdminFundoDetalhe | null
}

export async function listarAuditoriaAdminFundo(fundoId: string): Promise<AdminFundoAuditoriaItem[]> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_listar_auditoria_fundo', { p_fundo_id: fundoId })
  if (error) throw new Error('Nao foi possivel carregar a auditoria do fundo.')
  return (data || []) as unknown as AdminFundoAuditoriaItem[]
}
