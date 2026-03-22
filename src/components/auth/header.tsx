'use client'

import { LogOut } from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { NotificationBell } from '@/components/ui/notification-bell'
import type { Profile } from '@/types/database'

interface HeaderProps {
  profile: Profile | null
}

export function Header({ profile }: HeaderProps) {
  const roleLabels: Record<string, string> = {
    gestor: 'Gestor',
    cedente: 'Cedente',
    sacado: 'Sacado',
    consultor: 'Consultor',
  }

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div />

      <div className="flex items-center gap-4">
        {profile?.id && <NotificationBell userId={profile.id} />}

        <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
          <div className="text-right">
            <p className="text-sm font-medium text-gray-900">
              {profile?.nome_completo || 'Carregando...'}
            </p>
            <p className="text-xs text-gray-500">
              {profile?.role ? roleLabels[profile.role] : ''}
            </p>
          </div>

          <form action={logout}>
            <button
              type="submit"
              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              aria-label="Sair"
            >
              <LogOut size={18} />
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
