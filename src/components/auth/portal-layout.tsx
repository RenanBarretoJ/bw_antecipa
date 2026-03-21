'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sidebar, type SidebarItem } from './sidebar'
import { Header } from './header'
import type { Profile, UserRole } from '@/types/database'

interface PortalLayoutProps {
  children: ReactNode
  requiredRole: UserRole
  menuItems: SidebarItem[]
}

export function PortalLayout({ children, requiredRole, menuItems }: PortalLayoutProps) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-500 mt-3">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar items={menuItems} role={requiredRole} />
      <div className="flex-1 flex flex-col">
        <Header profile={profile} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
