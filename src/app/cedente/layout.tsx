'use client'

import { useEffect, useState } from 'react'
import { PortalLayout } from '@/components/auth/portal-layout'
import { cedenteMenuItems, type SidebarItem } from '@/components/auth/sidebar'
import { isCedenteAprovado, isCedentePathPermitidoDuranteOnboarding } from '@/lib/auth/cedente-onboarding-access'
import { createClient } from '@/lib/supabase/client'

const cedenteMenuSemExtrato = cedenteMenuItems.filter((item) => item.href !== '/cedente/extrato')
const cedenteMenuDuranteOnboarding = cedenteMenuItems.filter((item) => (
  isCedentePathPermitidoDuranteOnboarding(item.href)
))

export default function CedenteLayout({ children }: { children: React.ReactNode }) {
  const [menuItems, setMenuItems] = useState<SidebarItem[]>(cedenteMenuDuranteOnboarding)

  useEffect(() => {
    const loadEscrow = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('cedentes')
        .select('status, habilitar_escrow')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!isCedenteAprovado(data?.status)) return
      setMenuItems(data?.habilitar_escrow ? cedenteMenuItems : cedenteMenuSemExtrato)
    }

    loadEscrow()
  }, [])

  return (
    <PortalLayout requiredRole="cedente" menuItems={menuItems}>
      {children}
    </PortalLayout>
  )
}
