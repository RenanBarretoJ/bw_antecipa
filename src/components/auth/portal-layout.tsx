'use client'

import type { ReactNode } from 'react'
import type { SidebarItem } from './sidebar'
import type { UserRole } from '@/types/database'
import { PortalShell } from '@/components/layout/portal-shell'

interface PortalLayoutProps {
  children: ReactNode
  requiredRole: UserRole
  menuItems: SidebarItem[]
}

export function PortalLayout({ children, requiredRole, menuItems }: PortalLayoutProps) {
  return <PortalShell requiredRole={requiredRole} menuItems={menuItems}>{children}</PortalShell>
}
