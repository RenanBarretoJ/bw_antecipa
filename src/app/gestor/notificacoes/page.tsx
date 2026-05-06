'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Info,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react'

interface Notificacao {
  id: string
  titulo: string
  mensagem: string
  tipo: string
  lida: boolean
  created_at: string
}

type Filtro = 'todas' | 'nao_lidas' | 'lidas'

const tipoConfig: Record<
  string,
  {
    label: string
    icon: typeof Info
    badgeClass: string
    iconClass: string
    bgClass: string
  }
> = {
  info: {
    label: 'Info',
    icon: Info,
    badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    iconClass: 'text-blue-600 dark:text-blue-400',
    bgClass: 'bg-blue-100 dark:bg-blue-900/30',
  },
  sucesso: {
    label: 'Sucesso',
    icon: CheckCircle,
    badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    bgClass: 'bg-emerald-100 dark:bg-emerald-900/30',
  },
  alerta: {
    label: 'Alerta',
    icon: AlertTriangle,
    badgeClass: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    iconClass: 'text-yellow-600 dark:text-yellow-400',
    bgClass: 'bg-yellow-100 dark:bg-yellow-900/30',
  },
  erro: {
    label: 'Erro',
    icon: XCircle,
    badgeClass: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    iconClass: 'text-red-600 dark:text-red-400',
    bgClass: 'bg-red-100 dark:bg-red-900/30',
  },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function formatAbsoluto(dateStr: string): string {
  return new Date(dateStr).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function NotificacaoSkeleton() {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-12" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
            <div className="flex items-center gap-2 pt-1">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function NotificacoesPage() {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([])
  const [loading, setLoading] = useState(true)
  const [marcandoTodas, setMarcandoTodas] = useState(false)
  const [marcando, setMarcando] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()

    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      setUserId(user.id)

      const { data } = await supabase
        .from('notificacoes')
        .select('id, titulo, mensagem, tipo, lida, created_at')
        .eq('usuario_id', user.id)
        .order('created_at', { ascending: false })

      setNotificacoes((data || []) as Notificacao[])
      setLoading(false)

      const channel = supabase
        .channel('gestor-notificacoes-realtime')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notificacoes',
            filter: `usuario_id=eq.${user.id}`,
          },
          (payload) => {
            const nova = payload.new as Notificacao
            setNotificacoes((prev) => [nova, ...prev])
          }
        )
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }

    const cleanup = init()
    return () => {
      cleanup.then((fn) => fn?.())
    }
  }, [])

  const marcarComoLida = async (id: string) => {
    if (marcando === id) return
    setMarcando(id)
    const supabase = createClient()
    await supabase
      .from('notificacoes')
      .update({ lida: true } as never)
      .eq('id', id)
    setNotificacoes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, lida: true } : n))
    )
    setMarcando(null)
  }

  const marcarTodasComoLidas = async () => {
    if (!userId || marcandoTodas) return
    const naoLidas = notificacoes.filter((n) => !n.lida)
    if (naoLidas.length === 0) return
    setMarcandoTodas(true)
    const supabase = createClient()
    await supabase
      .from('notificacoes')
      .update({ lida: true } as never)
      .eq('usuario_id', userId)
      .eq('lida', false)
    setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: true })))
    setMarcandoTodas(false)
  }

  const notificacoesFiltradas = notificacoes.filter((n) => {
    if (filtro === 'nao_lidas') return !n.lida
    if (filtro === 'lidas') return n.lida
    return true
  })

  const totalNaoLidas = notificacoes.filter((n) => !n.lida).length

  const filtroTabs: { key: Filtro; label: string; count?: number }[] = [
    { key: 'todas', label: 'Todas', count: notificacoes.length },
    { key: 'nao_lidas', label: 'Nao lidas', count: totalNaoLidas },
    { key: 'lidas', label: 'Lidas' },
  ]

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notificacoes</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {loading
              ? 'Carregando...'
              : totalNaoLidas > 0
              ? `${totalNaoLidas} nao lida${totalNaoLidas > 1 ? 's' : ''}`
              : 'Tudo em dia'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={marcarTodasComoLidas}
          disabled={marcandoTodas || totalNaoLidas === 0 || loading}
          className="gap-2 shrink-0"
        >
          <CheckCheck size={15} />
          {marcandoTodas ? 'Marcando...' : 'Marcar todas como lidas'}
        </Button>
      </div>

      <div className="flex items-center gap-1 mb-5 border-b border-border">
        {filtroTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFiltro(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              filtro === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                  filtro === tab.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <NotificacaoSkeleton key={i} />
          ))}
        </div>
      ) : notificacoesFiltradas.length === 0 ? (
        <Card>
          <CardContent className="py-20 flex flex-col items-center gap-3 text-center">
            {filtro === 'nao_lidas' ? (
              <>
                <div className="p-4 rounded-full bg-muted">
                  <BellOff size={32} className="text-muted-foreground/50" />
                </div>
                <p className="font-semibold text-foreground">Nenhuma notificacao nao lida</p>
                <p className="text-sm text-muted-foreground">Voce esta em dia com todas as suas notificacoes.</p>
              </>
            ) : (
              <>
                <div className="p-4 rounded-full bg-muted">
                  <Bell size={32} className="text-muted-foreground/50" />
                </div>
                <p className="font-semibold text-foreground">Nenhuma notificacao</p>
                <p className="text-sm text-muted-foreground">
                  {filtro === 'lidas'
                    ? 'Voce ainda nao leu nenhuma notificacao.'
                    : 'Suas notificacoes apareceram aqui quando houver atualizacoes.'}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notificacoesFiltradas.map((n) => {
            const config = tipoConfig[n.tipo] ?? tipoConfig.info
            const TipoIcon = config.icon

            return (
              <Card
                key={n.id}
                className={`transition-colors ${
                  !n.lida
                    ? 'border-primary/20 bg-primary/[0.02] dark:bg-primary/[0.04]'
                    : ''
                }`}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg shrink-0 ${config.bgClass}`}>
                      <TipoIcon size={18} className={config.iconClass} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p
                          className={`text-sm leading-snug ${
                            !n.lida
                              ? 'font-semibold text-foreground'
                              : 'font-medium text-foreground/80'
                          }`}
                        >
                          {n.titulo}
                          {!n.lida && (
                            <span className="inline-block w-2 h-2 bg-primary rounded-full ml-2 mb-0.5 align-middle" />
                          )}
                        </p>
                        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                          {timeAgo(n.created_at)}
                        </span>
                      </div>

                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {n.mensagem}
                      </p>

                      <div className="flex items-center justify-between gap-2 mt-3">
                        <div className="flex items-center gap-2">
                          <Badge className={`${config.badgeClass} border-transparent gap-1`}>
                            <TipoIcon size={10} />
                            {config.label}
                          </Badge>
                          <span className="text-xs text-muted-foreground/70">
                            {formatAbsoluto(n.created_at)}
                          </span>
                        </div>

                        {!n.lida && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => marcarComoLida(n.id)}
                            disabled={marcando === n.id}
                            className="h-7 px-2.5 text-xs gap-1.5 text-muted-foreground hover:text-foreground shrink-0"
                          >
                            <Check size={13} />
                            {marcando === n.id ? 'Marcando...' : 'Marcar como lida'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
