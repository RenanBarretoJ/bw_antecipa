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

type Filtro = 'todas' | 'nao_lidas' | 'lidas'

function getTempoRelativo(created_at: string): string {
  const agora = Date.now()
  const criado = new Date(created_at).getTime()
  const diff = Math.floor((agora - criado) / 1000)

  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

function getDataAbsoluta(created_at: string): string {
  return new Date(created_at).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type TipoConfig = {
  label: string
  icon: React.ReactNode
  badgeClass: string
  iconClass: string
  rowClass: string
}

function getTipoConfig(tipo: string): TipoConfig {
  switch (tipo) {
    case 'sucesso':
      return {
        label: 'Sucesso',
        icon: <CheckCircle size={18} />,
        badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30',
        iconClass: 'text-emerald-600 dark:text-emerald-400',
        rowClass: 'border-emerald-200/60 dark:border-emerald-500/20',
      }
    case 'alerta':
      return {
        label: 'Alerta',
        icon: <AlertTriangle size={18} />,
        badgeClass: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30',
        iconClass: 'text-amber-600 dark:text-amber-400',
        rowClass: 'border-amber-200/60 dark:border-amber-500/20',
      }
    case 'erro':
      return {
        label: 'Erro',
        icon: <XCircle size={18} />,
        badgeClass: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/20 dark:text-red-400 dark:border-red-500/30',
        iconClass: 'text-destructive',
        rowClass: 'border-destructive/20',
      }
    default: // 'info'
      return {
        label: 'Info',
        icon: <Info size={18} />,
        badgeClass: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30',
        iconClass: 'text-blue-600 dark:text-blue-400',
        rowClass: 'border-blue-200/60 dark:border-blue-500/20',
      }
  }
}

function NotificacaoSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}>
          <CardContent className="py-4">
            <div className="flex items-start gap-4">
              <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function SacadoNotificacoes() {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [marcandoTodas, setMarcandoTodas] = useState(false)
  const [usuarioId, setUsuarioId] = useState<string | null>(null)

  const carregarNotificacoes = useCallback(async (uid: string) => {
    const supabase = createClient()
    const { data } = await supabase
      .from('notificacoes')
      .select('id, titulo, mensagem, tipo, lida, created_at')
      .eq('usuario_id', uid)
      .order('created_at', { ascending: false })

    setNotificacoes((data as Notificacao[]) || [])
  }, [])

  useEffect(() => {
    const init = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      setUsuarioId(user.id)
      await carregarNotificacoes(user.id)
      setLoading(false)

      // Realtime subscription
      const channel = supabase
        .channel('sacado-notificacoes')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notificacoes',
            filter: `usuario_id=eq.${user.id}`,
          },
          (payload) => {
            setNotificacoes((prev) => [payload.new as Notificacao, ...prev])
          }
        )
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }

    init()
  }, [carregarNotificacoes])

  const marcarComoLida = async (id: string) => {
    const supabase = createClient()
    await supabase
      .from('notificacoes')
      .update({ lida: true } as never)
      .eq('id', id)

    setNotificacoes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, lida: true } : n))
    )
  }

  const marcarTodasComoLidas = async () => {
    if (!usuarioId) return
    setMarcandoTodas(true)
    const supabase = createClient()
    await supabase
      .from('notificacoes')
      .update({ lida: true } as never)
      .eq('usuario_id', usuarioId)
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
    { key: 'lidas', label: 'Lidas', count: notificacoes.filter((n) => n.lida).length },
  ]

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bell size={24} className="text-primary" />
            Notificacoes
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {totalNaoLidas > 0
              ? `Voce tem ${totalNaoLidas} notificacao${totalNaoLidas > 1 ? 'oes' : ''} nao lida${totalNaoLidas > 1 ? 's' : ''}`
              : 'Todas as notificacoes foram lidas'}
          </p>
        </div>
        {totalNaoLidas > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={marcarTodasComoLidas}
            disabled={marcandoTodas}
            className="gap-2"
          >
            <CheckCheck size={16} />
            {marcandoTodas ? 'Marcando...' : 'Marcar todas como lidas'}
          </Button>
        )}
      </div>

      {/* Filtro tabs */}
      <Card>
        <CardContent className="py-3">
          <div className="flex gap-1">
            {filtroTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFiltro(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filtro === tab.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={`text-xs rounded-full px-1.5 py-0.5 leading-none ${
                      filtro === tab.key
                        ? 'bg-primary-foreground/20 text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      {loading ? (
        <NotificacaoSkeleton />
      ) : notificacoesFiltradas.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center justify-center text-center">
            <div className="p-4 rounded-full bg-muted mb-4">
              <BellOff size={32} className="text-muted-foreground/50" />
            </div>
            <p className="text-foreground font-medium mb-1">
              {filtro === 'nao_lidas'
                ? 'Nenhuma notificacao nao lida'
                : filtro === 'lidas'
                ? 'Nenhuma notificacao lida'
                : 'Nenhuma notificacao'}
            </p>
            <p className="text-muted-foreground text-sm">
              {filtro === 'todas'
                ? 'Novas notificacoes aparecerao aqui automaticamente'
                : 'Tente selecionar outro filtro'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notificacoesFiltradas.map((notif) => {
            const config = getTipoConfig(notif.tipo)
            return (
              <Card
                key={notif.id}
                className={`transition-all ${
                  !notif.lida
                    ? `border-l-4 ${config.rowClass} bg-card`
                    : 'opacity-75'
                }`}
              >
                <CardContent className="py-4">
                  <div className="flex items-start gap-4">
                    {/* Icone do tipo */}
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        notif.tipo === 'sucesso'
                          ? 'bg-emerald-100 dark:bg-emerald-500/20'
                          : notif.tipo === 'alerta'
                          ? 'bg-amber-100 dark:bg-amber-500/20'
                          : notif.tipo === 'erro'
                          ? 'bg-red-100 dark:bg-red-500/20'
                          : 'bg-blue-100 dark:bg-blue-500/20'
                      } ${config.iconClass}`}
                    >
                      {config.icon}
                    </div>

                    {/* Conteudo */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-semibold text-sm ${
                              notif.lida ? 'text-muted-foreground' : 'text-foreground'
                            }`}
                          >
                            {notif.titulo}
                          </span>
                          <Badge
                            className={`text-xs border px-2 py-0 font-medium ${config.badgeClass}`}
                          >
                            {config.label}
                          </Badge>
                          {!notif.lida && (
                            <span className="inline-block w-2 h-2 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-xs text-muted-foreground font-mono">
                            {getTempoRelativo(notif.created_at)}
                          </span>
                          {!notif.lida && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => marcarComoLida(notif.id)}
                              className="h-7 w-7 p-0 ml-1 text-muted-foreground hover:text-primary"
                              title="Marcar como lida"
                            >
                              <Check size={14} />
                            </Button>
                          )}
                        </div>
                      </div>

                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        {notif.mensagem}
                      </p>

                      <p className="text-xs text-muted-foreground/60 mt-2">
                        {getDataAbsoluta(notif.created_at)}
                      </p>
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
