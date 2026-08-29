'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { carregarContextoFundoAtivo, selecionarFundoAtivo } from '@/lib/actions/fundo-ativo'
import type { FundoAtivoAutorizado, FundoAutorizado } from '@/lib/fundos/fundo-ativo'
import { useNotifications } from '@/components/notifications/notification-provider'

type FundoAtivoContextValue = {
  loading: boolean
  fundos: FundoAutorizado[]
  contexto: FundoAtivoAutorizado | null
  fundoAtivo: FundoAutorizado | null
  bloqueado: boolean
  trocarFundo: (fundoId: string) => Promise<boolean>
  recarregar: () => Promise<void>
}

const FundoAtivoContext = createContext<FundoAtivoContextValue | null>(null)

export function FundoAtivoProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [loading, setLoading] = useState(enabled)
  const [fundos, setFundos] = useState<FundoAutorizado[]>([])
  const [contexto, setContexto] = useState<FundoAtivoAutorizado | null>(null)
  const [bloqueado, setBloqueado] = useState(false)

  const recarregar = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      setFundos([])
      setContexto(null)
      setBloqueado(false)
      return
    }
    setLoading(true)
    const result = await carregarContextoFundoAtivo()
    if (!result.success || !result.data) {
      notifications.error(result.message || 'Não foi possível carregar o fundo ativo.')
      setBloqueado(true)
      setLoading(false)
      return
    }
    setFundos(result.data.fundos)
    setContexto(result.data.contexto)
    setBloqueado(result.data.bloqueado)
    setLoading(false)
  }, [enabled, notifications])

  useEffect(() => {
    void Promise.resolve().then(() => recarregar())
  }, [recarregar])

  const trocarFundo = useCallback(async (fundoId: string) => {
    const result = await selecionarFundoAtivo(fundoId)
    if (!result.success || !result.data) {
      notifications.error(result.message || 'Não foi possível alterar o fundo ativo.')
      return false
    }
    notifications.success(result.message || `Fundo alterado para ${result.data.fundo.nome}.`)
    await recarregar()
    router.push('/gestor/dashboard')
    router.refresh()
    return true
  }, [notifications, recarregar, router])

  const fundoAtivo = useMemo(() => fundos.find((fundo) => fundo.id === contexto?.fundoId) || null, [fundos, contexto?.fundoId])

  const value = useMemo(() => ({
    loading,
    fundos,
    contexto,
    fundoAtivo,
    bloqueado,
    trocarFundo,
    recarregar,
  }), [loading, fundos, contexto, fundoAtivo, bloqueado, trocarFundo, recarregar])

  return <FundoAtivoContext.Provider value={value}>{children}</FundoAtivoContext.Provider>
}

export function useFundoAtivo() {
  const context = useContext(FundoAtivoContext)
  if (!context) {
    return {
      loading: false,
      fundos: [],
      contexto: null,
      fundoAtivo: null,
      bloqueado: false,
      trocarFundo: async () => false,
      recarregar: async () => {},
    } satisfies FundoAtivoContextValue
  }
  return context
}
