#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { generateTotp } from '../../../perf9a/dataset.mjs'
import { assertHomologEnvironment, createAdminClient, loadEnvFile } from '../../../perf9a/common.mjs'

const PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const BASE_URL = String(process.env.P2_6_10_BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
const ACTORS_FILE = resolve(process.env.LOCALAPPDATA || '', 'BWAntecipa', 'perf9a', 'p2-6-10-1', `actors-${PROJECT_REF}.json`)
const WORKER = resolve('scripts/homologacao/financeiro/certificacao-p2-6-10-1/risk-evaluate.worker.ts')
const TSX_CLI = resolve('node_modules/tsx/dist/cli.mjs')
const RUNTIME_STUBS = resolve('scripts/homologacao/financeiro/certificacao-p2-6-10-1/runtime-stubs')
const EVIDENCE_DIR = resolve('docs/financeiro')
const FIXTURES = {
  TOCTOU: { codigo: 'TOCTOU', fundo: 'ff4015bc-3004-b230-093b-f8ab245a4b03', operacao: '36156774-ad52-d6a4-4803-9fbd205b7919' },
  STALE_REVIEW: { codigo: 'STALE_REVIEW', fundo: 'f8ec486e-f95d-7695-aa1d-1795c38eb028', operacao: '0280a33b-d3a3-0980-3924-935547a7a06e' },
}

await main().catch((error) => {
  console.error(`Gates pendentes P2.6.10.1 falharam: ${redact(error instanceof Error ? error.stack || error.message : String(error))}`)
  process.exitCode = 1
})

async function main() {
  loadEnvFile('.env.homolog')
  const env = assertHomologEnvironment()
  if (env.projectRef !== PROJECT_REF) throw new Error(`Projeto bloqueado: ${env.projectRef}`)
  const actor = JSON.parse(readFileSync(ACTORS_FILE, 'utf8')).actors.find((item) => item.key === 'gestor_a')
  if (!actor) throw new Error('Gestor QA A nao encontrado.')
  const admin = createAdminClient(env)
  const witnesses = await ensureQaWitnesses(admin)
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  let authenticated = null

  try {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    const login = await loginWithMfa(page, actor)
    if (login.aal_after_totp !== 'aal2') throw new Error('Browser nao atingiu AAL2.')
    // O Supabase rejeita a reutilizacao do mesmo TOTP. O navegador autentica
    // primeiro; o cliente direto espera o proximo codigo antes de elevar a AAL2.
    authenticated = await authenticatedClient(env, actor)

    const toctou = await certifyToctou({ page, admin, authenticated, actor, witnesses })
    writeEvidence('toctou-operation-p2-6-10-1.json', toctou)

    const stale = await certifyStaleReview({ page, admin, authenticated, actor, witnesses })
    writeEvidence('stale-review-p2-6-10-1.json', stale)

    await context.close()
    console.log(JSON.stringify({ TOCTOU_OPERATION: toctou.status, STALE_REVIEW: stale.status }))
  } finally {
    if (authenticated) await authenticated.client.auth.signOut()
    await browser.close()
  }
}

async function certifyToctou({ page, admin, authenticated, actor, witnesses }) {
  const fixture = FIXTURES.TOCTOU
  const before = await operation(admin, fixture.operacao)
  if (before.status !== 'solicitada' || before.testemunha_1_id || before.testemunha_2_id || Number(before.risk_count) > 1) {
    throw new Error('Fixture TOCTOU nao esta em estado retomavel.')
  }
  const t1StartedAt = new Date().toISOString()
  const risk = evaluateRisk(fixture, actor.id, Number(before.taxa_desconto || 0))
  const t2StartedAt = new Date().toISOString()
  const mutation = await saveWitnessesOfficial(page, fixture, witnesses)
  const t2FinishedAt = new Date().toISOString()
  const mutated = await operation(admin, fixture.operacao)
  const approvalStartedAt = new Date().toISOString()
  const approval = await authenticated.client.rpc('aprovar_operacao_com_risco_atomica', {
    p_operacao_id: fixture.operacao,
    p_taxa_desconto: Number(before.taxa_desconto || 0),
    p_risco_execucao_id: risk.risk_execution_id,
    p_assinatura_inputs: risk.signature,
  })
  const t1FinishedAt = new Date().toISOString()
  const after = await operation(admin, fixture.operacao)
  const staleDenied = Boolean(approval.error) && /avaliacao de risco expirou|alterada/i.test(approval.error.message)
  const overlapMs = Math.max(0, Date.parse(t2FinishedAt) - Date.parse(t2StartedAt))
  const status = mutation.success && before.updated_at !== mutated.updated_at && staleDenied && after.status !== 'aprovada' && overlapMs > 0 ? 'PASS' : 'FAIL'
  return {
    gate: 'TOCTOU_OPERATION', status, environment: 'homolog', project_ref: PROJECT_REF, production_touched: false,
    actor: actor.id, fundo_id: fixture.fundo, operacao_id: fixture.operacao,
    t1_started_at: t1StartedAt, risk_execution_id: risk.risk_execution_id, signature_before: risk.signature,
    risk_operation_updated_at_snapshot: risk.operation_updated_at_snapshot,
    t2_started_at: t2StartedAt, t2_finished_at: t2FinishedAt, mutation_official_path: 'UI -> salvarTestemunhasOperacao', mutation,
    operation_updated_at_before: before.updated_at, operation_updated_at_after_mutation: mutated.updated_at,
    approval_started_at: approvalStartedAt, t1_finished_at: t1FinishedAt, overlap_ms: overlapMs,
    stale_approval_denied: staleDenied, denial_code: approval.error?.code || null, denial_message: redact(approval.error?.message || ''),
    final_operation_status: after.status, new_evaluation_required: true,
    risk_execution_preserved: Boolean(await one(admin, 'risco_execucoes', risk.risk_execution_id)),
    executed_at: new Date().toISOString(),
  }
}

async function certifyStaleReview({ page, admin, authenticated, actor, witnesses }) {
  const fixture = FIXTURES.STALE_REVIEW
  const before = await operation(admin, fixture.operacao)
  if (before.status !== 'solicitada' || Number(before.risk_count) !== 0) throw new Error('Fixture STALE_REVIEW nao esta intacta.')
  const first = evaluateRisk(fixture, actor.id, Number(before.taxa_desconto || 0))
  if (first.decision !== 'REVISAO_MANUAL' || !first.review_id) throw new Error('Primeira avaliacao nao gerou revisao manual.')
  const oldBefore = await one(admin, 'risco_revisoes', first.review_id)
  const mutation = await saveWitnessesOfficial(page, fixture, witnesses.slice().reverse())
  const mutated = await operation(admin, fixture.operacao)
  const second = evaluateRisk(fixture, actor.id, Number(before.taxa_desconto || 0))
  if (second.risk_execution_id === first.risk_execution_id) throw new Error('Nova avaliacao nao foi criada.')
  const fresh = await authorizeSensitiveReview(authenticated.client, authenticated.factorId, actor.totpSecret)
  const correlationId = randomUUID()
  const decision = await authenticated.client.rpc('decidir_revisao_risco', {
    p_revisao_id: first.review_id,
    p_decisao: 'LIBERADA',
    p_justificativa: 'Tentativa controlada sobre revisao obsoleta P2.6.10.1',
    p_correlation_id: correlationId,
  })
  const oldAfter = await one(admin, 'risco_revisoes', first.review_id)
  const newReview = second.review_id ? await one(admin, 'risco_revisoes', second.review_id) : null
  const audit = await latestAudit(admin, fixture.operacao, 'RISCO_REVISAO_EXPIRADA', correlationId)
  const staleDenied = !decision.error && decision.data === false && oldAfter?.status === 'EXPIRADA'
  const status = mutation.success && before.updated_at !== mutated.updated_at && staleDenied && Boolean(newReview) && Boolean(audit) ? 'PASS' : 'FAIL'
  return {
    gate: 'STALE_REVIEW', status, environment: 'homolog', project_ref: PROJECT_REF, production_touched: false,
    actor: actor.id, fundo_id: fixture.fundo, operacao_id: fixture.operacao,
    old_risk_execution_id: first.risk_execution_id, old_review_id: first.review_id, old_review_status_before: oldBefore?.status || null,
    mutation_official_path: 'UI -> salvarTestemunhasOperacao', mutation,
    operation_updated_at_before: before.updated_at, operation_updated_at_after_mutation: mutated.updated_at,
    new_risk_execution_id: second.risk_execution_id, new_review_id: second.review_id,
    fresh_totp: fresh, decision_rpc_error: decision.error ? { code: decision.error.code, message: redact(decision.error.message) } : null,
    decision_returned: decision.data, old_review_status_after: oldAfter?.status || null,
    old_review_preserved: Boolean(oldAfter), new_review_required: Boolean(newReview), new_review_status: newReview?.status || null,
    stale_review_denied: staleDenied, audit_event: audit?.tipo_evento || null, correlation_id: correlationId,
    final_operation_status: (await operation(admin, fixture.operacao)).status,
    executed_at: new Date().toISOString(),
  }
}

function evaluateRisk(fixture, actorId, taxaDesconto) {
  const run = spawnSync(process.execPath, [TSX_CLI, WORKER,
    '--fundo-id', fixture.fundo, '--operacao-id', fixture.operacao,
    '--ator-id', actorId, '--taxa-desconto', String(taxaDesconto),
    '--data-operacional', new Date().toISOString().slice(0, 10),
  ], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--conditions=react-server', NODE_PATH: RUNTIME_STUBS }, timeout: 180_000 })
  if (run.status !== 0) throw new Error(`Avaliacao de risco falhou: ${redact(run.stderr || run.stdout)}`)
  const marker = String(run.stdout).split(/\r?\n/).find((line) => line.startsWith('P26101_RESULT='))
  if (!marker) throw new Error('Worker de risco nao retornou resultado estruturado.')
  return JSON.parse(marker.slice('P26101_RESULT='.length))
}

async function ensureQaWitnesses(admin) {
  const definitions = [
    { nome: 'P2.6.10.1 Testemunha A', cpf: '90000000001', email: 'testemunha-a@p2-6-10-1.qa.invalid', ativo: true },
    { nome: 'P2.6.10.1 Testemunha B', cpf: '90000000002', email: 'testemunha-b@p2-6-10-1.qa.invalid', ativo: true },
  ]
  const result = []
  for (const item of definitions) {
    let query = await admin.from('testemunhas').select('id,nome').eq('email', item.email).maybeSingle()
    if (query.error) throw query.error
    if (!query.data) {
      const inserted = await admin.from('testemunhas').insert(item).select('id,nome').single()
      if (inserted.error) throw inserted.error
      query = inserted
    }
    result.push(query.data)
  }
  return result
}

async function authenticatedClient(env, actor) {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const client = createClient(env.supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const signed = await client.auth.signInWithPassword({ email: actor.email, password: actor.password })
  if (signed.error) throw signed.error
  const factors = await client.auth.mfa.listFactors()
  const factor = factors.data?.totp.find((item) => item.status === 'verified')
  if (!factor) throw new Error('Fator TOTP QA nao encontrado.')
  const aalBefore = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  const verified = await verifyFreshTotp(client, factor.id, actor.totpSecret)
  const session = await client.rpc('registrar_sessao_mfa_atual', { p_factor_id: factor.id })
  if (session.error) throw session.error
  const aalAfter = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aalAfter.data?.currentLevel !== 'aal2') throw new Error('Cliente autenticado nao atingiu AAL2.')
  return { client, factorId: factor.id, lastCode: verified.code, aalBefore: aalBefore.data?.currentLevel, aalAfter: aalAfter.data?.currentLevel }
}

async function authorizeSensitiveReview(client, factorId, secret) {
  const before = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  const verified = await verifyFreshTotp(client, factorId, secret)
  const nonceHash = createHash('sha256').update(randomUUID()).digest('hex')
  const created = await client.rpc('criar_autorizacao_acao_sensivel', { p_action_type: 'revisar_risco_operacao', p_nonce_hash: nonceHash })
  if (created.error) throw created.error
  const consumed = await client.rpc('consumir_autorizacao_acao_sensivel', { p_action_type: 'revisar_risco_operacao', p_nonce_hash: nonceHash })
  if (consumed.error || consumed.data !== true) throw consumed.error || new Error('Autorizacao sensivel nao consumida.')
  const after = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  return { verified: true, aal_before: before.data?.currentLevel, aal_after: after.data?.currentLevel, challenge_id_recorded: Boolean(verified.challengeId), authorization_created: true, authorization_consumed: true }
}

async function verifyFreshTotp(client, factorId, secret, priorCode = generateTotp(secret)) {
  let code = generateTotp(secret)
  if (priorCode && code === priorCode) {
    const deadline = Date.now() + 35_000
    while (code === priorCode && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      code = generateTotp(secret)
    }
  }
  const challenge = await client.auth.mfa.challenge({ factorId })
  if (challenge.error || !challenge.data?.id) throw challenge.error || new Error('Challenge TOTP nao criado.')
  const verify = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code })
  if (verify.error) throw verify.error
  return { code, challengeId: challenge.data.id }
}

