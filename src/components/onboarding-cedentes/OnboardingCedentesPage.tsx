'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useNotifications } from '@/components/notifications/notification-provider'
import { createClient } from '@/lib/supabase/client'
import { CedenteOnboardingDrawer } from './CedenteOnboardingDrawer'
import { DefinirPoliticaDialog } from './DefinirPoliticaDialog'
import { OnboardingCedentesTable } from './OnboardingCedentesTable'
import { OnboardingEmptyState } from './OnboardingEmptyState'
import { OnboardingPagination } from './OnboardingPagination'
import { OnboardingSummaryFilters } from './OnboardingSummaryFilters'
import { OnboardingToolbar, type OnboardingToolbarFilters } from './OnboardingToolbar'
import { VincularFundoDialog } from './VincularFundoDialog'
import { filtrarCedentes, montarCedentesOnboarding } from './utils'
import type {
  CedenteBase,
  CedenteFundoResumo,
  EtapaOnboarding,
  FundoResumo,
  OnboardingCedente,
  OnboardingData,
  OrdenacaoOnboarding,
  PoliticaResumo,
  PoliticaVersaoResumo,
  PoliticaVinculoResumo,
  RequisitoResumo,
} from './types'

type UsuarioFundoRow = {
  fundo_id: string
  perfil_no_fundo: string
  status: string
  fundos: FundoResumo | FundoResumo[] | null
}

function fundoFromUsuarioFundo(row: UsuarioFundoRow): FundoResumo | null {
  if (Array.isArray(row.fundos)) return row.fundos[0] || null
  return row.fundos || null
}

function coerceEtapa(value: string | null): EtapaOnboarding {
  const allowed: EtapaOnboarding[] = ['pendencias', 'sem_fundo', 'sem_politica', 'aptos', 'suspensos', 'todos']
  return allowed.includes(value as EtapaOnboarding) ? value as EtapaOnboarding : 'pendencias'
}

function coerceOrdenacao(value: string | null): OrdenacaoOnboarding {
  const allowed: OrdenacaoOnboarding[] = ['mais_antigo', 'mais_recente', 'razao_social']
  return allowed.includes(value as OrdenacaoOnboarding) ? value as OrdenacaoOnboarding : 'mais_antigo'
}

function initialData(): OnboardingData {
  return { cedentes: [], fundos: [], politicas: [], versoes: [], requisitos: [], hasPermission: true }
}

