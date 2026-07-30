'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  carregarSinoNotificacoes,
  marcarNotificacaoComoLida,
  recontarNotificacoesNaoLidas,
} from '@/lib/actions/notificacoes-listagem'
import {
  compactarNotificacao,
  deduplicarNotificacoes,
  type NotificacaoListagemItem,
} from '@/lib/notificacoes/contracts'

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function NotificationBell({ userId }: { userId: string }) {
  const [items, setItems] = useState<NotificacaoListagemItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [supabase] = useState(() => createClient())
  const dropdownRef = useRef<HTMLDivElement>(null)
  const realtimeIdsRef = useRef(new Set<string>())

  useEffect(() => {
    let active = true
    void carregarSinoNotificacoes().then((page) => {
      if (!active || page.userId !== userId) return
      page.items.forEach((item) => realtimeIdsRef.current.add(item.id))
      setItems((current) => deduplicarNotificacoes([...current, ...page.items]).slice(0, 10))
      setUnreadCount(page.contadores?.naoLidas ?? 0)
    }).catch(() => {})

    const channel = supabase
      .channel(`notificacoes-bell-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notificacoes',
        filter: `usuario_id=eq.${userId}`,
      }, (payload) => {
        const newRow = payload.new as Record<string, unknown>
        const oldRow = payload.old as Record<string, unknown>

        if (payload.eventType === 'INSERT') {
          if (newRow.usuario_id !== userId) return
          const item = compactarNotificacao(newRow)
          if (!item || realtimeIdsRef.current.has(item.id)) return
          realtimeIdsRef.current.add(item.id)
          setItems((current) => deduplicarNotificacoes([item, ...current]).slice(0, 10))
          if (!item.lida) setUnreadCount((current) => current + 1)
          return
        }

        if (payload.eventType === 'UPDATE') {
          if (newRow.usuario_id !== userId) return
          const item = compactarNotificacao(newRow)
          if (!item) return
          setItems((current) => current.map((entry) => entry.id === item.id ? item : entry))
          if (typeof oldRow.lida === 'boolean' && oldRow.lida !== item.lida) {
            setUnreadCount((current) => Math.max(0, current + (item.lida ? -1 : 1)))
          }
          return
        }

        const deletedId = typeof oldRow.id === 'string' ? oldRow.id : null
        if (!deletedId) return
        realtimeIdsRef.current.delete(deletedId)
        setItems((current) => current.filter((item) => item.id !== deletedId))
        if (oldRow.lida === false) setUnreadCount((current) => Math.max(0, current - 1))
      })
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [supabase, userId])

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function markAsRead(item: NotificacaoListagemItem) {
    if (item.lida) return
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, lida: true } : entry))
    setUnreadCount((current) => Math.max(0, current - 1))
    const result = await marcarNotificacaoComoLida(item.id)
    if (!result.success) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, lida: false } : entry))
      try {
        const counts = await recontarNotificacoesNaoLidas()
        setUnreadCount(counts.naoLidas)
      } catch {
        // A próxima navegação ou evento realtime reconcilia o contador.
      }
    } else if (result.contadores) {
      setUnreadCount(result.contadores.naoLidas)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Notificações"
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-popover-foreground">Notificações</p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma notificação.</p>
            ) : items.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => markAsRead(item)}
                className={`w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted ${!item.lida ? 'bg-primary/5' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${!item.lida ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{item.titulo}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.mensagem}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">{timeAgo(item.createdAt)}</span>
                    {!item.lida && <span className="size-2 rounded-full bg-primary" />}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
