'use client'

import { useLayoutEffect, useRef, type FocusEvent } from 'react'

// Recover only focus lost when a notification/action is removed. Never steal
// focus from a user who moved elsewhere while the request was in flight.
export function useNotificacaoItemFocus(ids: string[]) {
  const rootRef = useRef<HTMLDivElement>(null)
  const focused = useRef<{ element: HTMLElement; id: string; index: number } | null>(null)
  function onFocusCapture(event: FocusEvent<HTMLDivElement>) {
    const element = event.target
    const item = element.closest<HTMLElement>('[data-notificacao-id]')
    focused.current = item?.dataset.notificacaoId
      ? { element, id: item.dataset.notificacaoId, index: ids.indexOf(item.dataset.notificacaoId) }
      : null
  }
  useLayoutEffect(() => {
    const previous = focused.current
    const root = rootRef.current
    if (!root || !previous || previous.element.isConnected || document.activeElement !== document.body) return
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-notificacao-id]'))
    const target = items.find((item) => item.dataset.notificacaoId === previous.id)
      ?? items[Math.min(previous.index, items.length - 1)]
    const control = target?.querySelector<HTMLElement>('a[href], button:not(:disabled):not([aria-disabled="true"])')
    ;(control ?? root).focus()
  })
  return { rootRef, onFocusCapture }
}
