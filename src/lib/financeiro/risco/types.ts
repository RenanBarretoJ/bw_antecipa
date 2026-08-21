export const RISK_GATE_RULE_VERSION = 'GATE_RISCO_V1' as const

export const RISK_DECISIONS = ['APTO', 'REVISAO_MANUAL', 'BLOQUEADO'] as const
export type RiskDecision = typeof RISK_DECISIONS[number]

export const RISK_TECHNICAL_STATUSES = [
  'CONCLUIDA',
  'NAO_APLICAVEL',
  'AVALIACAO_RISCO_INDISPONIVEL',
] as const
export type RiskTechnicalStatus = typeof RISK_TECHNICAL_STATUSES[number]

export const RISK_REASON_CODES = [
  'EXPOSICAO_ACIMA_LIMITE',
  'PL_D2_INDISPONIVEL',
  'PL_D2_INVALIDO',
  'PL_OFICIAL_INDISPONIVEL',
  'POSICAO_SEM_MATCH',
  'EXPOSICAO_INDETERMINADA',
  'OPERACAO_NAO_INCORPORADA_ESTOQUE',
  'VALOR_AQUISICAO_INDISPONIVEL',
  'VALOR_AQUISICAO_OPERACAO_INDISPONIVEL',
  'LIQUIDACAO_PARCIAL_PRESENTE',
  'NO_LIMITE',
  'AVALIACAO_RISCO_INDISPONIVEL',
] as const
export type RiskReasonCode = typeof RISK_REASON_CODES[number]

export type RiskReasonSeverity = 'INFORMATIVO' | 'REVISAO' | 'BLOQUEIO'

export type RiskPolicy = {
  active: boolean
  limitPercent: string | null
  inclusiveLimit: boolean
  missingPlTreatment: 'BLOQUEAR'
  indeterminateTreatment: 'REVISAO_MANUAL'
  unmatchedTreatment: 'BLOQUEAR'
  unincorporatedOperationTreatment: 'BLOQUEAR'
  partialLiquidationTreatment: 'SINALIZAR'
}

export type RiskCandidateProjection = {
  operationId: string
  operationUpdatedAt: string
  currentStatus: string
  acquisitionValue: string | null
  transitValue: string
  indeterminateValue: string
  indeterminateCount: number
  missingAcquisitionCount: number
}

export type RiskClassifierInput = {
  policy: RiskPolicy
  exposureStatus: string
  currentPercent: string | null
  currentExposureValue: string | null
  netAssetValueD2: string | null
  indeterminateCount: number
  indeterminateValue: string | null
  unmatchedCount: number
  unmatchedValue: string | null
  missingAcquisitionCount: number
  unincorporatedOperationCount: number
  unincorporatedOperationValue: string | null
  hasPartialLiquidation: boolean
  candidate?: RiskCandidateProjection | null
}

export type RiskReason = {
  code: RiskReasonCode
  severity: RiskReasonSeverity
  numericValue?: string | null
  monetaryValue?: string | null
  quantity?: number | null
  details?: Record<string, string | number | boolean | null>
}

export type RiskClassification = {
  applicable: boolean
  technicalStatus: RiskTechnicalStatus
  decision: RiskDecision | null
  currentPercent: string | null
  projectedPercent: string | null
  projectedExposureValue: string | null
  reasons: RiskReason[]
}
