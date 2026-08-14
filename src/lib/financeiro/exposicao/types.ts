export const EXPOSURE_RULE_VERSION = 'RLX_EXPOSICAO_V1' as const

export type ExposureExecutionStatus =
  | 'CALCULADA'
  | 'NAO_APLICAVEL'
  | 'PL_D2_INDISPONIVEL'
  | 'PL_D2_INVALIDO'
  | 'POSICAO_LOGISTICA_INDISPONIVEL'
  | 'BASE_INCOMPATIVEL'

export type ExposureLimitClassification = 'ABAIXO_LIMITE' | 'NO_LIMITE' | 'ACIMA_LIMITE'
export type ExposureOverlayReason =
  | 'INCLUIDA_EM_TRANSITO'
  | 'JA_INCORPORADO_ESTOQUE'
  | 'OPERACAO_NAO_INCORPORADA'
  | 'ENTREGUE'
  | 'INDETERMINADA'
  | 'VALOR_AUSENTE'

export type ExposureQualityFlag =
  | 'TEM_SEM_MATCH'
  | 'TEM_INDETERMINADA'
  | 'TEM_VALOR_AUSENTE'
  | 'TEM_OPERACAO_NAO_INCORPORADA'
  | 'TEM_LIQUIDACAO_PARCIAL'

export type ExposureBaseRow = {
  statusVinculo: 'MATCHED_FINANCEIRO_NF' | 'SEM_MATCH_FINANCEIRO_NF'
  statusLogistico: 'ENTREGUE' | 'EM_TRANSITO' | 'INDETERMINADA' | null
  valorAquisicao: string | null
}
export type ExposureOverlayCandidate = {
  operacaoId: string
  notaFiscalId: string
  valorAquisicao: string | null
  statusLogistico: 'ENTREGUE' | 'EM_TRANSITO' | 'INDETERMINADA'
  jaIncorporadoEstoque: boolean
  operacaoEconomicaEm: string
  dataOperacional: string
}
