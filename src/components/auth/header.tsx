'use client'

import { LogOut, Menu } from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { NotificationBell } from '@/components/ui/notification-bell'
import { Button } from '@/components/ui/button'
import type { Profile } from '@/types/database'

interface HeaderProps {
  profile: Profile | null
  onToggleSidebar?: () => void
}

const roleLabels: Record<string, string> = {
  gestor: 'Gestor',
  cedente: 'Cedente',
  sacado: 'Sacado',
  consultor: 'Consultor',
}

export function Header({ profile, onToggleSidebar }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 h-14 bg-card/80 backdrop-blur-md border-b border-border flex items-center justify-between px-4 lg:px-6">
      <div className="flex items-center gap-3">
        {onToggleSidebar && (
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onToggleSidebar}
            aria-label="Abrir menu"
          >
            <Menu size={20} />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {profile?.id && <NotificationBell userId={profile.id} />}

        <div className="flex items-center gap-3 pl-3 ml-1 border-l border-border">
          <div className="hidden sm:block text-right">
            <p className="text-sm font-medium text-foreground leading-tight">
              {profile?.nome_completo || 'Carregando...'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {profile?.role ? roleLabels[profile.role] : ''}
            </p>
          </div>

          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
            {profile?.nome_completo?.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?'}
          </div>

          <form action={logout}>
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              aria-label="Sair"
            >
              <LogOut size={16} />
            </Button>
          </form>
        </div>
      </div>
    </header>
  )
}
