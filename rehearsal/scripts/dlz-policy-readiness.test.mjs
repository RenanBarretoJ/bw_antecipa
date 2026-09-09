import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateDlzPolicyReadiness } from './dlz-policy-readiness.mjs'

const DLZ_ID = '7a114257-7816-468e-adf4-d796b93364df'
const EXPECTED = Object.freeze({
  acceptance_required: true,
  cession_on_disbursement: true,
  delivery_tracking: false,
  postponement_allowed: false,
  financial_calculation_method: 'DIAS_CORRIDOS_365',
  require_pre_cession_logistics: false,
  financial_asset_type: 'NOTA_FISCAL',
  logistics_exposure_control: false,
  risk_gate: false,
  requirements: [],
})

function version(overrides = {}) {
  return {
    id: 'version-current',
    fundo_id: DLZ_ID,
    versao: 4,
    status: 'publicada',
    aceite_sacado_obrigatorio: true,
    cessao_no_desembolso: true,
    cria_acompanhamento_entrega: false,
    permite_postergacao_upload_canhoto: false,
    metodo_calculo_financeiro: 'DIAS_CORRIDOS_365',
    exigir_status_logistico_pre_cessao: false,
    tipo_ativo_financeiro: 'NOTA_FISCAL',
    controle_exposicao_logistica_ativo: false,
    gate_risco_ativo: false,
    requirements: [],
    ...overrides,
  }
}

test('v1 substituida e v4 publicada semanticamente equivalente passam', () => {
  const result = evaluateDlzPolicyReadiness({
    fundoId: DLZ_ID,
    expectedPolicy: EXPECTED,
    versions: [version({ id: 'version-v1', versao: 1, status: 'substituida' }), version()],
  })
  assert.equal(result.passed, true)
  assert.equal(result.current_version, 4)
})

test('versao publicada divergente falha fechada', () => {
  const result = evaluateDlzPolicyReadiness({
    fundoId: DLZ_ID,
    expectedPolicy: EXPECTED,
    versions: [version({ metodo_calculo_financeiro: 'TRINTA_360' })],
  })
  assert.equal(result.passed, false)
  assert.equal(result.code, 'POLICY_SEMANTICS_DIVERGENT')
  assert.deepEqual(result.mismatches, ['financial_calculation_method'])
})

test('ausencia de versao publicada falha fechada', () => {
  const result = evaluateDlzPolicyReadiness({
    fundoId: DLZ_ID,
    expectedPolicy: EXPECTED,
    versions: [version({ status: 'substituida' })],
  })
  assert.equal(result.passed, false)
  assert.equal(result.code, 'NO_PUBLISHED_POLICY')
})

test('multiplas versoes publicadas falham fechadas', () => {
  const result = evaluateDlzPolicyReadiness({
    fundoId: DLZ_ID,
    expectedPolicy: EXPECTED,
    versions: [version({ id: 'version-a' }), version({ id: 'version-b', versao: 5 })],
  })
  assert.equal(result.passed, false)
  assert.equal(result.code, 'MULTIPLE_PUBLISHED_POLICIES')
})

test('versao publicada de outro fundo falha fechada', () => {
  const result = evaluateDlzPolicyReadiness({
    fundoId: DLZ_ID,
    expectedPolicy: EXPECTED,
    versions: [version({ fundo_id: 'cb372689-65c8-43af-8a20-7438002a3b91' })],
  })
  assert.equal(result.passed, false)
  assert.equal(result.code, 'WRONG_FUND')
})
