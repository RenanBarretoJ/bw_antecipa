import type { AuthContext, AppSupabaseClient } from '@/lib/auth/authorization'

export type PermissaoSistema = 'cedentes.vincular_fundo'

const PERFIS_VINCULAR_FUNDO = new Set(['administrador', 'gestor', 'plataforma'])

export async function usuarioPossuiPermissao(
  context: AuthContext,
  permissao: PermissaoSistema,
  options?: { fundoId?: string; client?: AppSupabaseClient },
): Promise<boolean> {
  if (permissao !== 'cedentes.vincular_fundo') return false
  if (context.profile.role !== 'gestor') return false

  const supabase = options?.client ?? context.supabase
  let query = supabase
    .from('usuario_fundos')
    .select('perfil_no_fundo')
    .eq('usuario_id', context.user.id)
    .eq('status', 'ativo')

  if (options?.fundoId) query = query.eq('fundo_id', options.fundoId)

  const { data, error } = await query
  if (error) return false

  return (data || []).some((row) => PERFIS_VINCULAR_FUNDO.has(String((row as { perfil_no_fundo?: string }).perfil_no_fundo || '')))
}

export async function requirePermissao(
  context: AuthContext,
  permissao: PermissaoSistema,
  options?: { fundoId?: string; client?: AppSupabaseClient },
): Promise<void> {
  const allowed = await usuarioPossuiPermissao(context, permissao, options)
  if (!allowed) throw new Error('Usuario sem permissao cedentes.vincular_fundo para este fundo.')
}
