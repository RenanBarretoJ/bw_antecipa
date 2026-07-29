'use client'

import { useEffect, useState } from 'react'
import { CalendarDays, Link2, ShieldCheck, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useNotifications } from '@/components/notifications/notification-provider'
import { carregarContextoOnboardingCedente } from '@/lib/actions/onboarding-cedentes'
import { formatCnpj } from './utils'
import type { ContextoOnboardingCedente, OnboardingCedente } from './types'

type Props = {
  open: boolean
  cedente: OnboardingCedente | null
  onOpenChange: (open: boolean) => void
  onVincularFundo: (cedente: OnboardingCedente) => void
  onDefinirPolitica: (cedente: OnboardingCedente) => void
}

const statusLabel = {
  aguardando_vinculo_fundo: 'Sem fundo',
  aguardando_politica: 'Sem politica',
  apto_operar: 'Apto',
  suspenso: 'Suspenso',
} as const

function formatDate(value: string | null | undefined) {
  if (!value) return 'Nao informado'
  return new Intl.DateTimeFormat('pt-BR').format(new Date(value))
}

export function CedenteOnboardingDrawer({
  open,
  cedente,
  onOpenChange,
  onVincularFundo,
  onDefinirPolitica,
}: Props) {
  const notifications = useNotifications()
  const [contexto, setContexto] = useState<ContextoOnboardingCedente | null>(null)

  useEffect(() => {
    if (!open || !cedente) return
    let active = true
    void carregarContextoOnboardingCedente(cedente.id).then((result) => {
      if (!active) return
      if (!result.success || !result.data) {
        notifications.error(result.message || 'Nao foi possivel carregar os detalhes do cedente.')
        return
      }
      setContexto(result.data)
    })
    return () => {
      active = false
    }
  }, [cedente, notifications, open])

  const loading = Boolean(open && cedente && contexto?.cedente.id !== cedente.id)

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) setContexto(null)
        onOpenChange(value)
      }}
    >
      <SheetContent className="w-full overflow-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Detalhes do cedente</SheetTitle>
          <SheetDescription>Contexto operacional carregado sob demanda para o fundo ativo.</SheetDescription>
        </SheetHeader>

        {loading ? (
          <p className="mx-4 rounded-xl border p-4 text-sm text-muted-foreground">Carregando detalhes...</p>
        ) : contexto && cedente ? (
          <div className="space-y-4 px-4 pb-6">
            <section className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Cedente</p>
                  <h3 className="mt-1 truncate text-lg font-semibold" title={contexto.cedente.razaoSocial}>{contexto.cedente.razaoSocial}</h3>
                  <p className="truncate text-sm text-muted-foreground">{contexto.cedente.nomeFantasia || 'Nome fantasia nao informado'}</p>
                </div>
                <Badge variant={cedente.onboardingStatus === 'apto_operar' ? 'secondary' : 'outline'}>
                  {statusLabel[cedente.onboardingStatus]}
                </Badge>
              </div>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">CNPJ</p>
                  <p className="font-medium">{formatCnpj(contexto.cedente.cnpj)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Cadastro</p>
                  <p className="font-medium">{formatDate(contexto.cedente.createdAt)}</p>
                </div>
              </div>
            </section>

            <section className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <Link2 className="size-4 text-primary" aria-hidden="true" />
                <h3 className="font-semibold">Vinculo no fundo ativo</h3>
              </div>
              {contexto.vinculo ? (
                <div className="grid gap-2 rounded-lg border p-3 text-sm">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <p className="truncate font-medium" title={contexto.fundo.nome}>{contexto.fundo.nome}</p>
                    <Badge variant={contexto.vinculo.status === 'ativo' ? 'secondary' : 'outline'}>{contexto.vinculo.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Vigente desde {formatDate(contexto.vinculo.vigenteDesde)}
                    {contexto.vinculo.vigenteAte ? ` ate ${formatDate(contexto.vinculo.vigenteAte)}` : ''}
                  </p>
                </div>
              ) : (
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Nenhum vinculo no fundo ativo.</p>
              )}
            </section>

            <section className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
                <h3 className="font-semibold">Politica operacional</h3>
              </div>
              {contexto.politicaAtual ? (
                <div className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{contexto.politicaAtual.nome}</p>
                  <p className="mt-1 text-muted-foreground">
                    Versao v{contexto.politicaAtual.numeroVersao} · {contexto.politicaAtual.requisitoCount} requisito(s)
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    Publicada em {formatDate(contexto.politicaAtual.publicadaEm)}
                  </p>
                </div>
              ) : (
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Nenhuma politica vigente definida.</p>
              )}
            </section>

            <section className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <UserRound className="size-4 text-primary" aria-hidden="true" />
                <h3 className="font-semibold">Proxima acao recomendada</h3>
              </div>
              {cedente.onboardingStatus === 'aguardando_vinculo_fundo' && (
                <Button type="button" className="w-full" onClick={() => onVincularFundo(cedente)}>Vincular fundo</Button>
              )}
              {cedente.onboardingStatus === 'aguardando_politica' && (
                <Button type="button" className="w-full" onClick={() => onDefinirPolitica(cedente)}>Definir politica</Button>
              )}
              {cedente.onboardingStatus === 'apto_operar' && (
                <p className="text-sm text-muted-foreground">Cedente apto a operar no fundo ativo.</p>
              )}
              {cedente.onboardingStatus === 'suspenso' && (
                <p className="text-sm text-muted-foreground">Revise o vinculo suspenso antes de liberar novas operacoes.</p>
              )}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
