import { SecurityPage } from '@/components/auth/security-page'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'

export default async function AdminMinhaSegurancaPage() {
  await requireSuperAdmin()
  return <SecurityPage />
}
