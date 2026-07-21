'use client'

import { LogOut, Menu } from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { NotificationBell } from '@/components/ui/notification-bell'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import type { Profile } from '@/types/database'

const roleLabels: Record<string, string> = { gestor: 'Gestor', cedente: 'Cedente', sacado: 'Sacado', consultor: 'Consultor' }

export function PortalHeader({ profile, onToggleSidebar }: { profile: Profile | null; onToggleSidebar?: () => void }) {
  const initials = profile?.nome_completo?.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?'
  return <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-4 backdrop-blur-md sm:px-6">
    <Button variant="ghost" size="icon" className="lg:hidden" onClick={onToggleSidebar} aria-label="Abrir menu de navegação"><Menu size={20} /></Button>
    <div className="ml-auto flex items-center gap-2 sm:gap-4">
      <ThemeToggle />
      {profile?.id && <NotificationBell userId={profile.id} />}
      <div className="flex items-center gap-3 border-l border-border pl-3 sm:pl-4">
        <div className="hidden text-right sm:block"><p className="max-w-48 truncate text-sm font-semibold leading-tight">{profile?.nome_completo || 'Carregando...'}</p><p className="text-xs text-muted-foreground">{profile?.role ? roleLabels[profile.role] : ''}</p></div>
        <Avatar size="default"><AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">{initials}</AvatarFallback></Avatar>
        <form action={logout}><Button type="submit" variant="ghost" size="icon" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Sair"><LogOut size={17} /></Button></form>
      </div>
    </div>
  </header>
}
