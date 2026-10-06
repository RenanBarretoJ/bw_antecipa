'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Bell, X } from 'lucide-react'
import { Popover } from '@base-ui/react/popover'
import { NotificacoesContextControl, useNotificacoesContexto } from '@/components/notificacoes/notificacoes-context'
import { useNotificacoes } from '@/components/notificacoes/use-notificacoes'
import { useNotificacaoItemFocus } from '@/components/notificacoes/use-notificacao-item-focus'

export function NotificationBell({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const { contexto, loading: contextoLoading } = useNotificacoesContexto()
  const { page, loading, busy, error, mark, retry } = useNotificacoes('todas', 10)
  const { rootRef, onFocusCapture } = useNotificacaoItemFocus(page.items.map((item) => item.id))
  const unread = contexto?.userId === userId ? page.contadores?.naoLidas ?? 0 : 0
  return <Popover.Root open={open} onOpenChange={setOpen} modal="trap-focus">
    <Popover.Trigger aria-label={`Notificações, ${unread} não lidas no contexto atual`} className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
      <Bell className="size-5" aria-hidden="true" />
      {unread > 0 && <span aria-hidden="true" data-testid="notificacao-badge" className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">{unread > 9 ? '9+' : unread}</span>}
    </Popover.Trigger>
    <Popover.Portal><Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={12} className="z-50">
      <Popover.Popup className="w-[min(24rem,calc(100vw-1.5rem))] max-h-[min(38rem,var(--available-height))] overflow-y-auto rounded-xl border border-border bg-popover text-popover-foreground shadow-xl outline-none">
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <Popover.Title className="text-sm font-semibold">Notificações</Popover.Title>
            <Popover.Close aria-label="Fechar notificações" className="rounded-md p-1 hover:bg-muted"><X className="size-4" aria-hidden="true" /></Popover.Close>
          </div>
          <NotificacoesContextControl compacto />
        </div>
        <div ref={rootRef} onFocusCapture={onFocusCapture} tabIndex={-1} aria-label="Notificações do contexto atual" className="p-2 focus-visible:outline-2 focus-visible:outline-primary" aria-busy={loading || contextoLoading}>
          {(loading || contextoLoading) && <p role="status" className="p-3 text-sm text-muted-foreground">Atualizando…</p>}
          {error && <p role="alert" className="p-3 text-sm text-destructive">{error} <button type="button" className="underline" onClick={retry}>Tentar novamente</button></p>}
          {!loading && !contextoLoading && !error && page.items.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">Nenhuma notificação neste contexto.</p>}
          {page.items.map((item) => <article key={item.id} data-notificacao-id={item.id} className={`space-y-2 rounded-lg border-b border-border p-3 ${!item.lida ? 'bg-primary/5' : ''}`}>
            <h3 className="break-words text-sm font-semibold">{item.titulo}</h3>
            <p className="break-words text-xs text-muted-foreground">{item.mensagem}</p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <time dateTime={item.createdAt} className="text-muted-foreground">{new Date(item.createdAt).toLocaleDateString('pt-BR')}</time>
              {!item.lida && <button type="button" className="rounded p-1 text-blue-700 underline aria-disabled:opacity-50 dark:text-blue-300" aria-disabled={busy || loading} onClick={() => { if (!busy && !loading) void mark(item.id) }}>Marcar como lida<span className="sr-only">: {item.titulo}</span></button>}
              {item.href && <Link href={item.href} prefetch={false} onClick={() => setOpen(false)} className="rounded p-1 text-blue-700 underline dark:text-blue-300">Abrir detalhe<span className="sr-only">: {item.titulo}</span></Link>}
            </div>
          </article>)}
        </div>
        {contexto && contexto.role !== 'super_admin' && <Link href={`/${contexto.role}/notificacoes`} onClick={() => setOpen(false)} className="block border-t border-border p-3 text-center text-sm font-medium text-blue-700 hover:bg-muted dark:text-blue-300">Ver todas as notificações</Link>}
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>
}
