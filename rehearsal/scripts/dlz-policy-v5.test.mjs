import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateDlzPolicyReadiness } from './dlz-policy-readiness.mjs'
import {
  DLZ_POLICY_V5_EXPECTED_HASH,
  assertDlzPolicyV5SingleChange,
  buildDlzPolicyV5Draft,
  policyContentHash,
  simulateDlzPolicyV5Publication,
} from './dlz-policy-v5.mjs'

const fundoId = '7a114257-7816-468e-adf4-d796b93364df'
const v4 = {
  id: '19666b2a-06fe-4171-a4d1-94032b98399e',
  politica_operacional_id: 'd1311000-0000-4000-8000-000000000001',
  fundo_id: fundoId,
  versao: 4,
  status: 'publicada',
  regras: { fluxo_operacional: { aceiteSacado: 'antes_cessao', momentoCessao: 'desembolso', acompanhamentoEntrega: 'nao_aplicavel' } },
  parametros: { fluxo_operacional: { aceiteSacado: 'antes_cessao', momentoCessao: 'desembolso', acompanhamentoEntrega: 'nao_aplicavel' }, requisito_ui_schema: 'bw-antecipa.politica-operacional-ui.v2' },
  configuracao: { fluxo_operacional: { aceiteSacado: 'antes_cessao', momentoCessao: 'desembolso', acompanhamentoEntrega: 'nao_aplicavel' }, requisito_ui_schema: 'bw-antecipa.politica-operacional-ui.v2' },
  cedente_fundo_id: null,
  aceite_sacado_obrigatorio: true,
  cessao_no_desembolso: true,
  cria_acompanhamento_entrega: false,
  exigir_status_logistico_pre_cessao: false,
  permite_postergacao_upload_canhoto: false,
  limite_postergacao_upload_canhoto_dias: null,
  metodo_calculo_financeiro: 'TRINTA_360',
  tipo_ativo_financeiro: 'NOTA_FISCAL',
  controle_exposicao_logistica_ativo: false,
  limite_exposicao_em_transito_pct: null,
  gate_risco_ativo: false,
  limite_inclusivo: true,
  tratamento_pl_indisponivel: 'BLOQUEAR',
  tratamento_indeterminada: 'REVISAO_MANUAL',
  tratamento_sem_match: 'BLOQUEAR',
  tratamento_operacao_nao_incorporada: 'BLOQUEAR',
  tratamento_liquidacao_parcial: 'SINALIZAR',
}

const expectedPolicy = {
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
}

test('v5 deriva da v4 com exatamente uma mudanca semantica', () => {
  const v5 = buildDlzPolicyV5Draft(v4)
  assert.deepEqual(assertDlzPolicyV5SingleChange(v4, v5), ['metodo_calculo_financeiro'])
  assert.equal(policyContentHash(v5), DLZ_POLICY_V5_EXPECTED_HASH)
})

test('qualquer segunda alteracao impede a publicacao', () => {
  const v5 = buildDlzPolicyV5Draft(v4)
  v5.aceite_sacado_obrigatorio = false
  assert.throws(() => assertDlzPolicyV5SingleChange(v4, v5), /diferencas nao autorizadas/u)
})

test('rehearsal publica v5, preserva historico e resolve novas operacoes em 365', () => {
  const historicalOperations = [
    { id: 'historica-v1', politica_versao: 1, metodo_calculo_financeiro: 'DIAS_CORRIDOS_365' },
    { id: 'historica-v4', politica_versao: 4, metodo_calculo_financeiro: 'TRINTA_360' },
  ]
  const rehearsal = simulateDlzPolicyV5Publication({
    v4,
    historicalOperations,
    publishedAt: '2026-09-09T01:00:00.000Z',
  })
  assert.equal(rehearsal.v4.status, 'substituida')
  assert.equal(rehearsal.v5.status, 'publicada')
  assert.equal(rehearsal.v5.metodo_calculo_financeiro, 'DIAS_CORRIDOS_365')
  assert.deepEqual(rehearsal.historicalOperations, historicalOperations)

  const readiness = evaluateDlzPolicyReadiness({
    fundoId,
    expectedPolicy,
    versions: [
      { ...rehearsal.v4, requirements: [] },
      { ...rehearsal.v5, id: 'v5-rehearsal', requirements: [] },
    ],
  })
  assert.equal(readiness.passed, true)
  const newOperationSnapshot = {
    politica_versao: rehearsal.v5.versao,
    aceite_sacado_obrigatorio: rehearsal.v5.aceite_sacado_obrigatorio,
    metodo_calculo_financeiro: rehearsal.v5.metodo_calculo_financeiro,
  }
  assert.deepEqual(newOperationSnapshot, {
    politica_versao: 5,
    aceite_sacado_obrigatorio: true,
    metodo_calculo_financeiro: 'DIAS_CORRIDOS_365',
  })
})
