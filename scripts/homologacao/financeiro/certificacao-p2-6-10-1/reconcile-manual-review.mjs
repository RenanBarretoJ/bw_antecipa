#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertHomologEnvironment, createAdminClient, loadEnvFile } from '../../../perf9a/common.mjs'

const PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const ARTIFACT = resolve('docs/financeiro/smoke-revisao-manual-p2-6-10-1.json')

await main().catch((error) => {
  console.error(`Reconciliacao da revisao manual falhou: ${error instanceof Error ? error.message : JSON.stringify(error)}`)
  process.exitCode = 1
})

async function main() {
  loadEnvFile('.env.homolog')
  const env = assertHomologEnvironment()
  if (env.projectRef !== PROJECT_REF) throw new Error(`Projeto bloqueado: ${env.projectRef}`)

  const admin = createAdminClient(env)
  const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'))
  const release = await reconcileScenario(admin, artifact.release, 'LIBERADA', 'RISCO_REVISAO_LIBERADA', true)
  const reject = await reconcileScenario(admin, artifact.reject, 'RECUSADA', 'RISCO_REVISAO_RECUSADA', false)
  const negativesPass = [artifact.negative_super_admin_puro, artifact.negative_cross_fund, artifact.negative_without_link]
    .every((control) => control?.denied === true)

  artifact.collector_reconciliation = {
    executed_at: new Date().toISOString(),
    source_of_truth: 'PostgreSQL homolog via service-role, limitado aos IDs produzidos pelo runner autenticado',
    reason: 'A coleta original consultou a revisao antes da conclusao observavel da Server Action.',
    original_status: artifact.status,
    release,
    reject,
  }
  artifact.release = { ...artifact.release, status: release.status, review_status: release.review_status }
  artifact.reject = { ...artifact.reject, status: reject.status, review_status: reject.review_status }
  artifact.review = {
    ...artifact.review,
    release: artifact.release,
    reject: artifact.reject,
    status: release.status === 'PASS' && reject.status === 'PASS' && negativesPass ? 'PASS' : 'FAIL',
  }
  artifact.status = artifact.review.status

  writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ MANUAL_REVIEW: artifact.status, release: release.status, reject: reject.status, negatives: negativesPass ? 'PASS' : 'FAIL' }))
}

async function reconcileScenario(admin, scenario, expectedReviewStatus, auditType, operationMustBeApproved) {
  if (!scenario?.review_id || !scenario?.risk_execution_id) throw new Error(`Cenario ${expectedReviewStatus} sem IDs de evidencia.`)
  const operationId = extractOperationId(scenario)
  const [reviewResult, operationResult, auditResult] = await Promise.all([
    admin.from('risco_revisoes').select('*').eq('id', scenario.review_id).single(),
    admin.from('operacoes').select('id,status,aprovado_em,updated_at').eq('id', operationId).single(),
    admin.from('logs_auditoria').select('id,tipo_evento,entidade_id,dados_depois,created_at').eq('tipo_evento', auditType).order('created_at', { ascending: false }).limit(20),
  ])
  if (reviewResult.error) throw reviewResult.error
  if (operationResult.error) throw operationResult.error
  if (auditResult.error) throw auditResult.error

  const audit = (auditResult.data || []).find((row) =>
    row.entidade_id === scenario.review_id ||
    row.entidade_id === scenario.risk_execution_id ||
    row.dados_depois?.risco_revisao_id === scenario.review_id ||
    row.dados_depois?.risco_execucao_id === scenario.risk_execution_id,
  )
  const reviewMatches = reviewResult.data.status === expectedReviewStatus
  const operationMatches = operationMustBeApproved
    ? operationResult.data.status === 'aprovada'
    : operationResult.data.status !== 'aprovada'
  const status = reviewMatches && operationMatches && Boolean(audit) ? 'PASS' : 'FAIL'

  return {
    status,
    review_id: reviewResult.data.id,
    risk_execution_id: reviewResult.data.risco_execucao_id,
    review_status: reviewResult.data.status,
    decided_at: reviewResult.data.revisado_em || reviewResult.data.updated_at || null,
    operation_id: operationResult.data.id,
    operation_status: operationResult.data.status,
    audit_event: audit?.tipo_evento || null,
    audit_id: audit?.id || null,
    audit_created_at: audit?.created_at || null,
  }
}

function extractOperationId(scenario) {
  const path = scenario.decision_ui?.final_path || scenario.missing_totp_control?.ui?.final_path || ''
  const match = path.match(/[?&]operacao=([0-9a-f-]{36})/i)
  if (!match) throw new Error(`Operacao nao identificada no cenario ${scenario.scenario || 'desconhecido'}.`)
  return match[1]
}
