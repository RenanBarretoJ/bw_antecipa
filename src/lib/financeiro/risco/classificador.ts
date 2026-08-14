import Decimal from 'decimal.js'
import type {
  RiskClassification,
  RiskClassifierInput,
  RiskDecision,
  RiskReason,
  RiskReasonCode,
  RiskReasonSeverity,
} from './types'

const severityRank: Record<RiskReasonSeverity, number> = {
  INFORMATIVO: 0,
  REVISAO: 1,
  BLOQUEIO: 2,
}

function decimal(value: string | null | undefined, fallback = '0') {
  return new Decimal(value == null || value === '' ? fallback : value)
}

function positive(value: string | null | undefined) {
  return decimal(value).gt(0)
}

function reason(
  code: RiskReasonCode,
  severity: RiskReasonSeverity,
  values: Omit<RiskReason, 'code' | 'severity'> = {},
): RiskReason {
  return { code, severity, ...values }
}

function decisionFromReasons(reasons: RiskReason[]): RiskDecision {
  const highest = reasons.reduce((rank, item) => Math.max(rank, severityRank[item.severity]), 0)
  if (highest === severityRank.BLOQUEIO) return 'BLOQUEADO'
  if (highest === severityRank.REVISAO) return 'REVISAO_MANUAL'
  return 'APTO'
}

export function classificarGateRisco(input: RiskClassifierInput): RiskClassification {
  if (!input.policy.active) {
    return {
      applicable: false,
      technicalStatus: 'NAO_APLICAVEL',
      decision: null,
      currentPercent: input.currentPercent,
      projectedPercent: null,
      projectedExposureValue: null,
      reasons: [],
    }
  }

  const supportedExposureStatuses = new Set(['CALCULADA', 'PL_D2_INDISPONIVEL', 'PL_D2_INVALIDO'])
  if (!supportedExposureStatuses.has(input.exposureStatus) || input.policy.limitPercent == null) {
    return {
      applicable: true,
      technicalStatus: 'AVALIACAO_RISCO_INDISPONIVEL',
      decision: 'BLOQUEADO',
      currentPercent: input.currentPercent,
      projectedPercent: null,
      projectedExposureValue: null,
      reasons: [reason('AVALIACAO_RISCO_INDISPONIVEL', 'BLOQUEIO', {
        details: { status_exposicao: input.exposureStatus, limite_configurado: input.policy.limitPercent != null },
      })],
    }
  }

  const reasons: RiskReason[] = []
  const currentExposure = decimal(input.currentExposureValue)
  const candidateTransit = decimal(input.candidate?.transitValue)
  const projectedExposure = currentExposure.plus(candidateTransit)
  const netAssetValue = input.netAssetValueD2 == null ? null : decimal(input.netAssetValueD2)
  const limit = input.policy.limitPercent == null ? null : decimal(input.policy.limitPercent)

  if (input.exposureStatus === 'PL_D2_INDISPONIVEL' || input.netAssetValueD2 == null) {
    reasons.push(reason('PL_D2_INDISPONIVEL', 'BLOQUEIO'))
  } else if (input.exposureStatus === 'PL_D2_INVALIDO' || !netAssetValue?.gt(0)) {
    reasons.push(reason('PL_D2_INVALIDO', 'BLOQUEIO', { monetaryValue: input.netAssetValueD2 }))
  }

  const projectedPercent = netAssetValue?.gt(0)
    ? projectedExposure.dividedBy(netAssetValue).times(100).toDecimalPlaces(12).toFixed(12)
    : null

  if (limit && projectedPercent != null) {
    const percent = decimal(projectedPercent)
    if (percent.gt(limit) || (percent.eq(limit) && !input.policy.inclusiveLimit)) {
      reasons.push(reason('EXPOSICAO_ACIMA_LIMITE', 'BLOQUEIO', {
        numericValue: projectedPercent,
        monetaryValue: projectedExposure.toFixed(4),
        details: {
          limite_pct: limit.toFixed(9),
          excesso_pct: percent.minus(limit).toDecimalPlaces(12).toFixed(12),
          patrimonio_liquido_d2: netAssetValue?.toFixed(4) || null,
        },
      }))
    } else if (percent.eq(limit)) {
      reasons.push(reason('NO_LIMITE', 'INFORMATIVO', {
        numericValue: projectedPercent,
        monetaryValue: projectedExposure.toFixed(4),
        details: { limite_pct: limit.toFixed(9) },
      }))
    }
  }

  if (input.unmatchedCount > 0 || positive(input.unmatchedValue)) {
    reasons.push(reason('POSICAO_SEM_MATCH', 'BLOQUEIO', {
      quantity: input.unmatchedCount,
      monetaryValue: input.unmatchedValue,
    }))
  }

  const indeterminateCount = input.indeterminateCount + (input.candidate?.indeterminateCount || 0)
  const indeterminateValue = decimal(input.indeterminateValue).plus(input.candidate?.indeterminateValue || 0)
  if (indeterminateCount > 0 || indeterminateValue.gt(0)) {
    reasons.push(reason('EXPOSICAO_INDETERMINADA', 'REVISAO', {
      quantity: indeterminateCount,
      monetaryValue: indeterminateValue.toFixed(4),
    }))
  }

  if (input.unincorporatedOperationCount > 0 || positive(input.unincorporatedOperationValue)) {
    reasons.push(reason('OPERACAO_NAO_INCORPORADA_ESTOQUE', 'BLOQUEIO', {
      quantity: input.unincorporatedOperationCount,
      monetaryValue: input.unincorporatedOperationValue,
    }))
  }

  if (input.missingAcquisitionCount > 0) {
    reasons.push(reason('VALOR_AQUISICAO_INDISPONIVEL', 'BLOQUEIO', {
      quantity: input.missingAcquisitionCount,
    }))
  }

  if ((input.candidate?.missingAcquisitionCount || 0) > 0 || input.candidate?.acquisitionValue == null) {
    if (input.candidate) {
      reasons.push(reason('VALOR_AQUISICAO_OPERACAO_INDISPONIVEL', 'BLOQUEIO', {
        quantity: input.candidate.missingAcquisitionCount || 1,
      }))
    }
  }

  if (input.hasPartialLiquidation) {
    reasons.push(reason('LIQUIDACAO_PARCIAL_PRESENTE', 'INFORMATIVO'))
  }

  return {
    applicable: true,
    technicalStatus: 'CONCLUIDA',
    decision: decisionFromReasons(reasons),
    currentPercent: input.currentPercent,
    projectedPercent,
    projectedExposureValue: projectedExposure.toFixed(4),
    reasons,
  }
}
