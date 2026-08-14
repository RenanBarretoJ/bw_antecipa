import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classificarGateRisco } from './classificador'
import type { RiskClassifierInput } from './types'

const base: RiskClassifierInput = {
  policy: {
    active: true,
    limitPercent: '40',
    inclusiveLimit: true,
    missingPlTreatment: 'BLOQUEAR',
    indeterminateTreatment: 'REVISAO_MANUAL',
    unmatchedTreatment: 'BLOQUEAR',
    unincorporatedOperationTreatment: 'BLOQUEAR',
    partialLiquidationTreatment: 'SINALIZAR',
  },
  exposureStatus: 'CALCULADA',
  currentPercent: '25',
  currentExposureValue: '12500000',
  netAssetValueD2: '50000000',
  indeterminateCount: 0,
  indeterminateValue: '0',
  unmatchedCount: 0,
  unmatchedValue: '0',
  missingAcquisitionCount: 0,
  unincorporatedOperationCount: 0,
  unincorporatedOperationValue: '0',
  hasPartialLiquidation: false,
}

describe('GATE_RISCO_V1', () => {
  it.each([
    ['25', 'APTO'],
    ['37', 'APTO'],
    ['39.8', 'APTO'],
    ['40', 'APTO'],
    ['42', 'BLOQUEADO'],
  ] as const)('classifica %s%% com limite inclusivo', (percent, expected) => {
    const exposure = String(Number(percent) * 500000)
    const result = classificarGateRisco({ ...base, currentPercent: percent, currentExposureValue: exposure })
    expect(result.decision).toBe(expected)
    if (percent === '40') expect(result.reasons.map((item) => item.code)).toContain('NO_LIMITE')
  })

  it('bloqueia o limite exato quando a politica nao e inclusiva', () => {
    const result = classificarGateRisco({
      ...base,
      policy: { ...base.policy, inclusiveLimit: false },
      currentPercent: '40',
      currentExposureValue: '20000000',
    })
    expect(result.decision).toBe('BLOQUEADO')
    expect(result.reasons.map((item) => item.code)).toContain('EXPOSICAO_ACIMA_LIMITE')
  })

  it.each(['PL_D2_INDISPONIVEL', 'PL_D2_INVALIDO'])('falha fechada para %s', (status) => {
    const result = classificarGateRisco({ ...base, exposureStatus: status, netAssetValueD2: status.endsWith('INVALIDO') ? '0' : null })
    expect(result.decision).toBe('BLOQUEADO')
    expect(result.reasons.map((item) => item.code)).toContain(status)
  })

  it('envia exposicao indeterminada para revisao sem inventar tolerancia', () => {
    const result = classificarGateRisco({ ...base, indeterminateCount: 1, indeterminateValue: '0.01' })
    expect(result.decision).toBe('REVISAO_MANUAL')
  })

  it('preserva todos os motivos e aplica precedencia de bloqueio', () => {
    const result = classificarGateRisco({
      ...base,
      unmatchedCount: 3,
      unmatchedValue: '1021648.91',
      indeterminateCount: 12,
      indeterminateValue: '147803.45',
    })
    expect(result.decision).toBe('BLOQUEADO')
    expect(result.reasons.map((item) => item.code)).toEqual(expect.arrayContaining([
      'POSICAO_SEM_MATCH',
      'EXPOSICAO_INDETERMINADA',
    ]))
  })

  it('mantem liquidacao parcial apenas informativa', () => {
    const result = classificarGateRisco({ ...base, hasPartialLiquidation: true })
    expect(result.decision).toBe('APTO')
    expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'LIQUIDACAO_PARCIAL_PRESENTE', severity: 'INFORMATIVO' }))
  })

  it('bloqueia valor de aquisicao ausente na base e na candidata', () => {
    expect(classificarGateRisco({ ...base, missingAcquisitionCount: 1 }).decision).toBe('BLOQUEADO')
    const candidate = classificarGateRisco({
      ...base,
      candidate: {
        operationId: '00000000-0000-0000-0000-000000000001',
        operationUpdatedAt: '2026-08-14T00:00:00Z',
        currentStatus: 'solicitada',
        acquisitionValue: null,
        transitValue: '0',
        indeterminateValue: '0',
        indeterminateCount: 0,
        missingAcquisitionCount: 1,
      },
    })
    expect(candidate.reasons.map((item) => item.code)).toContain('VALOR_AQUISICAO_OPERACAO_INDISPONIVEL')
  })

  it('nao aplica controle inativo', () => {
    const result = classificarGateRisco({ ...base, policy: { ...base.policy, active: false } })
    expect(result).toMatchObject({ applicable: false, technicalStatus: 'NAO_APLICAVEL', decision: null })
  })

  it('falha fechada quando a cadeia canonica nao concluiu ou o limite nao existe', () => {
    expect(classificarGateRisco({ ...base, exposureStatus: 'BASE_INCOMPATIVEL' })).toMatchObject({
      technicalStatus: 'AVALIACAO_RISCO_INDISPONIVEL',
      decision: 'BLOQUEADO',
    })
    expect(classificarGateRisco({ ...base, policy: { ...base.policy, limitPercent: null } }).decision).toBe('BLOQUEADO')
  })

  it('cumpre integralmente o oraculo Golden V2 sem alterar os oraculos anteriores', () => {
    const golden = JSON.parse(readFileSync(join(process.cwd(), 'scripts/homologacao/rlx-golden-v2/fixtures/expected/expected-risk-gate.json'), 'utf8')) as {
      baseline: { net_asset_value_d2: string; known_transit_exposure: string; indeterminate: { count: number; value: string; expected_reason: string }; unmatched: { count: number; value: string; expected_reason: string }; expected_decision: string }
      scenarios: Array<{ percent: string; exposure_value: string; expected_decision: string; expected_reason?: string }>
    }
    for (const scenario of golden.scenarios) {
      const result = classificarGateRisco({ ...base, currentPercent: scenario.percent, currentExposureValue: scenario.exposure_value })
      expect(result.decision).toBe(scenario.expected_decision)
      if (scenario.expected_reason) expect(result.reasons.map((item) => item.code)).toContain(scenario.expected_reason)
    }
    const baseline = classificarGateRisco({
      ...base,
      currentExposureValue: golden.baseline.known_transit_exposure,
      netAssetValueD2: golden.baseline.net_asset_value_d2,
      indeterminateCount: golden.baseline.indeterminate.count,
      indeterminateValue: golden.baseline.indeterminate.value,
      unmatchedCount: golden.baseline.unmatched.count,
      unmatchedValue: golden.baseline.unmatched.value,
    })
    expect(baseline.decision).toBe(golden.baseline.expected_decision)
    expect(baseline.reasons.map((item) => item.code)).toEqual(expect.arrayContaining([
      golden.baseline.indeterminate.expected_reason,
      golden.baseline.unmatched.expected_reason,
    ]))
  })
})