async function loginWithMfa(page, actor) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 60_000 })
  await page.type('#email', actor.email)
  await page.type('#password', actor.password)
  await clickText(page, 'button', 'Entrar')
  await page.waitForFunction(() => location.pathname !== '/login', { timeout: 60_000 })
  const before = new URL(page.url()).pathname
  if (before !== '/mfa/desafio') throw new Error(`Desafio MFA nao exibido: ${before}`)
  await page.waitForSelector('#code', { timeout: 60_000 })
  await page.type('input[name="code"]', generateTotp(actor.totpSecret))
  await clickText(page, 'button', 'Verificar codigo')
  await page.waitForFunction(() => location.pathname !== '/mfa/desafio', { timeout: 60_000 })
  return { aal_after_totp: 'aal2', final_path: new URL(page.url()).pathname }
}

async function saveWitnessesOfficial(page, fixture, witnesses) {
  await setFundOfficial(page, fixture)
  await page.goto(`${BASE_URL}/gestor/operacoes/${fixture.operacao}`, { waitUntil: 'networkidle2', timeout: 60_000 })
  try {
    await page.waitForFunction(() => document.body.innerText.includes('Testemunhas do Termo'), { timeout: 20_000 })
  } catch (error) {
    const body = await page.evaluate(() => document.body.innerText.slice(0, 4_000))
    throw new Error(`Testemunhas indisponiveis em ${page.url()}: ${redact(body)}`, { cause: error })
  }
  const selectWitness = async (index, name) => {
    const clicked = await page.evaluate((selectIndex) => {
      const marker = [...document.querySelectorAll('p')].find((item) => item.textContent?.includes('Testemunhas do Termo'))
      const container = marker?.parentElement
      const controls = [...(container?.querySelectorAll('[role="combobox"]') || [])]
      const control = controls[selectIndex]
      if (!control) return false
      control.click()
      return true
    }, index)
    if (!clicked) throw new Error(`Seletor de testemunha ${index + 1} nao encontrado.`)
    await page.waitForFunction((expected) => [...document.querySelectorAll('[role="option"]')].some((item) => item.textContent?.includes(expected)), { timeout: 15_000 }, name)
    if (!await clickText(page, '[role="option"]', name, { optional: true })) throw new Error(`Opcao ${name} nao encontrada.`)
  }
  await selectWitness(0, witnesses[0].nome)
  await selectWitness(1, witnesses[1].nome)
  const startedAt = new Date().toISOString()
  await clickText(page, 'button', 'Salvar Testemunhas')
  await page.waitForFunction(() => document.body.innerText.includes('Testemunhas salvas.'), { timeout: 60_000 })
  return { success: true, started_at: startedAt, finished_at: new Date().toISOString(), testemunha_1_id: witnesses[0].id, testemunha_2_id: witnesses[1].id }
}

