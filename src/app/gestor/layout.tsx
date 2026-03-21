'use client'

import { PortalLayout } from '@/components/auth/portal-layout'
import { gestorMenuItems } from '@/components/auth/sidebar'

export default function GestorLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalLayout requiredRole="gestor" menuItems={gestorMenuItems}>
      {children}
    </PortalLayout>
  )
}
