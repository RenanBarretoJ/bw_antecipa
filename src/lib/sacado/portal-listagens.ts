import {
  normalizeSearch,
  parsePaginationParams,
  parseSortParams,
  readSearchParam,
  type PaginatedResult,
  type SearchParamsInput,
} from '@/lib/pagination'
import type { NfStatus, OperacaoStatus } from '@/lib/types/domain'

export const CAMPOS_ORDENACAO_NFS_SACADO = [
  'created_at',
  'data_emissao',
  'data_vencimento',
  'valor_bruto',
  'numero_nf',
  'status',
] as const

export const CAMPOS_ORDENACAO_APROVACAO_SACADO = [
  'created_at',
  'data_vencimento',
  'valor_bruto',
  'numero_nf',
] as const

export const CAMPOS_ORDENACAO_PAGAMENTOS_SACADO = [
  'liquidada_em',
  'data_vencimento',
  'valor_bruto_total',
] as const

export type CampoOrdenacaoNfSacado = (typeof CAMPOS_ORDENACAO_NFS_SACADO)[number]
export type CampoOrdenacaoAprovacaoSacado = (typeof CAMPOS_ORDENACAO_APROVACAO_SACADO)[number]
export type CampoOrdenacaoPagamentoSacado = (typeof CAMPOS_ORDENACAO_PAGAMENTOS_SACADO)[number]

const STATUS_NF_VALIDOS = [
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
] as const satisfies readonly NfStatus[]

const STATUS_PAGAMENTO_VALIDOS = [
  'em_andamento',
  'liquidada',
  'inadimplente',
] as const satisfies readonly OperacaoStatus[]

function isStatusNf(value: string): value is NfStatus {
  return (STATUS_NF_VALIDOS as readonly string[]).includes(value)
}

function isStatusPagamento(
  value: string,
): value is (typeof STATUS_PAGAMENTO_VALIDOS)[number] {
  return (STATUS_PAGAMENTO_VALIDOS as readonly string[]).includes(value)
}

export type FiltrosNfsSacado = {
  page: number
  pageSize: 10 | 20 | 40
  q: string
  status: NfStatus | null
  sort: CampoOrdenacaoNfSacado
  direction: 'asc' | 'desc'
}

export type FiltrosAprovacoesSacado = {
  page: number
  pageSize: 10 | 20 | 40
  q: string
  cedenteId: string | null
  vencimentoDe: string
  vencimentoAte: string
  valorMinimo: number | null
  valorMaximo: number | null
  sort: CampoOrdenacaoAprovacaoSacado
  direction: 'asc' | 'desc'
}

export type FiltrosPagamentosSacado = {
  page: number
  pageSize: 10 | 20 | 40
  q: string
  status: Extract<OperacaoStatus, 'em_andamento' | 'liquidada' | 'inadimplente'> | null
  sort: CampoOrdenacaoPagamentoSacado
  direction: 'asc' | 'desc'
}

export type OperacaoCompactaSacado = {
  id: string
  codigo: string
  status: string
  aceiteSacadoExigido: boolean | null
  aceiteSacadoStatus: string | null
}

export type NotaFiscalSacadoListagemItem = {
  id: string
  numero: string
  serie: string | null
  chaveAcesso: string | null
  cedente: { id: string; nome: string; cnpj: string }
  valor: number
  emissaoEm: string | null
  vencimentoEm: string | null
  status: string
  situacaoAprovacao: string
  operacao: OperacaoCompactaSacado | null
  criadoEm: string
  possuiArquivo: boolean
}

export type AprovacaoSacadoItem = {
  notaFiscalId: string
  numero: string
  cedente: { id: string; nome: string; cnpj: string }
  valor: number
  emissaoEm: string | null
  vencimentoEm: string | null
  operacao: {
    id: string
    codigo: string
    contaEscrow: string | null
  }
  statusAprovacao: string
  solicitadoEm: string | null
  possuiArquivo: boolean
}

export type PagamentoSacadoItem = {
  id: string
  codigo: string
  cedente: { id: string; nome: string; cnpj: string }
  valorOriginal: number
  valorLiquido: number
  vencimentoEm: string | null
  pagoEm: string | null
  status: string
  contaEscrow: string | null
}

export type ResultadoNfsSacado = PaginatedResult<NotaFiscalSacadoListagemItem> & {
  indicadores: {
    total: number
    cedidas: number
    liquidadas: number
    vencidas: number
  }
}

