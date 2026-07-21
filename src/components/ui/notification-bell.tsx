'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Bell } from 'lucide-react'

interface Notificacao {
  id: string
  titulo: string
  mensagem: string
  tipo: string
  lida: boolean
  created_at: string
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function NotificationBell({ userId }: { userId: string }) {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([])
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const naoLidas = notificacoes.filter((n) => !n.lida).length

  useEffect(() => {
    const supabase = createClient()

    const loadNotificacoes = async () => {
      const { data } = await supabase
        .from('notificacoes')
        .select('*')
        .eq('usuario_id', userId)
        .order('created_at', { ascending: false })
        .limit(10)

      const novas = (data || []) as Notificacao[]
      setNotificacoes((prev) => {
        const mudou = novas.length !== prev.length ||
          novas.some((n, i) => n.id !== prev[i]?.id || n.lida !== prev[i]?.lida)
        return mudou ? novas : prev
      })
    }

    loadNotificacoes()

    // Realtime — entrega imediata quando disponivel
    const channel = supabase
      .channel(`notificacoes-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notificacoes',
        filter: `usuario_id=eq.${userId}`,
      }, (payload) => {
        const nova = payload.new as Notificacao
        setNotificacoes((prev) => [nova, ...prev].slice(0, 10))
      })
      .subscribe()

    // Polling a cada 30s como fallback caso o Realtime nao entregue
    const interval = setInterval(loadNotificacoes, 30_000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [userId])

  // Fechar ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const marcarComoLida = async (notifId: string) => {
    const supabase = createClient()
    await supabase.from('notificacoes').update({ lida: true } as never).eq('id', notifId)
    setNotificacoes((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, lida: true } : n))
    )
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Notificacoes"
      >
        <Bell size={20} />
        {naoLidas > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-popover-foreground">Notificacoes</p>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notificacoes.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma notificacao.</p>
            ) : (
              notificacoes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => marcarComoLida(n.id)}
                  className={`w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted ${
                    !n.lida ? 'bg-primary/5' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!n.lida ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                        {n.titulo}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.mensagem}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-muted-foreground">{timeAgo(n.created_at)}</span>
                      {!n.lida && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
