'use client'

import { PortalLayout } from '@/components/auth/portal-layout'
import { sacadoMenuItems } from '@/components/auth/sidebar'

export default function SacadoLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalLayout requiredRole="sacado" menuItems={sacadoMenuItems}>
      {children}
    </PortalLayout>
  )
}
