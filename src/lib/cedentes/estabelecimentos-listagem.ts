import {
  normalizeSearch,
  parsePaginationParams,
  readSearchParam,
  type PaginatedResult,
  type SearchParamsInput,
} from '@/lib/pagination'

export const ESTABELECIMENTO_TIPO_FILTRO = ['matriz', 'filial'] as const
export const ESTABELECIMENTO_STATUS_FILTRO = ['rascunho', 'pendente', 'aprovado', 'rejeitado', 'suspenso'] as const
export const ESTABELECIMENTO_PENDENCIA_FILTRO = [
  'aguardando_documentos',
  'documentos_aguardando_analise',
  'pendencia_pos_aprovacao',
  'conta_bancaria_pendente',
  'completo',
] as const

export type EstabelecimentoTipoFiltro = (typeof ESTABELECIMENTO_TIPO_FILTRO)[number]
export type EstabelecimentoStatusFiltro = (typeof ESTABELECIMENTO_STATUS_FILTRO)[number]
export type EstabelecimentoPendenciaFiltro = (typeof ESTABELECIMENTO_PENDENCIA_FILTRO)[number]

export interface FiltrosEstabelecimentos {
  page: number
  pageSize: 10 | 20 | 40
  q: string
  tipo: EstabelecimentoTipoFiltro | null
  status: EstabelecimentoStatusFiltro | null
  pendencia: EstabelecimentoPendenciaFiltro | null
}

export interface EstabelecimentoListaItem {
  id: string
  cnpj: string
  razaoSocial: string
  nomeFantasia: string | null
  tipo: 'matriz' | 'filial'
  status: string
  ativo: boolean
  totalObrigatorios: number
  aprovadosObrigatorios: number
  aguardandoAnalise: number
  temContaPrincipal: boolean
  pendencia: EstabelecimentoPendenciaFiltro
}

export type ResultadoEstabelecimentos = PaginatedResult<EstabelecimentoListaItem>

export function parseFiltrosEstabelecimentos(input: SearchParamsInput): FiltrosEstabelecimentos {
  const pagination = parsePaginationParams(input)
  const tipoRaw = readSearchParam(input, 'tipo')
  const statusRaw = readSearchParam(input, 'status')
  const pendenciaRaw = readSearchParam(input, 'pendencia')

  return {
    ...pagination,
    q: normalizeSearch(readSearchParam(input, 'q')),
    tipo: ESTABELECIMENTO_TIPO_FILTRO.includes(tipoRaw as EstabelecimentoTipoFiltro) ? (tipoRaw as EstabelecimentoTipoFiltro) : null,
    status: ESTABELECIMENTO_STATUS_FILTRO.includes(statusRaw as EstabelecimentoStatusFiltro) ? (statusRaw as EstabelecimentoStatusFiltro) : null,
    pendencia: ESTABELECIMENTO_PENDENCIA_FILTRO.includes(pendenciaRaw as EstabelecimentoPendenciaFiltro) ? (pendenciaRaw as EstabelecimentoPendenciaFiltro) : null,
  }
}

export const PENDENCIA_LABEL: Record<EstabelecimentoPendenciaFiltro, string> = {
  aguardando_documentos: 'Aguardando documentos',
  documentos_aguardando_analise: 'Documentos aguardando analise',
  pendencia_pos_aprovacao: 'Pendencia pos-aprovacao',
  conta_bancaria_pendente: 'Conta bancaria pendente',
  completo: 'Completo',
}
