'use client'

import { useState, type ReactNode } from 'react'
import { MfaSessionProvider } from '@/components/auth/mfa-session-provider'
import { adminMenuItems } from '@/components/auth/sidebar'
import { PortalHeader, type PortalAreaLink, type PortalHeaderProfile } from '@/components/layout/portal-header'
import { PortalSidebar } from '@/components/layout/portal-sidebar'

export function AdminShell({
  children,
  profile,
  gestorAreaDisponivel,
}: {
  children: ReactNode
  profile: PortalHeaderProfile
  gestorAreaDisponivel: boolean
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const areaLink: PortalAreaLink | null = gestorAreaDisponivel
    ? { href: '/gestor/dashboard', label: 'Gestao do fundo' }
    : null

  return (
    <MfaSessionProvider>
      <div className="flex h-dvh min-h-0 overflow-hidden bg-background">
        <PortalSidebar items={adminMenuItems} role="super_admin" open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <PortalHeader profile={profile} areaLink={areaLink} onToggleSidebar={() => setSidebarOpen(true)} />
          <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-5 sm:pt-6 lg:pt-8">{children}</main>
        </div>
      </div>
    </MfaSessionProvider>
  )
}
