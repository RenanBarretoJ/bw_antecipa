'use client'

import { useEffect, useState } from 'react'
import { PortalLayout } from '@/components/auth/portal-layout'
import { cedenteMenuItems, type SidebarItem } from '@/components/auth/sidebar'
import { isCedenteAprovado, isCedentePathPermitidoDuranteOnboarding } from '@/lib/auth/cedente-onboarding-access'
import { createClient } from '@/lib/supabase/client'

const cedenteMenuDuranteOnboarding = cedenteMenuItems.filter((item) => (
  isCedentePathPermitidoDuranteOnboarding(item.href)
))

export default function CedenteLayout({ children }: { children: React.ReactNode }) {
  const [menuItems, setMenuItems] = useState<SidebarItem[]>(cedenteMenuDuranteOnboarding)

  useEffect(() => {
    const loadMenu = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // get_user_cedente_id() resolve tanto o dono (cedentes.user_id) quanto
      // um usuario convidado via cedente_acessos (perfil administrador/
      // operador) -- filtrar so por user_id deixava usuarios convidados
      // presos no menu restrito de onboarding para sempre, mesmo com o
      // cedente ativo (bug confirmado ao vivo em homolog).
      const { data: cedenteId } = await supabase.rpc('get_user_cedente_id')
      if (!cedenteId) return

      const { data } = await supabase
        .from('cedentes')
        .select('id, status, habilitar_escrow, permite_cadastro_filiais')
        .eq('id', cedenteId)
        .maybeSingle()

      if (!isCedenteAprovado(data?.status)) return

      let itens = cedenteMenuItems
      if (!data?.habilitar_escrow) itens = itens.filter((item) => item.href !== '/cedente/extrato')

      if (!data?.permite_cadastro_filiais && data?.id) {
        const { count } = await supabase
          .from('cedente_estabelecimentos')
          .select('id', { count: 'exact', head: true })
          .eq('cedente_id', data.id)
          .eq('tipo', 'filial')
        if (!count) itens = itens.filter((item) => item.href !== '/cedente/estabelecimentos')
      }

      setMenuItems(itens)
    }

    loadMenu()
  }, [])

  return (
    <PortalLayout requiredRole="cedente" menuItems={menuItems}>
      {children}
    </PortalLayout>
  )
}
