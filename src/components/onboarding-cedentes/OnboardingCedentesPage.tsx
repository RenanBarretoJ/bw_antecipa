'use client'

import { useMemo, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { RefreshCw, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ListPagination } from '@/components/pagination'
import { buildListUrl } from '@/lib/pagination'
import { CedenteOnboardingDrawer } from './CedenteOnboardingDrawer'
import { DefinirPoliticaDialog } from './DefinirPoliticaDialog'
import { OnboardingCedentesTable } from './OnboardingCedentesTable'
import { OnboardingEmptyState } from './OnboardingEmptyState'
import { OnboardingSummaryFilters } from './OnboardingSummaryFilters'
import { OnboardingToolbar } from './OnboardingToolbar'
import { VincularFundoDialog } from './VincularFundoDialog'
import { ConvidarNovoCedenteDialog } from './ConvidarNovoCedenteDialog'
import type { FiltrosOnboarding, OnboardingCedente, ResultadoOnboarding } from './types'

export function OnboardingCedentesPage({
  filtros,
  resultado,
}: {
  filtros: FiltrosOnboarding
  resultado: ResultadoOnboarding
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [vincularCedente, setVincularCedente] = useState<OnboardingCedente | null>(null)
  const [politicaCedente, setPoliticaCedente] = useState<OnboardingCedente | null>(null)
  const [drawerCedente, setDrawerCedente] = useState<OnboardingCedente | null>(null)
  const [conviteAberto, setConviteAberto] = useState(false)
  const currentParams = useMemo(
    () => Object.fromEntries(searchParams.entries()),
    [searchParams],
  )

  function navegar(updates: Record<string, string | number | null>) {
    startTransition(() => router.replace(buildListUrl(pathname, currentParams, updates)))
  }

  function atualizar() {
    startTransition(() => router.refresh())
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-6 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Cedentes</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Onboarding de cedentes</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Acompanhe quem ainda precisa de fundo, politica ou revisao antes de operar.
          </p>
          {resultado.fundoAtivo && (
            <p className="mt-2 text-xs text-muted-foreground">
              Contexto ativo: <span className="font-medium text-foreground">{resultado.fundoAtivo.nome}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => setConviteAberto(true)} disabled={!resultado.fundoAtivo || isPending}>
            <UserPlus className="size-4" aria-hidden="true" />
            Convidar novo Cedente
          </Button>
          <Button type="button" variant="outline" onClick={atualizar} disabled={isPending}>
            <RefreshCw className={`size-4 ${isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
            Atualizar
          </Button>
        </div>
      </div>

      <OnboardingSummaryFilters
        etapa={filtros.etapa}
        counts={resultado.counts}
        onChange={(etapa) => navegar({ etapa: etapa === 'pendencias' ? null : etapa, page: 1 })}
      />
      <OnboardingToolbar
        key={filtros.busca}
        filters={filtros}
        politicas={resultado.politicasFiltro}
        onChange={navegar}
        onClear={() => startTransition(() => router.replace(pathname))}
      />

      {!resultado.fundoAtivo ? (
        <Card>
          <CardHeader>
            <CardTitle>Acesso operacional indisponivel</CardTitle>
            <CardDescription>Seu usuario nao possui fundo ativo autorizado para operar o onboarding.</CardDescription>
          </CardHeader>
        </Card>
      ) : resultado.items.length === 0 ? (
        <OnboardingEmptyState onClear={() => startTransition(() => router.replace(pathname))} />
      ) : (
        <div className={`overflow-hidden rounded-xl border bg-card ${isPending ? 'opacity-70' : ''}`}>
          <OnboardingCedentesTable
            rows={resultado.items}
            onVincularFundo={setVincularCedente}
            onDefinirPolitica={setPoliticaCedente}
            onDetalhes={setDrawerCedente}
          />
          <ListPagination
            className="border-t px-4 py-3"
            pagination={resultado.pagination}
            disabled={isPending}
            onPageChange={(page) => navegar({ page })}
            onPageSizeChange={(pageSize) => navegar({ pageSize, page: 1 })}
          />
        </div>
      )}

      <VincularFundoDialog
        open={Boolean(vincularCedente)}
        cedente={vincularCedente}
        fundo={resultado.fundoAtivo}
        onOpenChange={(open) => !open && setVincularCedente(null)}
        onSuccess={atualizar}
      />
      <ConvidarNovoCedenteDialog
        open={conviteAberto}
        fundo={resultado.fundoAtivo}
        onOpenChange={setConviteAberto}
        onSuccess={atualizar}
      />
      <DefinirPoliticaDialog
        open={Boolean(politicaCedente)}
        cedente={politicaCedente}
        onOpenChange={(open) => !open && setPoliticaCedente(null)}
        onSuccess={atualizar}
      />
      <CedenteOnboardingDrawer
        open={Boolean(drawerCedente)}
        cedente={drawerCedente}
        onOpenChange={(open) => !open && setDrawerCedente(null)}
        onVincularFundo={(cedente) => {
          setDrawerCedente(null)
          setVincularCedente(cedente)
        }}
        onDefinirPolitica={(cedente) => {
          setDrawerCedente(null)
          setPoliticaCedente(cedente)
        }}
      />
    </div>
  )
}