export type ResultadoAprovacoesSacado = PaginatedResult<AprovacaoSacadoItem> & {
  cedentes: Array<{ id: string; nome: string; cnpj: string }>
  valorPagina: number
}

export type ResultadoPagamentosSacado = PaginatedResult<PagamentoSacadoItem> & {
  indicadoresPagina: {
    totalAPagar: number
    totalPago: number
    totalOperacoes: number
  }
}

export type DashboardSacado = {
  indicadores: {
    totalDevido: number
    nfsAtivas: number
    vencidas: number
    valorVencido: number
    vencemHoje: number
    valorVenceHoje: number
    proximos7Dias: number
    valorProximos7Dias: number
  }
  proximosVencimentos: Array<{
    id: string
    numero: string
    cedenteNome: string
    cedenteCnpj: string
    valor: number
    vencimentoEm: string
  }>
  cedentesEmAberto: Array<{
    cedenteId: string
    nome: string
    cnpj: string
    totalDevido: number
    quantidadeNfs: number
    quantidadeOperacoes: number
    proximoVencimento: string
    contaEscrow: string | null
  }>
}

function dataValida(value: string | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

function numeroNaoNegativo(value: string | undefined): number | null {
  if (!value?.trim()) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function parseFiltrosNfsSacado(searchParams: SearchParamsInput): FiltrosNfsSacado {
  const pagination = parsePaginationParams(searchParams)
  const status = readSearchParam(searchParams, 'status')
  const sort = parseSortParams({
    sort: readSearchParam(searchParams, 'sort'),
    direction: readSearchParam(searchParams, 'direction'),
    allowedFields: CAMPOS_ORDENACAO_NFS_SACADO,
    defaultField: 'created_at',
    defaultDirection: 'desc',
  })

  return {
    ...pagination,
    q: normalizeSearch(readSearchParam(searchParams, 'q')),
    status: status && isStatusNf(status) ? status : null,
    sort: sort.field,
    direction: sort.direction,
  }
}

export function parseFiltrosAprovacoesSacado(
  searchParams: SearchParamsInput,
): FiltrosAprovacoesSacado {
  const pagination = parsePaginationParams(searchParams)
  const sort = parseSortParams({
    sort: readSearchParam(searchParams, 'sort'),
    direction: readSearchParam(searchParams, 'direction'),
    allowedFields: CAMPOS_ORDENACAO_APROVACAO_SACADO,
    defaultField: 'created_at',
    defaultDirection: 'desc',
  })

  return {
    ...pagination,
    q: normalizeSearch(readSearchParam(searchParams, 'q')),
    cedenteId: readSearchParam(searchParams, 'cedente') || null,
    vencimentoDe: dataValida(readSearchParam(searchParams, 'vencimentoDe')),
    vencimentoAte: dataValida(readSearchParam(searchParams, 'vencimentoAte')),
    valorMinimo: numeroNaoNegativo(readSearchParam(searchParams, 'valorMinimo')),
    valorMaximo: numeroNaoNegativo(readSearchParam(searchParams, 'valorMaximo')),
    sort: sort.field,
    direction: sort.direction,
  }
}

export function parseFiltrosPagamentosSacado(
  searchParams: SearchParamsInput,
): FiltrosPagamentosSacado {
  const pagination = parsePaginationParams(searchParams)
  const status = readSearchParam(searchParams, 'status')
  const sort = parseSortParams({
    sort: readSearchParam(searchParams, 'sort'),
    direction: readSearchParam(searchParams, 'direction'),
    allowedFields: CAMPOS_ORDENACAO_PAGAMENTOS_SACADO,
    defaultField: 'liquidada_em',
    defaultDirection: 'desc',
  })

  return {
    ...pagination,
    q: normalizeSearch(readSearchParam(searchParams, 'q')),
    status: status && isStatusPagamento(status) ? status : null,
    sort: sort.field,
    direction: sort.direction,
  }
}

export function calcularIndicadoresPaginaPagamentos(items: PagamentoSacadoItem[]) {
  return {
    totalAPagar: items
      .filter((item) => item.status === 'em_andamento')
      .reduce((total, item) => total + item.valorOriginal, 0),
    totalPago: items
      .filter((item) => item.status === 'liquidada')
      .reduce((total, item) => total + item.valorOriginal, 0),
    totalOperacoes: items.length,
  }
}
