import 'server-only'

import type { AuthContext } from '@/lib/auth/authorization'
import { requireRole } from '@/lib/auth/authorization'
import type { SacadoAcesso } from './acessos'
export { normalizarCnpjSacado } from './acessos'

export type ContextoSacado = {
  auth: AuthContext
  acessos: SacadoAcesso[]
}

/** Resolve explicit active company/fund memberships exclusively from the session. */
export async function resolverContextoSacado(): Promise<ContextoSacado> {
  const auth = await requireRole('sacado')
  if (auth.profile.status !== 'ativo') {
    throw new Error('O perfil do sacado nao esta ativo.')
  }

  const { data, error } = await auth.supabase.rpc('get_user_sacado_context')
  if (error) throw new Error('Nao foi possivel consultar os acessos do Sacado.')
  const acessos = data ?? []
  if (acessos.some(a => a.user_id !== auth.user.id || !/^\d{14}$/.test(a.cnpj) || a.status !== 'ativo')) {
    throw new Error('Contexto de acesso do Sacado invalido.')
  }
  return { auth, acessos }
}
