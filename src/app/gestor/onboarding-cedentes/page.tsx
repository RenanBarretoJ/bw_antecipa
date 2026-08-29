import { connection } from 'next/server'
import { redirect } from 'next/navigation'
import { OnboardingCedentesPage } from '@/components/onboarding-cedentes/OnboardingCedentesPage'
import { buildListUrl } from '@/lib/pagination'
import { parseFiltrosOnboarding } from '@/lib/onboarding-cedentes/listagem'
import { carregarOnboardingCedentesPaginado } from '@/lib/onboarding-cedentes/listagem.server'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const params = await searchParams
  const filtros = parseFiltrosOnboarding(params)
  const resultado = await carregarOnboardingCedentesPaginado(filtros)

  if (resultado.pagination.wasPageAdjusted) {
    redirect(buildListUrl('/gestor/onboarding-cedentes', params, {
      page: resultado.pagination.page,
    }))
  }

  return <OnboardingCedentesPage filtros={filtros} resultado={resultado} />
}
