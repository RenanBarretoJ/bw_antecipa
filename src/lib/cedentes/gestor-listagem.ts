import {
  normalizeSearch,
  parsePaginationParams,
  parseSortParams,
  readSearchParam,
  type PaginatedResult,
  type SearchParamsInput,
  type SortDirection,
} from '@/lib/pagination'

export const CEDENTE_STATUS = ['pendente', 'em_analise', 'ativo', 'reprovado', 'bloqueado'] as const
export const CEDENTE_SORT = ['created_at', 'razao_social', 'status'] as const
export type CedenteStatusFiltro = (typeof CEDENTE_STATUS)[number]
export type CedenteSort = (typeof CEDENTE_SORT)[number]

export interface FiltrosCedentesGestor {
  page: number
  pageSize: 10 | 20 | 40
  q: string
  status: CedenteStatusFiltro | null
  politicaId: string | null
  sort: CedenteSort
  direction: SortDirection
}

export interface CedenteGestorItem {
  id: string
  cedenteFundoId: string
  cnpj: string
  razaoSocial: string
  status: string
  criadoEm: string
  politica: { id: string; nome: string } | null
}

export type ResultadoCedentesGestor = PaginatedResult<CedenteGestorItem>

export function parseFiltrosCedentesGestor(input: SearchParamsInput): FiltrosCedentesGestor {
  const pagination = parsePaginationParams(input)
  const statusRaw = readSearchParam(input, 'status')
  const politicaId = readSearchParam(input, 'politica')
  const sort = parseSortParams({
    sort: readSearchParam(input, 'sort'),
    direction: readSearchParam(input, 'direction'),
    allowedFields: CEDENTE_SORT,
    defaultField: 'created_at',
  })

  return {
    ...pagination,
    q: normalizeSearch(readSearchParam(input, 'q')),
    status: CEDENTE_STATUS.includes(statusRaw as CedenteStatusFiltro) ? statusRaw as CedenteStatusFiltro : null,
    politicaId: politicaId && /^[0-9a-f-]{36}$/i.test(politicaId) ? politicaId : null,
    sort: sort.field,
    direction: sort.direction,
  }
}
