import {
  normalizarBusca,
  parsePaginationParams,
  parseSortParams,
  type SearchParamsRecord,
  type SortDirection,
} from '@/lib/pagination'

export const CAMPOS_ORDENACAO_NOVA_SOLICITACAO = [
  'data_vencimento',
  'valor_bruto',
  'numero_nf',
] as const

export type CampoOrdenacaoNovaSolicitacao =
  (typeof CAMPOS_ORDENACAO_NOVA_SOLICITACAO)[number]

export type FiltrosNovaSolicitacao = {
  page: number
  pageSize: 10 | 20 | 40
  q: string
  sort: CampoOrdenacaoNovaSolicitacao
  direction: SortDirection
}

function primeiro(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function parseFiltrosNovaSolicitacao(
  searchParams: SearchParamsRecord,
): FiltrosNovaSolicitacao {
  const pagination = parsePaginationParams(searchParams)
  const sort = parseSortParams({
    sort: searchParams.sort,
    direction: searchParams.direction,
    allowedFields: CAMPOS_ORDENACAO_NOVA_SOLICITACAO,
    defaultField: 'data_vencimento',
    defaultDirection: 'asc',
  })
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    q: normalizarBusca(primeiro(searchParams.q), 120),
    sort: sort.field,
    direction: sort.direction,
  }
}
