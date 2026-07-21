'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PortalSidebarItem {
  label: string
  href: string
  icon: LucideIcon
}

const roleLabels: Record<string, string> = { gestor: 'Gestor', cedente: 'Cedente', sacado: 'Sacado', consultor: 'Consultor' }
const roleColors: Record<string, string> = {
  gestor: 'bg-sidebar-accent text-sidebar-accent-foreground', cedente: 'bg-sidebar-accent text-sidebar-accent-foreground',
  sacado: 'bg-sidebar-accent text-sidebar-accent-foreground', consultor: 'bg-sidebar-accent text-sidebar-accent-foreground',
}

export function PortalSidebar({ items, role, open = false, onClose }: { items: PortalSidebarItem[]; role: string; open?: boolean; onClose?: () => void }) {
  const pathname = usePathname()
  const content = (
    <>
      <div className="px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary/20 text-sm font-bold text-sidebar-primary">BW</div>
            <div className="min-w-0"><p className="truncate text-sm font-semibold tracking-tight">Antecipa</p><span className={cn('mt-1 inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold', roleColors[role] || 'bg-muted/20 text-sidebar-foreground')}>{roleLabels[role] || role}</span></div>
          </div>
          {onClose && <button type="button" onClick={onClose} className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden" aria-label="Fechar menu"><X size={18} /></button>}
        </div>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Navegação principal">
        <ul className="space-y-1">
          {items.map((item) => {
            const Icon = item.icon
            const active = pathname === item.href || (item.href !== `/${role}/dashboard` && pathname.startsWith(`${item.href}/`))
            return <li key={item.href}><Link href={item.href} onClick={onClose} aria-current={active ? 'page' : undefined} className={cn('flex min-h-10 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors', active ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground')}><Icon size={18} aria-hidden="true" className={cn(active ? 'text-sidebar-primary-foreground' : 'text-sidebar-foreground/70')} /><span className="truncate">{item.label}</span></Link></li>
          })}
        </ul>
      </nav>
      <div className="border-t border-sidebar-border px-5 py-4"><p className="text-[10px] text-sidebar-foreground/40">BW BI LTDA</p></div>
    </>
  )
  return <>
    {open && <button type="button" aria-label="Fechar menu" onClick={onClose} className="fixed inset-0 z-40 bg-foreground/60 transition-opacity lg:hidden" />}
    <aside aria-label={`Menu ${roleLabels[role] || role}`} className={cn('fixed inset-y-0 left-0 z-50 flex h-dvh w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:translate-x-0 lg:shadow-none', open ? 'translate-x-0' : '-translate-x-full')}>{content}</aside>
  </>
}
