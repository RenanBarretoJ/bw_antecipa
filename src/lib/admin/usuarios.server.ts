import 'server-only'

import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import type {
  AdminFundoGestor,
  AdminUsuarioAuditoriaItem,
  AdminUsuarioDetalhe,
  AdminUsuarioFundo,
  AdminUsuarioListResult,
  AdminUsuarioPageSize,
  AdminUsuarioPapelFilter,
  AdminUsuarioResumo,
  AdminUsuarioStatusFilter,
  AdminUsuarioSuperAdminFilter,
} from '@/lib/admin/usuarios'

export async function carregarResumoAdminUsuarios(): Promise<AdminUsuarioResumo> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_resumo_usuarios')
  if (error) throw new Error('Nao foi possivel carregar o resumo de usuarios.')
  return data as unknown as AdminUsuarioResumo
}

export async function listarAdminUsuarios(input: {
  busca: string
  papel: AdminUsuarioPapelFilter
  status: AdminUsuarioStatusFilter
  superAdmin: AdminUsuarioSuperAdminFilter
  pagina: number
  porPagina: AdminUsuarioPageSize
}): Promise<AdminUsuarioListResult> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_listar_usuarios', {
    p_busca: input.busca || null,
    p_papel: input.papel,
    p_status: input.status,
    p_super_admin: input.superAdmin,
    p_pagina: input.pagina,
    p_por_pagina: input.porPagina,
  })
  if (error) throw new Error('Nao foi possivel carregar os usuarios.')
  return data as unknown as AdminUsuarioListResult
}

export async function obterAdminUsuario(usuarioId: string): Promise<AdminUsuarioDetalhe | null> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_obter_usuario', { p_usuario_id: usuarioId })
  if (error) throw new Error('Nao foi possivel carregar o usuario.')
  return data as unknown as AdminUsuarioDetalhe | null
}

export async function listarFundosAdminUsuario(usuarioId: string): Promise<AdminUsuarioFundo[]> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_listar_fundos_usuario', { p_usuario_id: usuarioId })
  if (error) throw new Error('Nao foi possivel carregar os fundos do usuario.')
  return (data || []) as unknown as AdminUsuarioFundo[]
}

export async function listarGestoresAdminFundo(fundoId: string): Promise<AdminFundoGestor[]> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_listar_gestores_fundo', { p_fundo_id: fundoId })
  if (error) throw new Error('Nao foi possivel carregar os gestores do fundo.')
  return (data || []) as unknown as AdminFundoGestor[]
}

export async function listarAuditoriaAdminUsuario(usuarioId: string): Promise<AdminUsuarioAuditoriaItem[]> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_listar_auditoria_usuario', { p_usuario_id: usuarioId })
  if (error) throw new Error('Nao foi possivel carregar a auditoria do usuario.')
  return (data || []) as unknown as AdminUsuarioAuditoriaItem[]
}
