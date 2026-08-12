import 'server-only'

import { AuthorizationError, requireAuthenticated, type AppSupabaseClient, type AuthContext } from '@/lib/auth/authorization'
import { listarPapeisAtivosUsuario } from '@/lib/auth/platform-access'
import type { UserRole } from '@/types/database'

export async function requireSuperAdmin(client?: AppSupabaseClient): Promise<AuthContext & { roles: UserRole[] }> {
  const context = await requireAuthenticated(client)
  let roles: UserRole[]
  try {
    roles = await listarPapeisAtivosUsuario(context.supabase, context.user.id, context.profile.role)
  } catch {
    throw new AuthorizationError('Nao foi possivel validar o acesso administrativo.', 'FORBIDDEN')
  }

  if (!roles.includes('super_admin')) {
    throw new AuthorizationError('Acesso restrito a administradores da plataforma.', 'FORBIDDEN')
  }

  return { ...context, roles }
}
