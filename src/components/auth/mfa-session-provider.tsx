'use client'

import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { calcularTempoRestanteMfa } from '@/lib/auth/mfa-session'

const CHANNEL_NAME = 'bw-antecipa-mfa-session'
const STORAGE_KEY = 'bw_antecipa_mfa_session_event'

type SessionSecurityResponse = {
  valid: boolean
  expiresAt?: string | null
  serverNow?: string
}

export function MfaSessionProvider({ children }: { children: ReactNode }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logoutStartedRef = useRef(false)
  const channelRef = useRef<BroadcastChannel | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const expireSession = useCallback(async (broadcast = true) => {
    if (logoutStartedRef.current) return
    logoutStartedRef.current = true
    clearTimer()
    if (broadcast) {
      channelRef.current?.postMessage({ type: 'expired' })
      try { localStorage.setItem(STORAGE_KEY, String(Date.now())) } catch { /* storage indisponível */ }
    }
    await fetch('/api/auth/session-security', { method: 'POST', cache: 'no-store', keepalive: true }).catch(() => undefined)
    window.location.replace('/login?motivo=mfa_expirada')
  }, [clearTimer])

  const scheduleExpiration = useCallback((expiresAt: string, serverNow: string) => {
    clearTimer()
    const remaining = calcularTempoRestanteMfa(expiresAt, serverNow)
    if (remaining <= 0) {
      void expireSession()
      return
    }
    timerRef.current = setTimeout(() => void expireSession(), Math.min(remaining, 2_147_000_000))
  }, [clearTimer, expireSession])

  const revalidate = useCallback(async () => {
    if (logoutStartedRef.current) return
    try {
      const response = await fetch('/api/auth/session-security', { cache: 'no-store' })
      const data = await response.json() as SessionSecurityResponse
      if (!response.ok || !data.valid || !data.expiresAt || !data.serverNow) {
        await expireSession()
        return
      }
      scheduleExpiration(data.expiresAt, data.serverNow)
    } catch {
      // Falha transitória de rede não encerra uma sessão ainda não comprovadamente
      // expirada; a próxima navegação/action continua protegida pelo gate servidor.
    }
  }, [expireSession, scheduleExpiration])

  useEffect(() => {
    if ('BroadcastChannel' in window) {
      channelRef.current = new BroadcastChannel(CHANNEL_NAME)
      channelRef.current.onmessage = (event) => {
        if (event.data?.type === 'expired') void expireSession(false)
      }
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) void expireSession(false)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void revalidate() }
    const onFocus = () => void revalidate()
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    void revalidate()

    return () => {
      clearTimer()
      channelRef.current?.close()
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [clearTimer, expireSession, revalidate])

  return children
}
