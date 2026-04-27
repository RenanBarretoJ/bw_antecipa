'use client'

import { useEffect, useState } from 'react'
import { PortalLayout } from '@/components/auth/portal-layout'
import { cedenteMenuItems, type SidebarItem } from '@/components/auth/sidebar'
import { createClient } from '@/lib/supabase/client'

const cedenteMenuSemExtrato = cedenteMenuItems.filter((item) => item.href !== '/cedente/extrato')

export default function CedenteLayout({ children }: { children: React.ReactNode }) {
  const [menuItems, setMenuItems] = useState<SidebarItem[]>(cedenteMenuSemExtrato)

  useEffect(() => {
    const loadEscrow = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('cedentes')
        .select('habilitar_escrow')
        .eq('user_id', user.id)
        .single()

      if (data && (data as { habilitar_escrow: boolean }).habilitar_escrow) {
        setMenuItems(cedenteMenuItems)
      }
    }

    loadEscrow()
  }, [])

  return (
    <PortalLayout requiredRole="cedente" menuItems={menuItems}>
      {children}
    </PortalLayout>
  )
}
