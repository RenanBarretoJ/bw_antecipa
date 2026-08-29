import {
  normalizeSearch,
  parsePaginationParams,
  parseSortParams,
  readSearchParam,
  type PaginatedResult,
  type SearchParamsInput,
  type SortDirection,
} from '@/lib/pagination'

export const ESCROW_STATUS = ['ativa', 'bloqueada', 'encerrada'] as const
export const ESCROW_SORT = ['created_at', 'identificador', 'saldo_disponivel', 'status'] as const
export type EscrowStatus = (typeof ESCROW_STATUS)[number]
export type EscrowSort = (typeof ESCROW_SORT)[number]

export interface FiltrosEscrow {
  page: number
  pageSize: 10 | 20 | 40
  q: string
  status: EscrowStatus | null
  cedenteId: string | null
  sort: EscrowSort
  direction: SortDirection
}

export interface ContaEscrowListagemItem {
  id: string
  cedenteId: string
  identificador: string
  saldoDisponivel: number
  saldoBloqueado: number
  status: string
  criadoEm: string
  cedente: { nome: string; cnpj: string }
}

export interface ResultadoEscrow extends PaginatedResult<ContaEscrowListagemItem> {
  metricasPagina: {
    ativas: number
    saldoDisponivel: number
    saldoBloqueado: number
  }
}

export function parseFiltrosEscrow(input: SearchParamsInput): FiltrosEscrow {
  const pagination = parsePaginationParams(input)
  const statusRaw = readSearchParam(input, 'status')
  const cedenteId = readSearchParam(input, 'cedente')
  const sort = parseSortParams({
    sort: readSearchParam(input, 'sort'),
    direction: readSearchParam(input, 'direction'),
    allowedFields: ESCROW_SORT,
    defaultField: 'created_at',
  })
  return {
    ...pagination,
    q: normalizeSearch(readSearchParam(input, 'q')),
    status: ESCROW_STATUS.includes(statusRaw as EscrowStatus) ? statusRaw as EscrowStatus : null,
    cedenteId: cedenteId && /^[0-9a-f-]{36}$/i.test(cedenteId) ? cedenteId : null,
    sort: sort.field,
    direction: sort.direction,
  }
}

export function calcularMetricasPaginaEscrow(items: ContaEscrowListagemItem[]) {
  return items.reduce((acc, item) => ({
    ativas: acc.ativas + (item.status === 'ativa' ? 1 : 0),
    saldoDisponivel: acc.saldoDisponivel + item.saldoDisponivel,
    saldoBloqueado: acc.saldoBloqueado + item.saldoBloqueado,
  }), { ativas: 0, saldoDisponivel: 0, saldoBloqueado: 0 })
}
