import type { NfStatus } from '@/lib/types/domain'
import {
  normalizeSearch,
  parsePaginationParams,
  parseSortParams,
  readSearchParam,
  type PaginatedResult,
  type SearchParamsInput,
} from '@/lib/pagination'

export const CAMPOS_ORDENACAO_NF_GESTOR = [
  'created_at',
  'updated_at',
  'data_emissao',
  'data_vencimento',
  'valor_bruto',
  'numero_nf',
  'status',
] as const

export type CampoOrdenacaoNfGestor = (typeof CAMPOS_ORDENACAO_NF_GESTOR)[number]

const STATUS_VALIDOS = new Set<NfStatus>([
  'rascunho',
  'submetida',
  'em_analise',
  'aprovada',
  'em_antecipacao',
  'aceita',
  'contestada',
  'liquidada',
  'cancelada',
  'requer_ajuste',
])

export type FiltrosNotasFiscaisGestor = {
  page: number
  pageSize: 10 | 20 | 40
  q: string
  status: NfStatus | null
  cedenteId: string | null
  vencimentoDe: string
  vencimentoAte: string
  sort: CampoOrdenacaoNfGestor
  direction: 'asc' | 'desc'
}

export type ResumoDocumentalNotaGestor = {
  totalObrigatorios: number
  totalSatisfeitos: number
  totalPendentes: number
  possuiRejeicao: boolean
  elegivel: boolean
}

export type NotaFiscalGestorListagemItem = {
  id: string
  numero: string
  serie: string | null
  chaveAcesso: string | null
  status: NfStatus
  cedente: { id: string; nome: string; cnpj: string }
  sacado: { nome: string | null; cnpj: string | null }
  valorBruto: number
  emissaoEm: string | null
  vencimentoEm: string | null
  operacao: { id: string; codigo: string } | null
  resumoDocumental: ResumoDocumentalNotaGestor
  criadoEm: string
  atualizadoEm: string
}

export type ResultadoNotasFiscaisGestor = PaginatedResult<NotaFiscalGestorListagemItem> & {
  metricasPagina: {
    pendentes: number
    aprovadas: number
    valor: number
  }
  cedentes: Array<{ id: string; nome: string }>
}

function dataValida(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

export function parseFiltrosNotasFiscaisGestor(
  searchParams: SearchParamsInput,
): FiltrosNotasFiscaisGestor {
  const pagination = parsePaginationParams(searchParams)
  const statusRaw = readSearchParam(searchParams, 'status')
  const sort = parseSortParams({
    sort: readSearchParam(searchParams, 'sort'),
    direction: readSearchParam(searchParams, 'direction'),
    allowedFields: CAMPOS_ORDENACAO_NF_GESTOR,
    defaultField: 'created_at',
    defaultDirection: 'desc',
  })

  return {
    ...pagination,
    q: normalizeSearch(readSearchParam(searchParams, 'q')),
    status: statusRaw && STATUS_VALIDOS.has(statusRaw as NfStatus)
      ? statusRaw as NfStatus
      : null,
    cedenteId: readSearchParam(searchParams, 'cedente') || null,
    vencimentoDe: dataValida(readSearchParam(searchParams, 'vencimentoDe')),
    vencimentoAte: dataValida(readSearchParam(searchParams, 'vencimentoAte')),
    sort: sort.field,
    direction: sort.direction,
  }
}

export function calcularMetricasPaginaNotasGestor(
  items: NotaFiscalGestorListagemItem[],
) {
  return {
    pendentes: items.filter((item) => ['submetida', 'em_analise'].includes(item.status)).length,
    aprovadas: items.filter((item) => item.status === 'aprovada').length,
    valor: items
      .filter((item) => item.status !== 'cancelada')
      .reduce((total, item) => total + item.valorBruto, 0),
  }
}
