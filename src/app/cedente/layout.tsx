'use client'

import { PortalLayout } from '@/components/auth/portal-layout'
import { cedenteMenuItems } from '@/components/auth/sidebar'

export default function CedenteLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalLayout requiredRole="cedente" menuItems={cedenteMenuItems}>
      {children}
    </PortalLayout>
  )
}
