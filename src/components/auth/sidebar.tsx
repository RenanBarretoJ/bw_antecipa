import {
  LayoutDashboard, Users, FileText, CreditCard, Wallet, BarChart3, Settings,
  ShieldCheck, FileCheck, Receipt, Banknote, Bell, CheckSquare, History, Briefcase,
  Building2, UserCog,
} from 'lucide-react'
import { PortalSidebar, type PortalSidebarItem } from '@/components/layout/portal-sidebar'

export type SidebarItem = PortalSidebarItem
export { PortalSidebar as Sidebar }

export const gestorMenuItems: SidebarItem[] = [
  { label: 'Dashboard', href: '/gestor/dashboard', icon: LayoutDashboard },
  { label: 'Cedentes', href: '/gestor/cedentes', icon: Users },
  { label: 'Documentos', href: '/gestor/documentos', icon: FileText },
  { label: 'Notas Fiscais', href: '/gestor/notas-fiscais', icon: Receipt },
  { label: 'Operacoes', href: '/gestor/operacoes', icon: CreditCard },
  { label: 'Escrow', href: '/gestor/escrow', icon: Wallet },
  { label: 'Fundos', href: '/gestor/fundos', icon: Building2 },
  { label: 'Relatorios', href: '/gestor/relatorios', icon: BarChart3 },
  { label: 'Notificacoes', href: '/gestor/notificacoes', icon: Bell },
  { label: 'Configuracoes', href: '/gestor/configuracoes', icon: Settings },
  { label: 'Minha Seguranca', href: '/gestor/minha-conta/seguranca', icon: UserCog },
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
  { label: 'Minha Seguranca', href: '/cedente/minha-conta/seguranca', icon: UserCog },
]

export const sacadoMenuItems: SidebarItem[] = [
  { label: 'Dashboard', href: '/sacado/dashboard', icon: LayoutDashboard },
  { label: 'NFs Recebidas', href: '/sacado/notas-fiscais', icon: Receipt },
  { label: 'Aprovacao de Cessao', href: '/sacado/aprovacao', icon: CheckSquare },
  { label: 'Historico de Pagamentos', href: '/sacado/pagamentos', icon: History },
  { label: 'Notificacoes', href: '/sacado/notificacoes', icon: Bell },
  { label: 'Minha Seguranca', href: '/sacado/minha-conta/seguranca', icon: UserCog },
]

export const consultorMenuItems: SidebarItem[] = [
  { label: 'Dashboard', href: '/consultor/dashboard', icon: LayoutDashboard },
  { label: 'Minha Carteira', href: '/consultor/carteira', icon: Briefcase },
  { label: 'Operacoes', href: '/consultor/operacoes', icon: CreditCard },
  { label: 'Extratos Escrow', href: '/consultor/escrow', icon: Wallet },
  { label: 'Relatorios', href: '/consultor/relatorios', icon: BarChart3 },
  { label: 'Notificacoes', href: '/consultor/notificacoes', icon: Bell },
  { label: 'Minha Seguranca', href: '/consultor/minha-conta/seguranca', icon: UserCog },
]
