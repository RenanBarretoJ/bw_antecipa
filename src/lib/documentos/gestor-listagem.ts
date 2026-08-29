import {
  normalizeSearch,
  parsePaginationParams,
  parseSortParams,
  readSearchParam,
  type PaginatedResult,
  type SearchParamsInput,
} from '@/lib/pagination'

export const CAMPOS_ORDENACAO_DOCUMENTO_GESTOR = [
  'created_at',
  'updated_at',
  'status',
  'tipo',
] as const

export type CampoOrdenacaoDocumentoGestor =
  (typeof CAMPOS_ORDENACAO_DOCUMENTO_GESTOR)[number]

export const STATUS_DOCUMENTO_GESTOR = [
  'aguardando_envio',
  'enviado',
  'em_analise',
  'aprovado',
  'reprovado',
] as const

export type StatusDocumentoGestor = (typeof STATUS_DOCUMENTO_GESTOR)[number]

const STATUS_VALIDOS = new Set<string>(STATUS_DOCUMENTO_GESTOR)

export type FiltrosDocumentosGestor = {
  page: number
  pageSize: 10 | 20 | 40
  q: string
  status: StatusDocumentoGestor | null
  sort: CampoOrdenacaoDocumentoGestor
  direction: 'asc' | 'desc'
}

export type EscopoDocumentoGestor =
  | { tipo: 'empresa' }
  | { tipo: 'representante'; nome: string }

export type DocumentoGestorListagemItem = {
  id: string
  tipo: string
  nome: string
  status: string
  escopo: EscopoDocumentoGestor
  cedente: { id: string; nome: string; cnpj: string }
  versaoAtual: {
    numero: number
    criadoEm: string
  }
  ultimaAnalise: {
    resultado: string
    analisadoEm: string
  } | null
  possuiArquivo: boolean
  criadoEm: string
  atualizadoEm: string
}

export type ResultadoDocumentosGestor = PaginatedResult<DocumentoGestorListagemItem> & {
  metricasPagina: {
    pendentes: number
    aprovados: number
    reprovados: number
  }
}

export function parseFiltrosDocumentosGestor(
  searchParams: SearchParamsInput,
): FiltrosDocumentosGestor {
  const pagination = parsePaginationParams(searchParams)
  const statusRaw = readSearchParam(searchParams, 'status')
  const sort = parseSortParams({
    sort: readSearchParam(searchParams, 'sort'),
    direction: readSearchParam(searchParams, 'direction'),
    allowedFields: CAMPOS_ORDENACAO_DOCUMENTO_GESTOR,
    defaultField: 'created_at',
    defaultDirection: 'desc',
  })

  return {
    ...pagination,
    q: normalizeSearch(readSearchParam(searchParams, 'q')),
    status: statusRaw && STATUS_VALIDOS.has(statusRaw)
      ? statusRaw as StatusDocumentoGestor
      : null,
    sort: sort.field,
    direction: sort.direction,
  }
}

export function calcularMetricasPaginaDocumentosGestor(
  items: DocumentoGestorListagemItem[],
) {
  return {
    pendentes: items.filter((item) => ['enviado', 'em_analise'].includes(item.status)).length,
    aprovados: items.filter((item) => item.status === 'aprovado').length,
    reprovados: items.filter((item) => item.status === 'reprovado').length,
  }
}
