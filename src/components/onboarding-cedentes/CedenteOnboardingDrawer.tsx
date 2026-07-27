'use client'

import { CalendarDays, Link2, ShieldCheck, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { formatCnpj, shortName } from './utils'
import type { FundoResumo, OnboardingCedente } from './types'

type Props = {
  open: boolean
  cedente: OnboardingCedente | null
  fundos: FundoResumo[]
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

export function CedenteOnboardingDrawer({ open, cedente, fundos, onOpenChange, onVincularFundo, onDefinirPolitica }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Detalhes do cedente</SheetTitle>
          <SheetDescription>Contexto operacional para liberar o cedente no fundo correto.</SheetDescription>
        </SheetHeader>

        {cedente && (
          <div className="space-y-4 px-4 pb-6">
            <section className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Cedente</p>
                  <h3 className="mt-1 truncate text-lg font-semibold" title={cedente.razao_social}>{cedente.razao_social}</h3>
                  <p className="text-sm text-muted-foreground">{cedente.nome_fantasia || 'Nome fantasia nao informado'}</p>
                </div>
                <Badge variant={cedente.onboardingStatus === 'apto_operar' ? 'secondary' : 'outline'}>
                  {statusLabel[cedente.onboardingStatus]}
                </Badge>
              </div>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">CNPJ</p>
                  <p className="font-medium">{formatCnpj(cedente.cnpj)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Cadastro</p>
                  <p className="font-medium">{formatDate(cedente.created_at)}</p>
                </div>
              </div>
            </section>

            <section className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <Link2 className="size-4 text-primary" aria-hidden="true" />
                <h3 className="font-semibold">Vínculos com fundos</h3>
              </div>
              {[...cedente.activeLinks, ...cedente.suspendedLinks].length === 0 ? (
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Nenhum fundo vinculado.</p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {[...cedente.activeLinks, ...cedente.suspendedLinks].map((link) => {
                    const fundo = fundos.find((item) => item.id === link.fundo_id)
                    return (
                      <div key={link.id} className="grid gap-2 p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-medium" title={fundo?.nome}>{shortName(fundo?.nome || 'Fundo sem acesso', 44)}</p>
                          <Badge variant={link.status === 'ativo' ? 'secondary' : 'outline'}>{link.status}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Vigente desde {formatDate(link.vigente_desde)}{link.vigente_ate ? ` ate ${formatDate(link.vigente_ate)}` : ''}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
                <h3 className="font-semibold">Política operacional</h3>
              </div>
              {cedente.politicaPrincipal && cedente.versaoPrincipal ? (
                <div className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{cedente.politicaPrincipal.nome}</p>
                  <p className="mt-1 text-muted-foreground">
                    Versão v{cedente.versaoPrincipal.versao} · {cedente.requisitoCount} requisito(s)
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    Publicada em {formatDate(cedente.versaoPrincipal.publicada_em)}
                  </p>
                </div>
              ) : (
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Nenhuma política vigente definida.</p>
              )}
            </section>

            <section className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <UserRound className="size-4 text-primary" aria-hidden="true" />
                <h3 className="font-semibold">Próxima ação recomendada</h3>
              </div>
              {cedente.onboardingStatus === 'aguardando_vinculo_fundo' && (
                <Button type="button" className="w-full" onClick={() => onVincularFundo(cedente)}>Vincular fundo</Button>
              )}
              {cedente.onboardingStatus === 'aguardando_politica' && (
                <Button type="button" className="w-full" onClick={() => onDefinirPolitica(cedente)}>Definir política</Button>
              )}
              {cedente.onboardingStatus === 'apto_operar' && (
                <p className="text-sm text-muted-foreground">Cedente apto a operar nos vínculos configurados.</p>
              )}
              {cedente.onboardingStatus === 'suspenso' && (
                <p className="text-sm text-muted-foreground">Revise os vínculos suspensos no detalhe do cedente antes de liberar novas operações.</p>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
