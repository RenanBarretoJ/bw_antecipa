import type { SupabaseClient } from '@supabase/supabase-js'
import { isCedenteAprovado } from '@/lib/auth/cedente-onboarding-access'
import type { Database, UserRole } from '@/types/database'

export type PlataformaAccessSnapshot = {
  primaryRole: UserRole
  roles: UserRole[]
  gestorPossuiFundoAtivo: boolean
  cedenteAprovado?: boolean
}

export type PortalArea = Exclude<UserRole, 'super_admin'> | 'admin'

export function usuarioPodeAcessarArea(access: PlataformaAccessSnapshot, area: PortalArea): boolean {
  if (area === 'admin') return access.roles.includes('super_admin')
  return access.primaryRole === area
}

export function resolverDestinoAposAutenticacao(access: PlataformaAccessSnapshot): string {
  if (access.roles.includes('super_admin')) return '/admin'
  if (access.primaryRole === 'super_admin') return '/'
  if (access.primaryRole === 'gestor') {
    return access.gestorPossuiFundoAtivo ? '/gestor/dashboard' : '/gestor/sem-fundo'
  }
  if (access.primaryRole === 'cedente' && access.cedenteAprovado === false) return '/cedente/cadastro'

  const dashboards: Record<Exclude<UserRole, 'super_admin'>, string> = {
    gestor: '/gestor/dashboard',
    cedente: '/cedente/dashboard',
    sacado: '/sacado/dashboard',
    consultor: '/consultor/dashboard',
  }

  return dashboards[access.primaryRole]
}

export async function listarPapeisAtivosUsuario(
  client: SupabaseClient<Database>,
  userId: string,
  primaryRole: UserRole,
): Promise<UserRole[]> {
  const { data, error } = await client
    .from('usuario_papeis')
    .select('papel')
    .eq('usuario_id', userId)
    .eq('ativo', true)

  if (error) throw new Error('Nao foi possivel validar os papeis do usuario.')

  const roles = new Set<UserRole>(primaryRole === 'super_admin' ? [] : [primaryRole])
  for (const row of data || []) roles.add(row.papel)
  return [...roles]
}

export async function usuarioPossuiFundoAtivo(client: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data, error } = await client
    .from('usuario_fundos')
    .select('id')
    .eq('usuario_id', userId)
    .eq('status', 'ativo')
    .limit(1)
    .maybeSingle()

  if (error) throw new Error('Nao foi possivel validar os fundos autorizados.')
  return Boolean(data)
}

export async function carregarAcessoPlataforma(
  client: SupabaseClient<Database>,
  userId: string,
  primaryRole: UserRole,
): Promise<PlataformaAccessSnapshot> {
  const roles = await listarPapeisAtivosUsuario(client, userId, primaryRole)
  const gestorPossuiFundoAtivo = roles.includes('gestor')
    ? await usuarioPossuiFundoAtivo(client, userId)
    : false

  let cedenteAprovado: boolean | undefined
  if (primaryRole === 'cedente') {
    const { data, error } = await client
      .from('cedentes')
      .select('status')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw new Error('Nao foi possivel validar o cadastro do cedente.')
    cedenteAprovado = isCedenteAprovado(data?.status)
  }

  return { primaryRole, roles, gestorPossuiFundoAtivo, cedenteAprovado }
}
