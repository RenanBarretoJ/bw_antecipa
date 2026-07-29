import type { OperacaoStatus } from '@/lib/types/domain'
import {
  ALLOWED_PAGE_SIZES,
  buildOffsetRange,
  normalizarBusca,
  parsePaginationParams,
  parseSortParams,
  type AllowedPageSize,
  type SortDirection,
} from '@/lib/pagination'

export const CAMPOS_ORDENACAO_OPERACOES = [
  'created_at',
  'valor_bruto_total',
  'taxa_desconto',
  'prazo_dias',
  'valor_liquido_desembolso',
  'data_vencimento',
  'status',
  'aprovado_em',
] as const

export type CampoOrdenacaoOperacoes = (typeof CAMPOS_ORDENACAO_OPERACOES)[number]

export type FiltrosOperacoes = {
  pagina: number
  limite: AllowedPageSize
  busca: string
  status: OperacaoStatus | null
  ordenacao: CampoOrdenacaoOperacoes
  direcao: SortDirection
  valorMin: number | null
  valorMax: number | null
  aprovadoDe: string
  aprovadoAte: string
}

export type OperacaoListagemItem = {
  id: string
  cedenteId: string
  cedenteFundoId: string | null
  cedenteNome: string
  cedenteCnpj: string
  valorBruto: number
  taxaDesconto: number
  prazoDias: number
  valorLiquido: number
  vencimento: string
  status: string
  criadoEm: string
  aprovadoEm: string | null
  aceiteSacadoExigido: boolean | null
  aceiteSacadoStatus: string | null
}

export type MetricasPaginaOperacoes = {
  aguardandoAceite: number
  prontasAnalise: number
  pendentes: number
  emAndamento: number
  volumeAtivo: number
}

const STATUS_VALIDOS = new Set<OperacaoStatus>([
  'solicitada',
  'em_analise',
  'aprovada',
  'em_andamento',
  'liquidada',
  'inadimplente',
  'reprovada',
  'cancelada',
])

function primeiroValor(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function numeroOpcional(value: string | undefined) {
  if (!value?.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function parseFiltrosOperacoes(
  params: Record<string, string | string[] | undefined>,
): FiltrosOperacoes {
  const statusRaw = primeiroValor(params.status)
  const pagination = parsePaginationParams(params)
  const sort = parseSortParams({
    sort: params.sort,
    direction: params.direction,
    allowedFields: CAMPOS_ORDENACAO_OPERACOES,
    defaultField: 'created_at',
  })

  return {
    pagina: pagination.page,
    limite: pagination.pageSize,
    busca: normalizarBusca(primeiroValor(params.q), 120),
    status: statusRaw && STATUS_VALIDOS.has(statusRaw as OperacaoStatus)
      ? statusRaw as OperacaoStatus
      : null,
    ordenacao: sort.field,
    direcao: sort.direction,
    valorMin: numeroOpcional(primeiroValor(params.valorMin)),
    valorMax: numeroOpcional(primeiroValor(params.valorMax)),
    aprovadoDe: primeiroValor(params.aprovadoDe)?.trim() || '',
    aprovadoAte: primeiroValor(params.aprovadoAte)?.trim() || '',
  }
}

export function intervaloOperacoes(filtros: Pick<FiltrosOperacoes, 'pagina' | 'limite'>) {
  return buildOffsetRange({ page: filtros.pagina, pageSize: filtros.limite })
}

export function calcularMetricasPaginaOperacoes(
  itens: readonly OperacaoListagemItem[],
): MetricasPaginaOperacoes {
  return {
    aguardandoAceite: itens.filter((item) => (
      ['solicitada', 'em_analise'].includes(item.status)
      && item.aceiteSacadoExigido !== false
      && item.aceiteSacadoStatus !== 'aceito'
    )).length,
    prontasAnalise: itens.filter((item) => (
      ['solicitada', 'em_analise'].includes(item.status)
      && (
        item.aceiteSacadoExigido === false
        || item.aceiteSacadoStatus === 'dispensado'
        || item.aceiteSacadoStatus === 'aceito'
      )
    )).length,
    pendentes: itens.filter((item) => ['solicitada', 'em_analise'].includes(item.status)).length,
    emAndamento: itens.filter((item) => item.status === 'em_andamento').length,
    volumeAtivo: itens
      .filter((item) => item.status === 'em_andamento')
      .reduce((total, item) => total + item.valorLiquido, 0),
  }
}

export { ALLOWED_PAGE_SIZES }
