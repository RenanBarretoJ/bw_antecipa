'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { requireRoleRedirect } from '@/lib/auth/role-routing'
import type { Profile, UserRole } from '@/types/database'
import { PortalHeader } from './portal-header'
import { PortalSidebar, type PortalSidebarItem } from './portal-sidebar'

export function PortalShell({ children, requiredRole, menuItems }: { children: ReactNode; requiredRole: UserRole; menuItems: PortalSidebarItem[] }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const router = useRouter()
  useEffect(() => {
    let mounted = true
    const load = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      const profileData = data as Profile | null
      if (!profileData || profileData.role !== requiredRole) { router.push(requireRoleRedirect(profileData?.role)); return }
      if (mounted) { setProfile(profileData); setLoading(false) }
    }
    void load()
    return () => { mounted = false }
  }, [requiredRole, router])
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background"><div className="flex flex-col items-center gap-3 text-center"><Loader2 size={28} className="animate-spin text-primary" /><p className="text-sm text-muted-foreground">Carregando portal...</p></div></div>
  return <div className="flex h-dvh min-h-0 overflow-hidden bg-background"><PortalSidebar items={menuItems} role={requiredRole} open={sidebarOpen} onClose={() => setSidebarOpen(false)} /><div className="flex min-w-0 flex-1 flex-col"><PortalHeader profile={profile} onToggleSidebar={() => setSidebarOpen(true)} /><main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-5 sm:pt-6 lg:pt-8">{children}</main></div></div>
}
