import type { StatusOnboardingCedente } from '@/lib/fundos/cedente-fundo'

export type EtapaOnboarding = 'pendencias' | 'sem_fundo' | 'sem_politica' | 'aptos' | 'suspensos' | 'todos'
export type OrdenacaoOnboarding = 'mais_antigo' | 'mais_recente' | 'razao_social'

export type CedenteBase = {
  id: string
  razao_social: string
  nome_fantasia: string | null
  cnpj: string
  status: string
  created_at: string
}

export type FundoResumo = {
  id: string
  nome: string
  cnpj: string
  ativo: boolean | null
}

export type CedenteFundoResumo = {
  id: string
  cedente_id: string
  fundo_id: string
  status: string
  vigente_desde: string
  vigente_ate: string | null
}

export type PoliticaResumo = {
  id: string
  fundo_id: string
  nome: string
  codigo: string
  status: string
  padrao: boolean
}

export type PoliticaVersaoResumo = {
  id: string
  politica_operacional_id: string
  versao: number
  status: string
  publicada_em: string | null
  vigente_desde: string
  vigente_ate: string | null
}

export type PoliticaVinculoResumo = {
  id: string
  cedente_fundo_id: string
  politica_operacional_id: string
  status: string
  vigente_desde: string
  vigente_ate: string | null
}

export type RequisitoResumo = {
  politica_operacional_versao_id: string
  id: string
}

export type OnboardingCedente = CedenteBase & {
  onboardingStatus: StatusOnboardingCedente
  activeLinks: CedenteFundoResumo[]
  suspendedLinks: CedenteFundoResumo[]
  fundoPrincipal: FundoResumo | null
  politicaPrincipal: PoliticaResumo | null
  versaoPrincipal: PoliticaVersaoResumo | null
  requisitoCount: number
}

export type OnboardingData = {
  cedentes: OnboardingCedente[]
  fundos: FundoResumo[]
  politicas: PoliticaResumo[]
  versoes: PoliticaVersaoResumo[]
  requisitos: RequisitoResumo[]
  hasPermission: boolean
}
