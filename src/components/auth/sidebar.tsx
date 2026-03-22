'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
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
  open?: boolean
  onClose?: () => void
}

export function Sidebar({ items, role, open, onClose }: SidebarProps) {
  const pathname = usePathname()

  const roleColors: Record<string, string> = {
    gestor: 'bg-purple-500/20 text-purple-300',
    cedente: 'bg-blue-500/20 text-blue-300',
    sacado: 'bg-emerald-500/20 text-emerald-300',
    consultor: 'bg-amber-500/20 text-amber-300',
  }

  const roleLabels: Record<string, string> = {
    gestor: 'Gestor',
    cedente: 'Cedente',
    sacado: 'Sacado',
    consultor: 'Consultor',
  }

  const sidebarContent = (
    <>
      <div className="p-5 border-b border-sidebar-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sidebar-primary/20 flex items-center justify-center text-sidebar-primary font-bold text-sm">
              BW
            </div>
            <div>
              <h2 className="text-sm font-bold text-sidebar-foreground tracking-tight">Antecipa</h2>
              <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md mt-0.5 ${roleColors[role] || 'bg-gray-500/20 text-gray-300'}`}>
                {roleLabels[role] || role}
              </span>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              aria-label="Fechar menu"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {items.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-foreground shadow-sm'
                  : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
              }`}
            >
              <Icon size={18} className={isActive ? 'text-sidebar-primary' : ''} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <p className="text-[10px] text-sidebar-foreground/30 text-center">Blue Wave Asset</p>
      </div>
    </>
  )

  return (
    <>
      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden animate-in fade-in duration-200"
          onClick={onClose}
        />
      )}

      {/* Sidebar mobile (drawer) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-sidebar text-sidebar-foreground flex flex-col transition-transform duration-300 ease-in-out lg:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Sidebar desktop */}
      <aside className="hidden lg:flex w-64 bg-sidebar text-sidebar-foreground min-h-screen flex-col sticky top-0 h-screen">
        {sidebarContent}
      </aside>
    </>
  )
}

// Configuracoes de menu por role
export const gestorMenuItems: SidebarItem[] = [
  { label: 'Dashboard', href: '/gestor/dashboard', icon: LayoutDashboard },
  { label: 'Cedentes', href: '/gestor/cedentes', icon: Users },
  { label: 'Documentos', href: '/gestor/documentos', icon: FileText },
  { label: 'Notas Fiscais', href: '/gestor/notas-fiscais', icon: Receipt },
  { label: 'Operacoes', href: '/gestor/operacoes', icon: CreditCard },
  { label: 'Escrow', href: '/gestor/escrow', icon: Wallet },
  { label: 'Relatorios', href: '/gestor/relatorios', icon: BarChart3 },
  { label: 'Configuracoes', href: '/gestor/configuracoes', icon: Settings },
  { label: 'Auditoria', href: '/gestor/auditoria', icon: ShieldCheck },
]

export const cedenteMenuItems: SidebarItem[] = [
  { label: 'Dashboard', href: '/cedente/dashboard', icon: LayoutDashboard },
  { label: 'Cadastro', href: '/cedente/cadastro', icon: Users },
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
  { label: 'Extratos Escrow', href: '/consultor/escrow', icon: Wallet },
  { label: 'Relatorios', href: '/consultor/relatorios', icon: BarChart3 },
  { label: 'Notificacoes', href: '/consultor/notificacoes', icon: Bell },
]
