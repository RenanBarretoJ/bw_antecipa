'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sidebar, type SidebarItem } from './sidebar'
import { Header } from './header'
import type { Profile, UserRole } from '@/types/database'
import { Loader2 } from 'lucide-react'

interface PortalLayoutProps {
  children: ReactNode
  requiredRole: UserRole
  menuItems: SidebarItem[]
}

export function PortalLayout({ children, requiredRole, menuItems }: PortalLayoutProps) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const loadProfile = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      const profileData = data as Profile | null

      if (!profileData || profileData.role !== requiredRole) {
        const dashboards: Record<string, string> = {
          gestor: '/gestor/dashboard',
          cedente: '/cedente/dashboard',
          sacado: '/sacado/dashboard',
          consultor: '/consultor/dashboard',
        }
        router.push(dashboards[profileData?.role || 'cedente'] || '/cedente/dashboard')
        return
      }

      setProfile(profileData)
      setLoading(false)
    }

    loadProfile()
  }, [requiredRole, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Loader2 size={32} className="text-primary animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        items={menuItems}
        role={requiredRole}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          profile={profile}
          onToggleSidebar={() => setSidebarOpen(true)}
        />
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}
