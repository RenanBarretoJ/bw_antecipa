'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  getNotificationDuration,
  notificationFromActionResult,
  shouldMergeNotifications,
  type ActionNotificationResult,
  type NotificationInput,
  type NotificationType,
} from '@/lib/notifications'

type NotificationItem = NotificationInput & {
  id: string
  count: number
  createdAt: number
}

type NotificationContextValue = {
  notify: (notification: NotificationInput) => string
  dismiss: (id: string) => void
  clear: () => void
  fromActionResult: (result: ActionNotificationResult | null | undefined, fallbackMessage?: string) => string | null
  success: (message: string, options?: Omit<NotificationInput, 'type' | 'message'>) => string
  error: (message: string, options?: Omit<NotificationInput, 'type' | 'message'>) => string
  warning: (message: string, options?: Omit<NotificationInput, 'type' | 'message'>) => string
  info: (message: string, options?: Omit<NotificationInput, 'type' | 'message'>) => string
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

const MAX_NOTIFICATIONS = 4

const toneConfig: Record<NotificationType, { icon: typeof CheckCircle2; className: string; iconClassName: string; title: string }> = {
  success: {
    icon: CheckCircle2,
    title: 'Sucesso',
    className: 'border-success/35 bg-success/10 text-foreground shadow-success/10',
    iconClassName: 'text-success-foreground',
  },
  error: {
    icon: XCircle,
    title: 'Erro',
    className: 'border-destructive/35 bg-destructive/10 text-foreground shadow-destructive/10',
    iconClassName: 'text-destructive',
  },
  warning: {
    icon: AlertTriangle,
    title: 'Atenção',
    className: 'border-warning/40 bg-warning/15 text-foreground shadow-warning/10',
    iconClassName: 'text-warning-foreground',
  },
  info: {
    icon: Info,
    title: 'Informação',
    className: 'border-info/35 bg-info/10 text-foreground shadow-info/10',
    iconClassName: 'text-info-foreground',
  },
}

function buildId() {
  return `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) clearTimeout(timer)
    timersRef.current.delete(id)
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const scheduleDismiss = useCallback((id: string, type: NotificationType, durationMs?: number | null) => {
    const duration = getNotificationDuration(type, durationMs)
    if (duration === null) return

    const currentTimer = timersRef.current.get(id)
    if (currentTimer) clearTimeout(currentTimer)

    const timer = setTimeout(() => dismiss(id), duration)
    timersRef.current.set(id, timer)
  }, [dismiss])

  const notify = useCallback((notification: NotificationInput) => {
    const id = buildId()

    setItems((current) => {
      const dedupeIndex = current.findIndex((item) => (
        notification.dedupeKey
          ? item.dedupeKey === notification.dedupeKey
          : shouldMergeNotifications(item, notification)
      ))

      if (dedupeIndex >= 0) {
        const updated = [...current]
        const existing = updated[dedupeIndex]
        updated[dedupeIndex] = {
          ...existing,
          ...notification,
          id: existing.id,
          count: existing.count + 1,
          createdAt: Date.now(),
        }
        scheduleDismiss(existing.id, notification.type, notification.durationMs)
        return updated
      }

      const next: NotificationItem = { ...notification, id, count: 1, createdAt: Date.now() }
      scheduleDismiss(id, notification.type, notification.durationMs)
      return [next, ...current].slice(0, MAX_NOTIFICATIONS)
    })

    return id
  }, [scheduleDismiss])

  const clear = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
    setItems([])
  }, [])

  const fromActionResult = useCallback((result: ActionNotificationResult | null | undefined, fallbackMessage?: string) => {
    const notification = notificationFromActionResult(result, fallbackMessage)
    return notification ? notify(notification) : null
  }, [notify])

  const value = useMemo<NotificationContextValue>(() => ({
    notify,
    dismiss,
    clear,
    fromActionResult,
    success: (message, options) => notify({ ...options, type: 'success', message }),
    error: (message, options) => notify({ ...options, type: 'error', message }),
    warning: (message, options) => notify({ ...options, type: 'warning', message }),
    info: (message, options) => notify({ ...options, type: 'info', message }),
  }), [clear, dismiss, fromActionResult, notify])

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NotificationViewport items={items} onDismiss={dismiss} />
    </NotificationContext.Provider>
  )
}

function NotificationViewport({ items, onDismiss }: { items: NotificationItem[]; onDismiss: (id: string) => void }) {
  return (
    <section
      aria-live="polite"
      aria-relevant="additions text"
      aria-label="Notificações"
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3 sm:right-6 sm:top-6"
    >
      {items.map((item) => <NotificationCard key={item.id} item={item} onDismiss={onDismiss} />)}
    </section>
  )
}

function NotificationCard({ item, onDismiss }: { item: NotificationItem; onDismiss: (id: string) => void }) {
  const config = toneConfig[item.type]
  const Icon = config.icon
  const [expanded, setExpanded] = useState(false)

  return (
    <article
      role={item.type === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto rounded-2xl border p-4 shadow-xl backdrop-blur-md',
        'animate-in fade-in slide-in-from-right-2 duration-200',
        config.className,
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 size-5 shrink-0', config.iconClassName)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{item.title || config.title}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {item.message}
                {item.count > 1 && <span className="ml-1 font-medium text-foreground">({item.count}x)</span>}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(item.id)}
              className="rounded-md p-1 text-muted-foreground outline-none transition hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Fechar notificação"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {item.details && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={expanded}
              >
                {expanded ? 'Ocultar detalhes' : 'Ver detalhes'}
              </button>
              {expanded && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-background/80 p-3 text-xs text-muted-foreground">
                  {item.details}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotifications deve ser usado dentro de NotificationProvider.')
  return context
}
