import type { PaginatedResult, SearchParamsInput, SortDirection } from '@/lib/pagination'
import {
  normalizeSearch,
  parsePaginationParams,
  parseSortParams,
  readSearchParam,
} from '@/lib/pagination'
import type { VisaoExposicaoOperacional } from '@/lib/financeiro/risco/visao-operacional'

export const OPERACAO_STATUS_RELATORIO = [
  'solicitada',
  'em_analise',
  'aprovada',
  'em_andamento',
  'liquidada',
  'inadimplente',
  'reprovada',
  'cancelada',
] as const

export type OperacaoStatusRelatorio = (typeof OPERACAO_STATUS_RELATORIO)[number]

export const RELATORIO_SORT_FIELDS = [
  'volume_total',
  'volume_mes',
  'operacoes_total',
  'cedente',
] as const

export type RelatorioSortField = (typeof RELATORIO_SORT_FIELDS)[number]

export type RelatorioFiltros = {
  mes: string
  q: string
  status: OperacaoStatusRelatorio | null
  cedenteId: string | null
  dataInicial: string | null
  dataFinal: string | null
  page: number
  pageSize: 10 | 20 | 40
  sort: RelatorioSortField
  direction: SortDirection
}

export type OperacaoRecenteAnalytics = {
  id: string
  cedenteNome: string
  valorBruto: number
  status: string
  aceiteSacadoExigido: boolean | null
  aceiteSacadoStatus: string | null
  dataVencimento: string
  createdAt: string
}

export type GestorDashboardData = {
  fundo: { id: string; nome: string }
  totalCedentes: number
  cedentesAtivos: number
  docsPendentes: number
  opsAtivas: number
  opsSolicitadas: number
  opsInadimplentes: number
  volumeAtivo: number
  volumeMes: number
  saldoEscrowTotal: number
  nfsPendentes: number
  entregasEmTransito: number
  entregasComPendencia: number
  entregasEntregues: number
  operacoesRecentes: OperacaoRecenteAnalytics[]
}

export type CedenteDashboardData = {
  saldoDisponivel: number
  contaEscrow: string | null
  habilitarEscrow: boolean
  nfsAprovadas: number
  nfsTotal: number
  opsAtivas: number
  volumeAtivo: number
  docsReprovados: number
  operacoesRecentes: OperacaoRecenteAnalytics[]
  exposicaoLogistica: VisaoExposicaoOperacional | null
}

export type ConsultorDashboardData = {
  cedentesTotal: number
  cedentesAtivos: number
  opsAtivas: number
  volumeAtivo: number
  volumeMes: number
  comissaoEstimada: number
  operacoesRecentes: OperacaoRecenteAnalytics[]
  carteiraRecente: Array<{
    cedenteId: string
    razaoSocial: string
    cnpj: string
    status: string
    comissaoPercentual: number
  }>
}

export type GestorRelatorioResumo = {
  volumeBrutoMes: number
  receitaMes: number
  taxaMedia: number
  operacoesValidasMes: number
  operacoesAtivasMes: number
  operacoesLiquidadasMes: number
  operacoesInadimplentesMes: number
  operacoesAguardandoAceiteMes: number
  operacoesProntasAnaliseMes: number
  operacoesReprovadasMes: number
  operacoesCanceladasMes: number
  volumeTotalGeral: number
  operacoesTotalGeral: number
  mesesDisponiveis: string[]
}

export type GestorRelatorioLinha = {
  cedenteId: string
  razaoSocial: string
  cnpj: string
  volumeMes: number
  operacoesMes: number
  volumeTotal: number
  operacoesTotal: number
  inadimplentes: number
}

export type ConsultorRelatorioResumo = {
  volumeMes: number
  operacoesMes: number
  comissaoMes: number
  volumeAcumulado: number
  cedentesAtivos: number
  mesesDisponiveis: string[]
}

export type ConsultorRelatorioLinha = {
  cedenteId: string
  razaoSocial: string
  cnpj: string
  status: string
  percentual: number
  volumeMes: number
  comissaoMes: number
  operacoesMes: number
  volumeTotal: number
}

export type GestorRelatorioData = {
  fundo: { id: string; nome: string }
  filtros: RelatorioFiltros
  resumo: GestorRelatorioResumo
  tabela: PaginatedResult<GestorRelatorioLinha>
}

export type ConsultorRelatorioData = {
  filtros: RelatorioFiltros
  resumo: ConsultorRelatorioResumo
  tabela: PaginatedResult<ConsultorRelatorioLinha>
}

const MES_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
const DATA_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function mesAtualUtc(): string {
  return new Date().toISOString().slice(0, 7)
}

function dataValida(value: string | undefined): string | null {
  return value && DATA_PATTERN.test(value) ? value : null
}

export function parseRelatorioFiltros(searchParams: SearchParamsInput): RelatorioFiltros {
  const pagination = parsePaginationParams(searchParams, { page: 1, pageSize: 10 })
  const mesParam = readSearchParam(searchParams, 'mes')
  const statusParam = readSearchParam(searchParams, 'status')
  const cedenteParam = readSearchParam(searchParams, 'cedente')
  const sort = parseSortParams({
    sort: readSearchParam(searchParams, 'sort'),
    direction: readSearchParam(searchParams, 'direction'),
    allowedFields: RELATORIO_SORT_FIELDS,
    defaultField: 'volume_total',
    defaultDirection: 'desc',
  })

  return {
    mes: mesParam && MES_PATTERN.test(mesParam) ? mesParam : mesAtualUtc(),
    q: normalizeSearch(readSearchParam(searchParams, 'q'), 120),
    status: statusParam && OPERACAO_STATUS_RELATORIO.includes(statusParam as OperacaoStatusRelatorio)
      ? statusParam as OperacaoStatusRelatorio
      : null,
    cedenteId: cedenteParam && UUID_PATTERN.test(cedenteParam) ? cedenteParam : null,
    dataInicial: dataValida(readSearchParam(searchParams, 'dataInicial')),
    dataFinal: dataValida(readSearchParam(searchParams, 'dataFinal')),
    page: pagination.page,
    pageSize: pagination.pageSize,
    sort: sort.field,
    direction: sort.direction,
  }
}
