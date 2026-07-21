import type { UserRole } from '@/lib/types/domain'

export function requireRoleRedirect(role: UserRole | null | undefined): string {
  const dashboards: Record<UserRole, string> = {
    gestor: '/gestor/dashboard',
    cedente: '/cedente/dashboard',
    sacado: '/sacado/dashboard',
    consultor: '/consultor/dashboard',
  }
  return dashboards[role || 'cedente']
}