export function OnboardingCedentesPage() {
  const supabase = useMemo(() => createClient(), [])
  const notifications = useNotifications()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<OnboardingData>(initialData)
  const [vincularCedente, setVincularCedente] = useState<OnboardingCedente | null>(null)
  const [politicaCedente, setPoliticaCedente] = useState<OnboardingCedente | null>(null)
  const [drawerCedente, setDrawerCedente] = useState<OnboardingCedente | null>(null)

  const filters: OnboardingToolbarFilters = useMemo(() => ({
    etapa: coerceEtapa(searchParams.get('etapa')),
    busca: searchParams.get('busca') || '',
    fundoId: searchParams.get('fundo') || 'todos',
    politicaId: searchParams.get('politica') || 'todos',
    status: searchParams.get('status') || 'todos',
    ordenar: coerceOrdenacao(searchParams.get('ordenar')),
  }), [searchParams])

  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1)
  const pageSize = Math.max(5, Math.min(50, Number(searchParams.get('pageSize') || '10') || 10))

  const updateParams = useCallback((patch: Partial<OnboardingToolbarFilters> & { page?: number; pageSize?: number }) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      const param = key === 'fundoId' ? 'fundo' : key === 'politicaId' ? 'politica' : key
      const stringValue = String(value ?? '')
      if (
        !stringValue
        || stringValue === 'todos'
        || (param === 'etapa' && stringValue === 'pendencias')
        || (param === 'ordenar' && stringValue === 'mais_antigo')
        || (param === 'page' && stringValue === '1')
        || (param === 'pageSize' && stringValue === '10')
      ) {
        params.delete(param)
      } else {
        params.set(param, stringValue)
      }
    }
    if (!('page' in patch)) params.delete('page')
    router.replace(`/gestor/onboarding-cedentes${params.toString() ? `?${params.toString()}` : ''}`, { scroll: false })
  }, [router, searchParams])

  const clearFilters = useCallback(() => {
    router.replace('/gestor/onboarding-cedentes', { scroll: false })
  }, [router])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [
      cedentesResult,
      linksResult,
      policyLinksResult,
      versionsResult,
      userFundsResult,
      policiesResult,
      requirementsResult,
    ] = await Promise.all([
      supabase.from('cedentes').select('id, razao_social, nome_fantasia, cnpj, status, created_at').order('created_at', { ascending: false }),
      supabase.from('cedente_fundos').select('id, cedente_id, fundo_id, status, vigente_desde, vigente_ate').order('vigente_desde', { ascending: false }),
      supabase.from('cedente_fundo_politicas').select('id, cedente_fundo_id, politica_operacional_id, status, vigente_desde, vigente_ate'),
      supabase.from('politica_operacional_versoes').select('id, politica_operacional_id, versao, status, publicada_em, vigente_desde, vigente_ate'),
      supabase.from('usuario_fundos').select('fundo_id, perfil_no_fundo, status, fundos(id, nome, cnpj, ativo)').eq('status', 'ativo'),
      supabase.from('politicas_operacionais').select('id, fundo_id, nome, codigo, status, padrao'),
      supabase.from('politica_requisitos_documentais').select('id, politica_operacional_versao_id'),
    ])

    const errors = [
      cedentesResult.error,
      linksResult.error,
      policyLinksResult.error,
      versionsResult.error,
      userFundsResult.error,
      policiesResult.error,
      requirementsResult.error,
    ].filter(Boolean)

    if (errors.length > 0) {
      notifications.error('Nao foi possivel carregar o onboarding de cedentes.', {
        details: errors.map((error) => error?.message).join(' | '),
      })
      setLoading(false)
      return
    }

    const fundos = ((userFundsResult.data || []) as unknown as UsuarioFundoRow[])
      .filter((row) => ['administrador', 'gestor', 'plataforma'].includes(row.perfil_no_fundo))
      .map(fundoFromUsuarioFundo)
      .filter((fundo): fundo is FundoResumo => fundo !== null && Boolean(fundo.id) && fundo.ativo === true)

    const politicas = (policiesResult.data || []) as PoliticaResumo[]
    const versoes = (versionsResult.data || []) as PoliticaVersaoResumo[]
    const requisitos = (requirementsResult.data || []) as RequisitoResumo[]
    const cedentes = montarCedentesOnboarding({
      cedentes: (cedentesResult.data || []) as CedenteBase[],
      links: (linksResult.data || []) as CedenteFundoResumo[],
      fundos,
      vinculosPolitica: (policyLinksResult.data || []) as PoliticaVinculoResumo[],
      politicas,
      versoes,
      requisitos,
    })

    setData({ cedentes, fundos, politicas, versoes, requisitos, hasPermission: fundos.length > 0 })
    setLoading(false)
  }, [notifications, supabase])

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadData()
    }, 0)
    return () => clearTimeout(handle)
  }, [loadData])

  const counts = useMemo<Record<EtapaOnboarding, number>>(() => {
    const semFundo = data.cedentes.filter((row) => row.onboardingStatus === 'aguardando_vinculo_fundo').length
    const semPolitica = data.cedentes.filter((row) => row.onboardingStatus === 'aguardando_politica').length
    const aptos = data.cedentes.filter((row) => row.onboardingStatus === 'apto_operar').length
    const suspensos = data.cedentes.filter((row) => row.onboardingStatus === 'suspenso').length
    return { pendencias: semFundo + semPolitica, sem_fundo: semFundo, sem_politica: semPolitica, aptos, suspensos, todos: data.cedentes.length }
  }, [data.cedentes])

  const filteredRows = useMemo(() => filtrarCedentes({
    rows: data.cedentes,
    etapa: filters.etapa,
    busca: filters.busca,
    fundoId: filters.fundoId,
    politicaId: filters.politicaId,
    status: filters.status,
    ordenar: filters.ordenar,
  }), [data.cedentes, filters])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginatedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  async function handleSuccess() {
    await loadData()
    router.refresh()
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
        </div>
        <Button type="button" variant="outline" onClick={() => void loadData()} disabled={loading}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Atualizar
        </Button>
      </div>

      <OnboardingSummaryFilters etapa={filters.etapa} counts={counts} onChange={(etapa) => updateParams({ etapa })} />
      <OnboardingToolbar key={filters.busca} filters={filters} fundos={data.fundos} politicas={data.politicas} onChange={updateParams} onClear={clearFilters} />

      {!data.hasPermission ? (
        <Card>
          <CardHeader>
            <CardTitle>Acesso operacional indisponivel</CardTitle>
            <CardDescription>Seu usuario nao possui permissao para vincular cedentes em nenhum fundo ativo.</CardDescription>
          </CardHeader>
        </Card>
      ) : loading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Carregando fila de onboarding...</CardContent></Card>
      ) : filteredRows.length === 0 ? (
        <OnboardingEmptyState onClear={clearFilters} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <OnboardingCedentesTable
            rows={paginatedRows}
            fundos={data.fundos}
            onVincularFundo={setVincularCedente}
            onDefinirPolitica={setPoliticaCedente}
            onDetalhes={setDrawerCedente}
          />
          <OnboardingPagination page={safePage} pageSize={pageSize} total={filteredRows.length} onPageChange={(nextPage) => updateParams({ page: nextPage })} />
        </div>
      )}

      <VincularFundoDialog open={Boolean(vincularCedente)} cedente={vincularCedente} fundos={data.fundos} onOpenChange={(open) => !open && setVincularCedente(null)} onSuccess={handleSuccess} />
      <DefinirPoliticaDialog open={Boolean(politicaCedente)} cedente={politicaCedente} data={data} onOpenChange={(open) => !open && setPoliticaCedente(null)} onSuccess={handleSuccess} />
      <CedenteOnboardingDrawer
        open={Boolean(drawerCedente)}
        cedente={drawerCedente}
        fundos={data.fundos}
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
