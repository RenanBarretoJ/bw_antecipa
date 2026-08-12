import type { UserRole } from '@/lib/types/domain'

export function requireRoleRedirect(
  role: UserRole | null | undefined,
  options?: { cedenteAprovado?: boolean },
): string {
  const resolvedRole = role || 'cedente'
  if (resolvedRole === 'cedente' && options?.cedenteAprovado === false) {
    return '/cedente/cadastro'
  }

  const dashboards: Record<UserRole, string> = {
    gestor: '/gestor/dashboard',
    cedente: '/cedente/dashboard',
    sacado: '/sacado/dashboard',
    consultor: '/consultor/dashboard',
    super_admin: '/admin',
  }
  return dashboards[resolvedRole]
}
