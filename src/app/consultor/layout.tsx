'use client'

import { PortalLayout } from '@/components/auth/portal-layout'
import { consultorMenuItems } from '@/components/auth/sidebar'

export default function ConsultorLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalLayout requiredRole="consultor" menuItems={consultorMenuItems}>
      {children}
    </PortalLayout>
  )
}
