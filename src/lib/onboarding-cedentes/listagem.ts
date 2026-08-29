import type { CedenteStatus } from '@/lib/types/domain'
import type { StatusOnboardingCedente } from '@/lib/fundos/cedente-fundo'
import {
  buildOffsetRange,
  normalizarBusca,
  parsePaginationParams,
  parseSortParams,
  type AllowedPageSize,
  type PaginationMeta,
  type SortDirection,
} from '@/lib/pagination'

export const ETAPAS_ONBOARDING = [
  'pendencias',
  'sem_fundo',
  'sem_politica',
  'aptos',
  'suspensos',
  'todos',
] as const

export type EtapaOnboarding = (typeof ETAPAS_ONBOARDING)[number]

export const CAMPOS_ORDENACAO_ONBOARDING = [
  'created_at',
  'updated_at',
  'razao_social',
] as const

export type CampoOrdenacaoOnboarding = (typeof CAMPOS_ORDENACAO_ONBOARDING)[number]

export type FiltrosOnboarding = {
  pagina: number
  limite: AllowedPageSize
  busca: string
  etapa: EtapaOnboarding
  statusCadastral: CedenteStatus | null
  politicaId: string | null
  ordenacao: CampoOrdenacaoOnboarding
  direcao: SortDirection
}

export type FundoOnboardingResumo = {
  id: string
  nome: string
  cnpj: string | null
}

export type VinculoOnboardingResumo = {
  id: string
  status: string
  vigenteDesde: string
  vigenteAte: string | null
}

export type PoliticaOnboardingResumo = {
  id: string
  nome: string
  codigo: string
  versaoId: string
  numeroVersao: number
  publicadaEm: string
  requisitoCount: number
}

export type OnboardingCedenteItem = {
  id: string
  razaoSocial: string
  nomeFantasia: string | null
  cnpj: string
  statusCadastral: CedenteStatus
  createdAt: string
  updatedAt: string
  onboardingStatus: StatusOnboardingCedente
  vinculo: VinculoOnboardingResumo | null
  fundo: FundoOnboardingResumo | null
  politica: PoliticaOnboardingResumo | null
}

export type ContagensOnboarding = Record<EtapaOnboarding, number>

export type ResultadoOnboarding = {
  items: OnboardingCedenteItem[]
  pagination: PaginationMeta
  counts: ContagensOnboarding
  fundoAtivo: FundoOnboardingResumo | null
  politicasFiltro: Array<Pick<PoliticaOnboardingResumo, 'id' | 'nome'>>
}

export type PoliticaOnboardingOpcao = {
  id: string
  nome: string
  codigo: string
  versaoId: string
  numeroVersao: number
  publicadaEm: string
  requisitoCount: number
}

export type ContextoOnboardingCedente = {
  cedente: {
    id: string
    razaoSocial: string
    nomeFantasia: string | null
    cnpj: string
    statusCadastral: string
    createdAt: string
  }
  fundo: FundoOnboardingResumo
  vinculo: VinculoOnboardingResumo | null
  politicaAtual: PoliticaOnboardingOpcao | null
  politicasDisponiveis: PoliticaOnboardingOpcao[]
}

type RpcPayload = {
  items?: OnboardingCedenteItem[]
  total?: number
  counts?: Partial<ContagensOnboarding>
}

function inteiroSeguro(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

export function normalizarPayloadOnboarding(value: unknown): {
  items: OnboardingCedenteItem[]
  total: number
  counts: ContagensOnboarding
} {
  const payload = value && typeof value === 'object' ? value as RpcPayload : {}
  const counts = payload.counts || {}
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    total: inteiroSeguro(payload.total),
    counts: {
      pendencias: inteiroSeguro(counts.pendencias),
      sem_fundo: inteiroSeguro(counts.sem_fundo),
      sem_politica: inteiroSeguro(counts.sem_politica),
      aptos: inteiroSeguro(counts.aptos),
      suspensos: inteiroSeguro(counts.suspensos),
      todos: inteiroSeguro(counts.todos),
    },
  }
}

const CEDENTE_STATUS = new Set<CedenteStatus>([
  'pendente',
  'em_analise',
  'ativo',
  'reprovado',
  'bloqueado',
])

function primeiroValor(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function uuidOpcional(value: string | string[] | undefined) {
  const raw = primeiroValor(value)?.trim()
  return raw && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(raw) ? raw : null
}

export function parseFiltrosOnboarding(
  params: Record<string, string | string[] | undefined>,
): FiltrosOnboarding {
  const pagination = parsePaginationParams(params)
  const sort = parseSortParams({
    sort: params.sort ?? params.ordenar,
    direction: params.direction,
    allowedFields: CAMPOS_ORDENACAO_ONBOARDING,
    defaultField: 'created_at',
    defaultDirection: 'asc',
  })
  const etapaRaw = primeiroValor(params.etapa)
  const statusRaw = primeiroValor(params.status)

  return {
    pagina: pagination.page,
    limite: pagination.pageSize,
    busca: normalizarBusca(primeiroValor(params.q) ?? primeiroValor(params.busca), 120),
    etapa: etapaRaw && ETAPAS_ONBOARDING.includes(etapaRaw as EtapaOnboarding)
      ? etapaRaw as EtapaOnboarding
      : 'pendencias',
    statusCadastral: statusRaw && CEDENTE_STATUS.has(statusRaw as CedenteStatus)
      ? statusRaw as CedenteStatus
      : null,
    politicaId: uuidOpcional(params.politica),
    ordenacao: sort.field,
    direcao: sort.direction,
  }
}

export function intervaloOnboarding(
  filtros: Pick<FiltrosOnboarding, 'pagina' | 'limite'>,
) {
  return buildOffsetRange({ page: filtros.pagina, pageSize: filtros.limite })
}
