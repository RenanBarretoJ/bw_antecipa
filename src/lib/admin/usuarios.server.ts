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
  AdminVinculoBuscaDirecao,
  AdminVinculoBuscaResult,
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

export async function buscarVinculosAdmin(input: {
  direcao: AdminVinculoBuscaDirecao
  contextoId: string
  busca: string
  pagina: number
}): Promise<AdminVinculoBuscaResult> {
  const context = await requireSuperAdmin()
  const chamada = input.direcao === 'gestores_para_fundo'
    ? context.supabase.rpc('admin_buscar_gestores_para_fundo', {
        p_fundo_id: input.contextoId,
        p_busca: input.busca,
        p_pagina: input.pagina,
        p_por_pagina: 20,
      })
    : context.supabase.rpc('admin_buscar_fundos_para_gestor', {
        p_usuario_id: input.contextoId,
        p_busca: input.busca,
        p_pagina: input.pagina,
        p_por_pagina: 20,
      })
  const { data, error } = await chamada
  if (error) throw new Error('Nao foi possivel buscar candidatos ao vinculo.')
  return data as unknown as AdminVinculoBuscaResult
}

export async function listarAuditoriaAdminUsuario(usuarioId: string): Promise<AdminUsuarioAuditoriaItem[]> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_listar_auditoria_usuario', { p_usuario_id: usuarioId })
  if (error) throw new Error('Nao foi possivel carregar a auditoria do usuario.')
  return (data || []) as unknown as AdminUsuarioAuditoriaItem[]
}
