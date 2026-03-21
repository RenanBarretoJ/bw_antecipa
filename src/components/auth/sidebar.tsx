'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  FileText,
  CreditCard,
  Wallet,
  BarChart3,
  Settings,
  ShieldCheck,
  FileCheck,
  Receipt,
  Banknote,
  Bell,
  CheckSquare,
  History,
  Briefcase,
  type LucideIcon,
} from 'lucide-react'

export interface SidebarItem {
  label: string
  href: string
  icon: LucideIcon
}

interface SidebarProps {
  items: SidebarItem[]
  role: string
}

export function Sidebar({ items, role }: SidebarProps) {
  const pathname = usePathname()

  const roleColors: Record<string, string> = {
    gestor: 'bg-purple-600',
    cedente: 'bg-blue-600',
    sacado: 'bg-emerald-600',
    consultor: 'bg-amber-600',
  }

  const roleLabels: Record<string, string> = {
    gestor: 'Gestor',
    cedente: 'Cedente',
    sacado: 'Sacado',
    consultor: 'Consultor',
  }

  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen flex flex-col">
      <div className="p-6 border-b border-gray-800">
        <h2 className="text-lg font-bold">BW Antecipa</h2>
        <span className={`inline-block mt-2 px-2.5 py-0.5 text-xs font-medium rounded-full text-white ${roleColors[role] || 'bg-gray-600'}`}>
          {roleLabels[role] || role}
        </span>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {items.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}

// Configuracoes de menu por role
export const gestorMenuItems: SidebarItem[] = [
  { label: 'Dashboard', href: '/gestor/dashboard', icon: LayoutDashboard },
  { label: 'Cedentes', href: '/gestor/cedentes', icon: Users },
  { label: 'Documentos', href: '/gestor/documentos', icon: FileText },
  { label: 'Operacoes', href: '/gestor/operacoes', icon: CreditCard },
  { label: 'Escrow', href: '/gestor/escrow', icon: Wallet },
  { label: 'Relatorios', href: '/gestor/relatorios', icon: BarChart3 },
  { label: 'Configuracoes', href: '/gestor/configuracoes', icon: Settings },
  { label: 'Auditoria', href: '/gestor/auditoria', icon: ShieldCheck },
]

export const cedenteMenuItems: SidebarItem[] = [
  { label: 'Dashboard', href: '/cedente/dashboard', icon: LayoutDashboard },
  { label: 'Meus Documentos', href: '/cedente/documentos', icon: FileCheck },
  { label: 'Minhas NFs', href: '/cedente/notas-fiscais', icon: Receipt },
  { label: 'Minhas Operacoes', href: '/cedente/operacoes', icon: Banknote },
  { label: 'Extrato', href: '/cedente/extrato', icon: Wallet },
  { label: 'Notificacoes', href: '/cedente/notificacoes', icon: Bell },
]

export const sacadoMenuItems: SidebarItem[] = [
  { label: 'Dashboard', href: '/sacado/dashboard', icon: LayoutDashboard },
  { label: 'NFs Recebidas', href: '/sacado/notas-fiscais', icon: Receipt },
  { label: 'Aceite de Cessao', href: '/sacado/aceite', icon: CheckSquare },
  { label: 'Historico de Pagamentos', href: '/sacado/pagamentos', icon: History },
  { label: 'Notificacoes', href: '/sacado/notificacoes', icon: Bell },
]

export const consultorMenuItems: SidebarItem[] = [
  { label: 'Dashboard', href: '/consultor/dashboard', icon: LayoutDashboard },
  { label: 'Minha Carteira', href: '/consultor/carteira', icon: Briefcase },
  { label: 'Operacoes', href: '/consultor/operacoes', icon: CreditCard },
  { label: 'Relatorios', href: '/consultor/relatorios', icon: BarChart3 },
  { label: 'Notificacoes', href: '/consultor/notificacoes', icon: Bell },
]
