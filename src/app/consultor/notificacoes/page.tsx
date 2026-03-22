'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

type FiltroTab = 'todas' | 'nao_lidas' | 'lidas'

const tipoConfig: Record<
  string,
  { label: string; className: string; icon: typeof Info }
> = {
  info: {
    label: 'Info',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    icon: Info,
  },
  sucesso: {
    label: 'Sucesso',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    icon: CheckCircle,
  },
  alerta: {
    label: 'Alerta',
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    icon: AlertTriangle,
  },
  erro: {
    label: 'Erro',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    icon: XCircle,
  },
}

function getTipoConfig(tipo: string) {
  return tipoConfig[tipo] ?? tipoConfig['info']
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMs / 3600000)
  const diffD = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `${diffMin}min`
  if (diffH < 24) return `${diffH}h`
  return `${diffD}d`
}

function formatAbsoluteDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function NotificacaoSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i} className="border-border">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="h-5 w-5 rounded-full mt-0.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function EmptyState({ filtro }: { filtro: FiltroTab }) {
  const messages: Record<FiltroTab, string> = {
    todas: 'Nenhuma notificacao encontrada.',
    nao_lidas: 'Nenhuma notificacao nao lida.',
    lidas: 'Nenhuma notificacao lida.',
  }

  return (
    <Card className="border-border">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <BellOff className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-foreground font-medium mb-1">Sem notificacoes</p>
        <p className="text-muted-foreground text-sm">{messages[filtro]}</p>
      </CardContent>
    </Card>
  )
}

export default function ConsultorNotificacoesPage() {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([])
  const [loading, setLoading] = useState(true)
  const [marcandoTodas, setMarcandoTodas] = useState(false)
  const [marcandoId, setMarcandoId] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<FiltroTab>('todas')
  const [usuarioId, setUsuarioId] = useState<string | null>(null)

  const supabase = createClient()

  const fetchNotificacoes = useCallback(
    async (uid: string) => {
      const { data, error } = await supabase
        .from('notificacoes')
        .select('id, titulo, mensagem, tipo, lida, created_at')
        .eq('usuario_id', uid)
        .order('created_at', { ascending: false })

      if (!error && data) {
        setNotificacoes(data as Notificacao[])
      }
    },
    [supabase]
  )

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setLoading(false)
        return
      }

      setUsuarioId(user.id)
      await fetchNotificacoes(user.id)
      setLoading(false)

      channel = supabase
        .channel(`notificacoes-consultor-${user.id}`)
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
    }

    init()

    return () => {
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [supabase, fetchNotificacoes])

  async function marcarComoLida(id: string) {
    setMarcandoId(id)
    const { error } = await supabase
      .from('notificacoes')
      .update({ lida: true } as never)
      .eq('id', id)

    if (!error) {
      setNotificacoes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, lida: true } : n))
      )
    }
    setMarcandoId(null)
  }

  async function marcarTodasComoLidas() {
    if (!usuarioId) return
    setMarcandoTodas(true)

    const naoLidas = notificacoes.filter((n) => !n.lida).map((n) => n.id)
    if (naoLidas.length === 0) {
      setMarcandoTodas(false)
      return
    }

    const { error } = await supabase
      .from('notificacoes')
      .update({ lida: true } as never)
      .in('id', naoLidas)

    if (!error) {
      setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: true })))
    }
    setMarcandoTodas(false)
  }

  const notificacoesFiltradas = notificacoes.filter((n) => {
    if (filtro === 'nao_lidas') return !n.lida
    if (filtro === 'lidas') return n.lida
    return true
  })

  const totalNaoLidas = notificacoes.filter((n) => !n.lida).length

  const tabs: { key: FiltroTab; label: string }[] = [
    { key: 'todas', label: 'Todas' },
    { key: 'nao_lidas', label: 'Nao lidas' },
    { key: 'lidas', label: 'Lidas' },
  ]

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Notificacoes</h1>
            {totalNaoLidas > 0 && (
              <p className="text-sm text-muted-foreground">
                {totalNaoLidas} nao {totalNaoLidas === 1 ? 'lida' : 'lidas'}
              </p>
            )}
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={marcarTodasComoLidas}
          disabled={marcandoTodas || totalNaoLidas === 0}
          className="shrink-0"
        >
          <CheckCheck className="h-4 w-4 mr-2" />
          {marcandoTodas ? 'Marcando...' : 'Marcar todas como lidas'}
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 border border-border rounded-lg p-1 bg-muted/40 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFiltro(tab.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filtro === tab.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.key === 'nao_lidas' && totalNaoLidas > 0 && (
              <span className="ml-2 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs w-5 h-5">
                {totalNaoLidas > 99 ? '99+' : totalNaoLidas}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <NotificacaoSkeleton />
      ) : notificacoesFiltradas.length === 0 ? (
        <EmptyState filtro={filtro} />
      ) : (
        <div className="space-y-3">
          {notificacoesFiltradas.map((notificacao) => {
            const config = getTipoConfig(notificacao.tipo)
            const TipoIcon = config.icon
            const isMarkingThis = marcandoId === notificacao.id

            return (
              <Card
                key={notificacao.id}
                className={`border-border transition-colors ${
                  !notificacao.lida
                    ? 'bg-card border-l-2 border-l-primary'
                    : 'bg-card opacity-80'
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Type Icon */}
                    <div className="mt-0.5 shrink-0">
                      <TipoIcon
                        className={`h-5 w-5 ${
                          notificacao.tipo === 'info'
                            ? 'text-blue-500'
                            : notificacao.tipo === 'sucesso'
                            ? 'text-emerald-500'
                            : notificacao.tipo === 'alerta'
                            ? 'text-yellow-500'
                            : notificacao.tipo === 'erro'
                            ? 'text-red-500'
                            : 'text-blue-500'
                        }`}
                      />
                    </div>

                    {/* Body */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-medium text-sm ${
                              notificacao.lida
                                ? 'text-muted-foreground'
                                : 'text-foreground'
                            }`}
                          >
                            {notificacao.titulo}
                          </span>
                          {!notificacao.lida && (
                            <span className="inline-block h-2 w-2 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <Badge
                          variant="secondary"
                          className={`text-xs shrink-0 ${config.className}`}
                        >
                          {config.label}
                        </Badge>
                      </div>

                      <p className="text-sm text-muted-foreground mb-2 leading-relaxed">
                        {notificacao.mensagem}
                      </p>

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span
                            className="font-medium"
                            title={formatAbsoluteDate(notificacao.created_at)}
                          >
                            {formatRelativeTime(notificacao.created_at)}
                          </span>
                          <span>·</span>
                          <span>{formatAbsoluteDate(notificacao.created_at)}</span>
                        </div>

                        {!notificacao.lida && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => marcarComoLida(notificacao.id)}
                            disabled={isMarkingThis}
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Check className="h-3.5 w-3.5 mr-1" />
                            {isMarkingThis ? 'Marcando...' : 'Marcar como lida'}
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
