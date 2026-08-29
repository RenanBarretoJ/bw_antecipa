'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { requireRoleRedirect } from '@/lib/auth/role-routing'
import type { Profile, UserRole } from '@/types/database'
import { PortalHeader, type PortalAreaLink } from './portal-header'
import { PortalSidebar, type PortalSidebarItem } from './portal-sidebar'
import { FundoAtivoProvider } from '@/components/fundos/fundo-ativo-provider'
import { MfaSessionProvider } from '@/components/auth/mfa-session-provider'

export function PortalShell({ children, requiredRole, menuItems }: { children: ReactNode; requiredRole: UserRole; menuItems: PortalSidebarItem[] }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [areaLink, setAreaLink] = useState<PortalAreaLink | null>(null)
  const router = useRouter()
  useEffect(() => {
    let mounted = true
    const load = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Ate 3 tentativas com pausa curta: cobre a janela de corrida entre o
      // signup (auth.users) e o trigger que cria a linha em profiles --
      // sem isso, um login imediatamente apos o cadastro podia achar
      // profiles vazio e cair no branch abaixo, que so redirecionava (sem
      // setLoading(false)); se o destino calculado for a MESMA rota atual,
      // o router.push e um no-op e a tela fica travada em "Carregando
      // portal..." para sempre (bug confirmado ao vivo em homolog).
      let profileData: Profile | null = null
      for (let attempt = 0; attempt < 3 && mounted; attempt += 1) {
        const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
        profileData = data as Profile | null
        if (profileData || attempt === 2) break
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
      if (!mounted) return
      if (!profileData || profileData.role !== requiredRole) {
        setLoading(false)
        router.push(requireRoleRedirect(profileData?.role))
        return
      }
      let nextAreaLink: PortalAreaLink | null = null
      if (profileData.role === 'gestor') {
        const { data: adminRole } = await supabase
          .from('usuario_papeis')
          .select('papel')
          .eq('usuario_id', user.id)
          .eq('papel', 'super_admin')
          .eq('ativo', true)
          .maybeSingle()
        if (adminRole) nextAreaLink = { href: '/admin', label: 'Administração' }
      }
      if (mounted) { setProfile(profileData); setAreaLink(nextAreaLink); setLoading(false) }
    }
    void load()
    return () => { mounted = false }
  }, [requiredRole, router])
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background"><div className="flex flex-col items-center gap-3 text-center"><Loader2 size={28} className="animate-spin text-primary" /><p className="text-sm text-muted-foreground">Carregando portal...</p></div></div>
  return <MfaSessionProvider><FundoAtivoProvider enabled={requiredRole === 'gestor'}><div className="flex h-dvh min-h-0 overflow-hidden bg-background"><PortalSidebar items={menuItems} role={requiredRole} open={sidebarOpen} onClose={() => setSidebarOpen(false)} /><div className="flex min-w-0 flex-1 flex-col"><PortalHeader profile={profile} areaLink={areaLink} onToggleSidebar={() => setSidebarOpen(true)} /><main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-5 sm:pt-6 lg:pt-8">{children}</main></div></div></FundoAtivoProvider></MfaSessionProvider>
}
