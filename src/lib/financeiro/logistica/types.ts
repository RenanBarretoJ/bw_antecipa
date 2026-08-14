import type { StatusLogisticoPreCessao } from '@/lib/logistica/evidencias-logisticas'

export const LOGISTICS_RULE_VERSION = 'RLX_LOGISTICA_V1' as const

export type LogisticsLinkStatus = 'MATCHED_FINANCEIRO_NF' | 'SEM_MATCH_FINANCEIRO_NF'

export type LogisticsSnapshotRow = {
  estoquePosicaoId: string
  matchingResultadoId: string | null
  matchingStatus: 'MATCH_FORTE' | 'AMBIGUO' | 'NAO_CONCILIADO' | 'CONFLITO'
  matchingMetodo: string
  statusVinculo: LogisticsLinkStatus
  vinculoId: string | null
  notaFiscalId: string | null
  statusLogistico: StatusLogisticoPreCessao | null
  idRecebivel: string | null
  seuNumero: string | null
  numeroDocumento: string | null
  cedenteNome: string | null
  cedenteDocumento: string | null
  sacadoNome: string | null
  sacadoDocumento: string | null
  dataVencimento: string | null
  valorNominal: string | null
  valorAquisicao: string | null
  valorAquisicaoQualidade: 'PRESENTE' | 'AUSENTE'
  nfCompartilhadaEntrePosicoes: boolean
  evidenciaFamilia: 'cte' | 'comprovante_entrega' | null
  documentoId: string | null
  documentoVersaoId: string | null
  documentoAnaliseId: string | null
  fundamento: string
  evidencias: Record<string, unknown>
  detalhes: Record<string, unknown>
}
