import { notFound } from 'next/navigation'
import { AdminShell } from '@/components/admin/admin-shell'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let context: Awaited<ReturnType<typeof requireSuperAdmin>>
  try {
    context = await requireSuperAdmin()
  } catch {
    notFound()
  }

  return (
    <AdminShell
      profile={{ id: context.profile.id, nome_completo: context.profile.nome_completo, role: 'super_admin' }}
      gestorAreaDisponivel={context.roles.includes('gestor')}
    >
      {children}
    </AdminShell>
  )
}