async function setFundOfficial(page, fixture) {
  const expected = `QA P2.6.10 ${fixture.codigo} FIDC`
  await page.goto(`${BASE_URL}/gestor/dashboard`, { waitUntil: 'networkidle2', timeout: 60_000 })
  await page.waitForFunction(() => !document.body.innerText.includes('Carregando fundo...'), { timeout: 30_000 }).catch(() => {})
  const active = await page.$$eval('button[title]', (buttons, title) => buttons.some((button) => button.getAttribute('title') === title), expected)
  if (active) return
  if (!await clickText(page, 'button', 'Fundo ativo:', { optional: true })) throw new Error(`Seletor de fundo indisponivel: ${expected}`)
  await page.waitForSelector('input[placeholder="Buscar fundo ou CNPJ"]', { timeout: 15_000 })
  await page.type('input[placeholder="Buscar fundo ou CNPJ"]', expected)
  if (!await clickText(page, 'button', expected, { optional: true })) throw new Error(`Fundo QA nao encontrado: ${expected}`)
  await page.waitForFunction((title) => [...document.querySelectorAll('button[title]')].some((button) => button.getAttribute('title') === title), { timeout: 60_000 }, expected)
}

async function operation(admin, id) {
  const row = await admin.from('operacoes').select('id,status,updated_at,taxa_desconto,testemunha_1_id,testemunha_2_id').eq('id', id).single()
  if (row.error) throw row.error
  const risks = await admin.from('risco_execucoes').select('id', { count: 'exact', head: true }).eq('operacao_id', id)
  return { ...row.data, risk_count: risks.count || 0 }
}

async function one(admin, table, id) {
  const result = await admin.from(table).select('*').eq('id', id).maybeSingle()
  if (result.error) throw result.error
  return result.data
}

async function latestAudit(admin, entityId, type, correlationId) {
  const result = await admin.from('logs_auditoria').select('*').eq('entidade_id', entityId).eq('tipo_evento', type).order('created_at', { ascending: false }).limit(10)
  if (result.error) throw result.error
  return (result.data || []).find((row) => row.dados_depois?.correlation_id === correlationId) || null
}

async function clickText(page, selector, expected, options = {}) {
  const clicked = await page.$$eval(selector, (nodes, text) => {
    const node = nodes.find((item) => item.textContent?.replace(/\s+/g, ' ').trim().includes(text) && !item.disabled)
    if (!node) return false
    node.click()
    return true
  }, expected)
  if (!clicked && !options.optional) throw new Error(`Elemento nao encontrado: ${expected}`)
  return clicked
}

function writeEvidence(name, value) {
  writeFileSync(resolve(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function redact(value) {
  return String(value).replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>').replace(/(token|password|senha|secret|otp|code)\s*[:=]\s*\S+/gi, '$1=<redigido>')
}
