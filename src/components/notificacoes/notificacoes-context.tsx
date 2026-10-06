'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { carregarContextoNotificacoes, selecionarFundoNotificacoes } from '@/lib/actions/notificacoes-listagem'
import type { NotificacaoContexto, NotificacaoEscopo } from '@/lib/notificacoes/contracts'
import { NOTIFICACOES_CONTEXTO_INICIO, NOTIFICACOES_CONTEXTO_FIM } from '@/lib/notificacoes/events'

type ContextValue = {
  contexto: NotificacaoContexto | null
  escopo: NotificacaoEscopo | null
  loading: boolean
  error: string | null
  epoch: number
  geral: boolean
  setGeral: (value: boolean) => void
  trocarFundo: (id: string) => Promise<void>
  recarregar: () => Promise<void>
}
const Context = createContext<ContextValue | null>(null)

export function NotificacoesProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [contexto, setContexto] = useState<NotificacaoContexto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [geral, setGeral] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const generation = useRef(0)
  const invalidate = useCallback(() => {
    generation.current += 1
    setEpoch(generation.current)
    setLoading(true)
    setContexto(null)
    setError(null)
  }, [])
  const recarregar = useCallback(async () => {
    const request = ++generation.current
    setEpoch(request)
    setLoading(true)
    setContexto(null)
    try {
      const result = await carregarContextoNotificacoes()
      if (request !== generation.current || result.userId !== userId) return
      setContexto(result)
      setError(null)
    } catch {
      if (request === generation.current) setError('Não foi possível carregar o contexto. Tente novamente.')
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [userId])
  useEffect(() => {
    void recarregar()
    const done = () => { setGeral(false); void recarregar() }
    window.addEventListener(NOTIFICACOES_CONTEXTO_INICIO, invalidate)
    window.addEventListener(NOTIFICACOES_CONTEXTO_FIM, done)
    return () => {
      generation.current += 1
      window.removeEventListener(NOTIFICACOES_CONTEXTO_INICIO, invalidate)
      window.removeEventListener(NOTIFICACOES_CONTEXTO_FIM, done)
    }
  }, [invalidate, recarregar])
  const trocarFundo = useCallback(async (id: string) => {
    invalidate()
    const request = generation.current
    try {
      const result = await selecionarFundoNotificacoes(id)
      if (request !== generation.current || result.userId !== userId) return
      setContexto(result)
      setGeral(false)
      setLoading(false)
    } catch {
      if (request === generation.current) {
        setLoading(false)
        setError('Não foi possível selecionar este Fundo. Recarregue o contexto.')
      }
    }
  }, [invalidate, userId])
  const value = useMemo<ContextValue>(() => ({
    contexto: contexto?.userId === userId ? contexto : null,
    escopo: loading || contexto?.userId !== userId ? null : geral || contexto.role === 'super_admin'
      ? { scope: 'GLOBAL', fundoId: null }
      : contexto.fundoId ? { scope: 'FUNDO', fundoId: contexto.fundoId } : null,
    loading, error, epoch, geral, setGeral, trocarFundo, recarregar,
  }), [contexto, userId, loading, geral, error, epoch, trocarFundo, recarregar])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useNotificacoesContexto() {
  const value = useContext(Context)
  if (!value) throw new Error('NotificacoesProvider obrigatório.')
  return value
}

export function NotificacoesContextControl({ compacto = false }: { compacto?: boolean }) {
  const { contexto, escopo, geral, setGeral, trocarFundo, loading, error, recarregar } = useNotificacoesContexto()
  const nome = contexto?.fundos.find((fundo) => fundo.id === contexto.fundoId)?.nome
  return <div className="min-w-0 space-y-2">
    {contexto?.role !== 'super_admin' && <div className="flex gap-2" aria-label="Escopo das notificações">
      <button type="button" aria-pressed={!geral} className="rounded-md border border-border px-3 py-1.5 text-xs aria-pressed:bg-blue-700 aria-pressed:text-white dark:aria-pressed:bg-blue-300 dark:aria-pressed:text-slate-950" onClick={() => setGeral(false)}>Fundo atual</button>
      <button type="button" aria-pressed={geral} className="rounded-md border border-border px-3 py-1.5 text-xs aria-pressed:bg-blue-700 aria-pressed:text-white dark:aria-pressed:bg-blue-300 dark:aria-pressed:text-slate-950" onClick={() => setGeral(true)}>Geral · Segurança</button>
    </div>}
    {contexto?.seletorProprio && !geral && <label className="block text-xs text-muted-foreground">Fundo das notificações
      <select aria-label="Fundo das notificações" className="mt-1 block w-full min-w-0 rounded-md border border-input bg-background p-2 text-foreground" disabled={loading} value={contexto.fundoId ?? ''} onChange={(event) => void trocarFundo(event.target.value)}>
        {!contexto.fundoId && <option value="">Selecione um Fundo</option>}
        {contexto.fundos.map((fundo) => <option key={fundo.id} value={fundo.id}>{fundo.nome}</option>)}
      </select>
    </label>}
    <p className={`${compacto ? 'text-xs' : 'text-sm'} break-words text-muted-foreground`} data-testid="notificacao-contexto">
      {loading ? 'Carregando contexto…' : escopo?.scope === 'GLOBAL' ? 'Avisos gerais de segurança, separados dos Fundos.' : nome ?? 'Selecione o Fundo operacional no cabeçalho.'}
    </p>
    {error && <div role="alert" className="text-sm text-destructive">{error} <button type="button" className="underline" onClick={() => void recarregar()}>Tentar novamente</button></div>}
  </div>
}
