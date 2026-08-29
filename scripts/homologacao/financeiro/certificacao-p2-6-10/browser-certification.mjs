#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServerClient } from '@supabase/ssr'
import { generateTotp } from '../../../perf9a/dataset.mjs'
import { assertHomologEnvironment, createAdminClient, loadEnvFile } from '../../../perf9a/common.mjs'

const BASE_URL = String(process.env.P2_6_10_BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
const PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const CERTIFICATION_SUFFIX = String(process.env.P2_6_10_EVIDENCE_SUFFIX || 'p2-6-10')
const ACTORS_PHASE = String(process.env.P2_6_10_ACTORS_PHASE || 'p2-6-10')
const ACTORS_FILE = resolve(process.env.LOCALAPPDATA || '', 'BWAntecipa', 'perf9a', ACTORS_PHASE, `actors-${PROJECT_REF}.json`)
const EVIDENCE_DIR = resolve('docs/financeiro')
const IDS = {
  APTO: { codigo: 'APTO', fundo: '85acdc77-abbe-cd58-699a-ddf15aa58010', operacao: '70c034e1-185b-0308-d695-aaa8c6ba196b' },
  NO_LIMITE_40: { codigo: 'NO_LIMITE_40', fundo: '04f1fa22-f95f-2faf-efba-282f812b6131', operacao: 'a88654fe-5f49-6d49-5698-1689b686851e' },
  ACIMA_40: { codigo: 'ACIMA_40', fundo: '75bb1c2b-2628-2c15-bd3b-e0822a0b36c0', operacao: '50de4ab8-e724-5b2f-9e3d-f63291e089bd' },
  REVISAO_LIBERAR: { codigo: 'REVISAO_LIBERAR', fundo: '1410361b-6f13-f637-5129-fd6af7482381', operacao: '2feabc52-01a8-ca78-80c8-b149137b1c15' },
  REVISAO_RECUSAR: { codigo: 'REVISAO_RECUSAR', fundo: '55616169-f250-0e31-4d77-f238baea796c', operacao: 'cd69349b-16ea-fe86-61a8-b90ccfd1e0a2' },
  DOUBLE: { codigo: 'DOUBLE', fundo: '25f48a4c-49fc-7cb4-73a4-49c4359ada37', operacao: 'd19aa79d-60d9-9066-51c7-e19ea66f37ab' },
  TOCTOU: { codigo: 'TOCTOU', fundo: 'ff4015bc-3004-b230-093b-f8ab245a4b03', operacao: '36156774-ad52-d6a4-4803-9fbd205b7919' },
  STALE_REVIEW: { codigo: 'STALE_REVIEW', fundo: 'f8ec486e-f95d-7695-aa1d-1795c38eb028', operacao: '0280a33b-d3a3-0980-3924-935547a7a06e' },
}

await main().catch((error) => {
  console.error(`Certificacao browser P2.6.10 falhou: ${redact(error instanceof Error ? error.stack || error.message : String(error))}`)
  process.exitCode = 1
})

async function main() {
  loadEnvFile('.env.homolog')
  const env = assertHomologEnvironment()
  if (env.projectRef !== PROJECT_REF) throw new Error(`Projeto inesperado: ${env.projectRef}`)
  const actors = new Map(JSON.parse(readFileSync(ACTORS_FILE, 'utf8')).actors.map((actor) => [actor.key, actor]))
  const admin = createAdminClient(env)
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  const report = { environment: 'homolog', project_ref: env.projectRef, production_touched: false, executed_at: new Date().toISOString() }
  try {
    const sessionA = await browser.createBrowserContext()
    const pageA = await sessionA.newPage()
    const login = await loginWithMfa(pageA, actors.get('gestor_a'), env, { invalidTotpControl: true })
    report.login = login
    writeEvidence('authenticated-smoke-login-mfa-p2-6-10.json', {
      gate: 'AUTHENTICATED_SMOKE_LOGIN_MFA',
      status: login.status,
      ...report,
      ...login,
      actor_cleanup: 'PENDING_FINAL_CLEANUP',
    })

    if (process.env.P2_6_10_PHASE === 'review') {
      const reviewRelease = await reviewScenario(pageA, admin, actors.get('gestor_a'), 'REVISAO_LIBERAR', IDS.REVISAO_LIBERAR, 'LIBERADA')
      const reviewReject = await reviewScenario(pageA, admin, actors.get('gestor_a'), 'REVISAO_RECUSAR', IDS.REVISAO_RECUSAR, 'RECUSADA')
      const negativePure = await protectedOperationNegative(browser, actors.get('super_admin_puro'), env, IDS.REVISAO_LIBERAR.operacao)
      const negativeCrossFund = await protectedOperationNegative(browser, actors.get('gestor_b'), env, IDS.REVISAO_LIBERAR.operacao)
      const negativeWithoutLink = await protectedOperationNegative(browser, actors.get('gestor_sem_vinculo'), env, IDS.REVISAO_LIBERAR.operacao)
      report.review = {
        release: reviewRelease,
        reject: reviewReject,
        negative_super_admin_puro: negativePure,
        negative_cross_fund: negativeCrossFund,
        negative_without_link: negativeWithoutLink,
      }
      report.review.status = reviewRelease.status === 'PASS' && reviewReject.status === 'PASS' && negativePure.denied && negativeCrossFund.denied && negativeWithoutLink.denied ? 'PASS' : 'FAIL'
      writeEvidence('smoke-revisao-manual-p2-6-10.json', { gate: 'SMOKE_REVISAO_MANUAL', ...report, ...report.review })
      writeEvidence('browser-certification-p2-6-10.raw.json', report)
      await sessionA.close()
      console.log(`Browser P2.6.10 revisao concluido: login=${login.status}, revisao=${report.review.status}`)
      return
    }

    const central = process.env.P2_6_10_SKIP_CENTRAL === 'true'
      ? { status: 'SKIPPED_DEBUG' }
      : await centralVisualSmoke(pageA, IDS.APTO)
    report.central = central
    if (central.status !== 'SKIPPED_DEBUG') writeEvidence('central-visual-smoke-p2-6-10.json', { gate: 'CENTRAL_VISUAL_SMOKE', ...report, ...central })

    if (process.env.P2_6_10_PHASE === 'central') {
      writeEvidence('browser-certification-p2-6-10.raw.json', report)
      await sessionA.close()
      console.log(`Browser P2.6.10 Central concluido: login=${login.status}, central=${central.status}`)
      return
    }

    report.apto = await approveScenario(pageA, admin, 'APTO', IDS.APTO)
    writeEvidence('smoke-apto-approval-p2-6-10.json', { gate: 'SMOKE_APTO_APPROVAL', ...report, ...report.apto })

    if (process.env.P2_6_10_ONLY_APTO === 'true') {
      writeEvidence('browser-certification-p2-6-10.raw.json', report)
      await sessionA.close()
      console.log(`Browser P2.6.10 parcial concluido: login=${login.status}, apto=${report.apto.status}`)
      return
    }

    const exact = await approveScenario(pageA, admin, 'NO_LIMITE_40', IDS.NO_LIMITE_40)
    const above = await approveScenario(pageA, admin, 'ACIMA_40', IDS.ACIMA_40)
    report.limit40 = { exact, above, status: exact.status === 'PASS' && above.final_operation_status !== 'aprovada' && above.risk_decision === 'BLOQUEADO' ? 'PASS' : 'FAIL' }
    writeEvidence('smoke-no-limite-40-p2-6-10.json', { gate: 'SMOKE_NO_LIMITE_40', ...report, ...report.limit40 })

    const reviewRelease = await reviewScenario(pageA, admin, actors.get('gestor_a'), 'REVISAO_LIBERAR', IDS.REVISAO_LIBERAR, 'LIBERADA')
    const reviewReject = await reviewScenario(pageA, admin, actors.get('gestor_a'), 'REVISAO_RECUSAR', IDS.REVISAO_RECUSAR, 'RECUSADA')
    const negativePure = await protectedOperationNegative(browser, actors.get('super_admin_puro'), env, IDS.REVISAO_LIBERAR.operacao)
    const negativeCrossFund = await protectedOperationNegative(browser, actors.get('gestor_b'), env, IDS.REVISAO_LIBERAR.operacao)
    const negativeWithoutLink = await protectedOperationNegative(browser, actors.get('gestor_sem_vinculo'), env, IDS.REVISAO_LIBERAR.operacao)
    report.review = {
      release: reviewRelease,
      reject: reviewReject,
      negative_super_admin_puro: negativePure,
      negative_cross_fund: negativeCrossFund,
      negative_without_link: negativeWithoutLink,
    }
    report.review.status = reviewRelease.status === 'PASS' && reviewReject.status === 'PASS' && negativePure.denied && negativeCrossFund.denied && negativeWithoutLink.denied ? 'PASS' : 'FAIL'
    writeEvidence('smoke-revisao-manual-p2-6-10.json', { gate: 'SMOKE_REVISAO_MANUAL', ...report, ...report.review })

    const sessionB = await browser.createBrowserContext()
    const pageB = await sessionB.newPage()
    report.login_b = await loginWithMfa(pageB, actors.get('gestor_b'), env)
    report.double = await doubleApproval(pageA, pageB, admin, IDS.DOUBLE)
    writeEvidence('double-operation-approval-p2-6-10.json', { gate: 'DOUBLE_OPERATION_APPROVAL', ...report, ...report.double })
    await sessionB.close()

    writeEvidence('browser-certification-p2-6-10.raw.json', report)
    await sessionA.close()
    console.log(`Browser P2.6.10 concluido: login=${login.status}, central=${central.status}, apto=${report.apto.status}, limite40=${report.limit40.status}, revisao=${report.review.status}, dupla=${report.double.status}`)
  } finally {
    await browser.close()
  }
}

async function loginWithMfa(page, actor, env, options = {}) {
  if (!actor) throw new Error('Ator QA ausente')
  const diagnostics = monitorPage(page)
  const response = await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 60_000 })
  await page.type('#email', actor.email)
  await page.type('#password', actor.password)
  await Promise.all([
    page.waitForFunction(() => location.pathname !== '/login', { timeout: 60_000 }),
    clickText(page, 'button', 'Entrar'),
  ])
  const passwordPath = new URL(page.url()).pathname
  const before = await browserAal(page, env)
  if (passwordPath === '/mfa/desafio') await page.waitForSelector('input[name="code"]', { timeout: 60_000 })
  const challengeVisible = passwordPath === '/mfa/desafio' && Boolean(await page.$('input[name="code"]'))
  let invalidTotpDenied = null
  if (options.invalidTotpControl) {
    const valid = generateTotp(actor.totpSecret)
    const invalid = `${valid.slice(0, 5)}${(Number(valid[5]) + 1) % 10}`
    await page.type('input[name="code"]', invalid)
    await clickText(page, 'button', 'Verificar codigo')
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((item) => item.textContent?.includes('Verificar codigo')), { timeout: 30_000 })
    invalidTotpDenied = new URL(page.url()).pathname === '/mfa/desafio'
    await clear(page, 'input[name="code"]')
  }
  await page.type('input[name="code"]', generateTotp(actor.totpSecret))
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((item) => item.textContent?.includes('Verificar codigo')), { timeout: 30_000 })
  await Promise.all([
    page.waitForFunction(() => location.pathname !== '/mfa/desafio', { timeout: 60_000 }),
    clickText(page, 'button', 'Verificar codigo'),
  ])
  const after = await browserAal(page, env)
  const finalPath = new URL(page.url()).pathname
  const captured = diagnostics.stop()
  const status = response?.status() === 200 && before.currentLevel === 'aal1' && after.currentLevel === 'aal2' && challengeVisible && !/\/login|\/mfa\//.test(finalPath) && captured.fiveXx.length === 0 ? 'PASS' : 'FAIL'
  return {
    status,
    login_page_status: response?.status() || null,
    password_submit_result: passwordPath === '/mfa/desafio' ? 'PASS' : 'FAIL',
    aal_before_totp: before.currentLevel,
    mfa_challenge_visible: challengeVisible,
    invalid_totp_denied: invalidTotpDenied,
    totp_submit_result: after.currentLevel === 'aal2' ? 'PASS' : 'FAIL',
    aal_after_totp: after.currentLevel,
    redirect_final: finalPath,
    no_500: captured.fiveXx.length === 0,
    no_loop: !/\/login|\/mfa\//.test(finalPath),
    cookies_session_established: (await page.cookies()).some((cookie) => cookie.name.includes('-auth-token')),
    diagnostics: captured,
  }
}

async function browserAal(page, env) {
  const cookies = await page.cookies(BASE_URL)
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!anonKey) throw new Error('Chave anonima de homologacao ausente')
  const supabase = createServerClient(env.supabaseUrl, anonKey, {
    cookies: { getAll: () => cookies.map(({ name, value }) => ({ name, value })), setAll: () => {} },
  })
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  return { currentLevel: data.currentLevel, nextLevel: data.nextLevel }
}

async function centralVisualSmoke(page, initialFund) {
  await setFundOfficial(page, initialFund)
  const tabs = ['matching', 'conciliacao', 'logistica', 'exposicao', 'risco', 'excecoes']
  const results = []
  for (const viewport of [{ width: 1440, height: 900, label: 'desktop' }, { width: 900, height: 768, label: 'compact' }]) {
    await page.setViewport(viewport)
    for (const tab of tabs) {
      const diagnostics = monitorPage(page)
      const response = await page.goto(`${BASE_URL}/gestor/conciliacao?tab=${tab}`, { waitUntil: 'networkidle2', timeout: 60_000 })
      const snapshot = await page.evaluate(() => {
        const text = document.body?.innerText || ''
        return {
          title: document.querySelector('h1')?.textContent?.trim() || null,
          has_tabs: Boolean(document.querySelector('nav[aria-label="Secoes da conciliacao"]')),
          has_filters: Boolean(document.querySelector('form input[name="q"]')),
          has_cards: document.querySelectorAll('[data-slot="card"], .rounded-xl.border').length > 0,
          error_page: /Application error|Internal Server Error|This page could not be found/i.test(text),
        }
      })
      results.push({ viewport: viewport.label, tab, http_status: response?.status() || null, final_path: new URL(page.url()).pathname + new URL(page.url()).search, ...snapshot, diagnostics: diagnostics.stop() })
    }
  }
  const headerDiagnostics = monitorPage(page)
  await page.goto(`${BASE_URL}/gestor/dashboard`, { waitUntil: 'networkidle2', timeout: 60_000 })
  const notificationBell = await page.$('button[aria-label*="Notifica"]')
  const notificationBellVisible = Boolean(notificationBell)
  if (notificationBell) await notificationBell.click()
  const notificationDropdownVisible = await page.waitForFunction(
    () => [...document.querySelectorAll('p')].some((item) => item.textContent?.includes('Notifica')),
    { timeout: 10_000 },
  ).then(() => true).catch(() => false)
  const notificationDiagnostics = headerDiagnostics.stop()

  await setFundOfficial(page, IDS.NO_LIMITE_40)
  await page.reload({ waitUntil: 'networkidle2', timeout: 60_000 })
  await page.waitForFunction(() => !document.body.innerText.includes('Carregando fundo...'), { timeout: 30_000 }).catch(() => {})
  const expectedFundTitle = `QA P2.6.10 ${IDS.NO_LIMITE_40.codigo} FIDC`
  const fundPersistedAfterReload = await page.$$eval(
    'button[title]',
    (buttons, expected) => buttons.some((button) => button.getAttribute('title') === expected),
    expectedFundTitle,
  )
  await setFundOfficial(page, initialFund)

  const viewsPass = results.every((item) => item.http_status === 200 && item.title === 'Conciliacao' && item.has_tabs && !item.error_page && item.diagnostics.fiveXx.length === 0 && item.diagnostics.consoleErrors.length === 0)
  const notificationsPass = notificationBellVisible && notificationDropdownVisible && notificationDiagnostics.fiveXx.length === 0 && notificationDiagnostics.consoleErrors.length === 0
  const status = viewsPass && notificationsPass && fundPersistedAfterReload ? 'PASS' : 'FAIL'
  return {
    status,
    authenticated_actor: 'gestor_a',
    aal: 'aal2',
    results,
    notification_bell_visible: notificationBellVisible,
    notification_dropdown_visible: notificationDropdownVisible,
    notification_diagnostics: notificationDiagnostics,
    fund_switch_via_server_action: true,
    fund_persisted_after_reload: fundPersistedAfterReload,
  }
}

async function approveScenario(page, admin, name, fixture) {
  await setFund(page, fixture.fundo)
  const before = await operationSnapshot(admin, fixture.operacao)
  const startedAt = new Date().toISOString()
  const ui = await clickApproval(page, fixture.operacao)
  if (!ui.clicked) {
    return {
      scenario: name,
      status: 'FAIL',
      request_started_at: startedAt,
      request_finished_at: new Date().toISOString(),
      status_before: before.status,
      status_after: before.status,
      final_operation_status: before.status,
      risk_decision: null,
      failure: 'A acao oficial de aprovacao nao estava habilitada na interface.',
      ui,
    }
  }
  let after
  try {
    after = await waitForRisk(admin, fixture.operacao, before.risk_count, 20_000)
  } catch (error) {
    const operation = await operationSnapshot(admin, fixture.operacao)
    return {
      scenario: name,
      status: 'FAIL',
      request_started_at: startedAt,
      request_finished_at: new Date().toISOString(),
      status_before: before.status,
      status_after: operation.status,
      final_operation_status: operation.status,
      risk_decision: null,
      failure: redact(error instanceof Error ? error.message : String(error)),
      ui,
    }
  }
  const operation = await operationSnapshot(admin, fixture.operacao)
  const decision = after.latest_risk?.decisao || null
  const expectedApproved = name !== 'ACIMA_40'
  const status = expectedApproved
    ? (decision === 'APTO' && operation.status === 'aprovada' ? 'PASS' : 'FAIL')
    : (decision === 'BLOQUEADO' && operation.status !== 'aprovada' ? 'PASS' : 'FAIL')
  return {
    scenario: name,
    status,
    request_started_at: startedAt,
    request_finished_at: new Date().toISOString(),
    status_before: before.status,
    status_after: operation.status,
    final_operation_status: operation.status,
    risk_decision: decision,
    risk_execution_id: after.latest_risk?.id || null,
    projected_exposure_pct: after.latest_risk?.exposicao_projetada_pct ?? null,
    limit_pct: after.latest_risk?.limite_pct ?? null,
    reasons: after.reasons,
    approval_rpc_path: 'server_action:aprovarOperacao -> executarGateRisco -> aprovar_operacao_com_risco_atomica',
    bypass: false,
    ui,
  }
}

async function reviewScenario(page, admin, actor, name, fixture, decision) {
  await setFundOfficial(page, fixture)
  const before = await operationSnapshot(admin, fixture.operacao)
  let risk = await latestRisk(admin, fixture.operacao)
  let firstAttempt = null
  if (!risk.latest_review || risk.latest_review.status !== 'PENDENTE') {
    firstAttempt = await clickApproval(page, fixture.operacao)
    if (!firstAttempt.clicked) return { scenario: name, status: 'FAIL', reason: 'Acao de aprovacao indisponivel', firstAttempt }
    try {
      risk = await waitForRisk(admin, fixture.operacao, before.risk_count, 20_000)
    } catch (error) {
      return { scenario: name, status: 'FAIL', reason: redact(error instanceof Error ? error.message : String(error)), firstAttempt }
    }
  }
  if (risk.latest_risk?.decisao !== 'REVISAO_MANUAL' || !risk.latest_review) {
    return { scenario: name, status: 'FAIL', reason: 'REVISAO_MANUAL nao criada', firstAttempt, risk }
  }

  const missing = await decideReview(page, actor, fixture, decision, { withoutTotp: true })
  const afterMissing = await reviewSnapshot(admin, risk.latest_review.id)
  const invalid = await decideReview(page, actor, fixture, decision, { invalidTotp: true })
  const afterInvalid = await reviewSnapshot(admin, risk.latest_review.id)
  const valid = await decideReview(page, actor, fixture, decision)
  const afterValid = await reviewSnapshot(admin, risk.latest_review.id)
  let approvalAfterRelease = null
  if (decision === 'LIBERADA') approvalAfterRelease = await clickApproval(page, fixture.operacao)
  const operation = await operationSnapshot(admin, fixture.operacao)
  const expectedReviewStatus = decision
  const status = afterMissing.status === 'PENDENTE' && afterInvalid.status === 'PENDENTE' && afterValid.status === expectedReviewStatus && (decision === 'RECUSADA' ? operation.status !== 'aprovada' : operation.status === 'aprovada') ? 'PASS' : 'FAIL'
  return {
    scenario: name,
    status,
    automatic_decision: risk.latest_risk.decisao,
    risk_execution_id: risk.latest_risk.id,
    review_id: risk.latest_review.id,
    missing_totp_control: { ui: missing, status_after: afterMissing.status, denied: afterMissing.status === 'PENDENTE' },
    invalid_totp_control: { ui: invalid, status_after: afterInvalid.status, denied: afterInvalid.status === 'PENDENTE' },
    decision_ui: valid,
    review_status: afterValid.status,
    approval_after_release: approvalAfterRelease,
    final_operation_status: operation.status,
  }
}

async function decideReview(page, actor, fixture, decision, options = {}) {
  await setFundOfficial(page, fixture)
  const diagnostics = monitorPage(page)
  await page.goto(`${BASE_URL}/gestor/conciliacao?tab=risco&operacao=${fixture.operacao}`, { waitUntil: 'networkidle2', timeout: 60_000 })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((item) => item.textContent?.includes('Revisar')), { timeout: 30_000 }).catch(() => {})
  const reviewed = await clickText(page, 'button', 'Revisar', { optional: true })
  if (!reviewed) return { opened: false, diagnostics: diagnostics.stop() }
  await page.waitForFunction(() => document.body.innerText.includes('Revisao manual de risco'), { timeout: 15_000 })
  const dialog = await page.$('[role="dialog"]')
  if (!dialog) throw new Error('Dialog da revisao nao encontrado')
  const decisionSelect = await dialog.$('select')
  const [justification, totpInput] = await dialog.$$('input')
  if (!decisionSelect) throw new Error('Decisao da revisao nao encontrada')
  await decisionSelect.select(decision)
  if (!justification || !totpInput) throw new Error('Campos da revisao nao encontrados')
  await justification.type(`Certificacao P2.6.10 ${decision.toLowerCase()}`)
  const valid = generateTotp(actor.totpSecret)
  const code = options.invalidTotp ? `${valid.slice(0, 5)}${(Number(valid[5]) + 1) % 10}` : valid
  if (!options.withoutTotp) await totpInput.type(code)
  const submitted = await clickText(page, 'button', 'Confirmar decisao', { optional: Boolean(options.withoutTotp) })
  if (submitted && !options.invalidTotp) {
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 60_000 })
  } else if (submitted) {
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"]')
      const button = [...(dialog?.querySelectorAll('button') || [])].find((item) => item.textContent?.includes('Confirmar decisao'))
      return Boolean(button && !button.disabled)
    }, { timeout: 60_000 }).catch(() => {})
  } else {
    await new Promise((done) => setTimeout(done, 500))
  }
  return { opened: true, invalid_totp: Boolean(options.invalidTotp), without_totp: Boolean(options.withoutTotp), final_path: new URL(page.url()).pathname + new URL(page.url()).search, diagnostics: diagnostics.stop() }
}

async function protectedOperationNegative(browser, actor, env, operationId) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  try {
    const login = await loginWithMfa(page, actor, env)
    const response = await page.goto(`${BASE_URL}/gestor/operacoes/${operationId}`, { waitUntil: 'networkidle2', timeout: 60_000 })
    const finalPath = new URL(page.url()).pathname
    const visibleText = await page.evaluate(() => document.body?.innerText || '')
    const operationVisible = visibleText.includes(`Operacao #${operationId.slice(0, 8)}`)
    return { actor: actor.key, login_status: login.status, http_status: response?.status() || null, final_path: finalPath, operation_visible: operationVisible, denied: !operationVisible }
  } finally {
    await context.close()
  }
}

async function doubleApproval(pageA, pageB, admin, fixture) {
  await Promise.all([setFund(pageA, fixture.fundo), setFund(pageB, fixture.fundo)])
  await Promise.all([
    pageA.goto(`${BASE_URL}/gestor/operacoes/${fixture.operacao}`, { waitUntil: 'networkidle2', timeout: 60_000 }),
    pageB.goto(`${BASE_URL}/gestor/operacoes/${fixture.operacao}`, { waitUntil: 'networkidle2', timeout: 60_000 }),
  ])
  const before = await operationSnapshot(admin, fixture.operacao)
  const times = {}
  const invoke = async (label, page) => {
    await page.waitForFunction(() => !document.body.innerText.includes('Carregando fundo...'), { timeout: 30_000 }).catch(() => {})
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((item) => item.textContent?.includes('Aprovar e Seguir')), { timeout: 30_000 }).catch(() => {})
    times[`${label}_start`] = Date.now()
    const result = await clickText(page, 'button', 'Aprovar e Seguir', { optional: true })
    await page.waitForFunction(() => !document.body.innerText.includes('Processando...'), { timeout: 90_000 }).catch(() => {})
    times[`${label}_end`] = Date.now()
    return { clicked: result, body_marker: await page.evaluate(() => document.body.innerText.match(/Operacao (?:aprovada|bloqueada)[^\n]*/i)?.[0] || null) }
  }
  const [a, b] = await Promise.all([invoke('a', pageA), invoke('b', pageB)])
  const after = await operationSnapshot(admin, fixture.operacao)
  const { count: effectiveApprovals } = await admin.from('logs_auditoria').select('id', { count: 'exact', head: true }).eq('entidade_id', fixture.operacao).eq('tipo_evento', 'OPERACAO_APROVADA')
  const { count: riskExecutions } = await admin.from('risco_execucoes').select('id', { count: 'exact', head: true }).eq('operacao_id', fixture.operacao)
  const overlapMs = Math.max(0, Math.min(times.a_end, times.b_end) - Math.max(times.a_start, times.b_start))
  const status = after.status === 'aprovada' && effectiveApprovals === 1 && riskExecutions === 1 && overlapMs > 0 ? 'PASS' : 'FAIL'
  return { status, before_status: before.status, final_status: after.status, request_a: a, request_b: b, timing: times, overlap_ms: overlapMs, effective_approval_events: effectiveApprovals, risk_executions: riskExecutions, audit_source: 'logs_auditoria' }
}

async function clickApproval(page, operationId) {
  const diagnostics = monitorPage(page)
  const response = await page.goto(`${BASE_URL}/gestor/operacoes/${operationId}`, { waitUntil: 'networkidle2', timeout: 60_000 })
  await page.waitForFunction(() => !document.body.innerText.includes('Carregando fundo...'), { timeout: 30_000 }).catch(() => {})
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((item) => item.textContent?.includes('Aprovar e Seguir')), { timeout: 30_000 }).catch(() => {})
  const clicked = await clickText(page, 'button', 'Aprovar e Seguir', { optional: true })
  if (clicked) await page.waitForFunction(() => !document.body.innerText.includes('Processando...'), { timeout: 90_000 }).catch(() => {})
  const message = await page.evaluate(() => [...document.querySelectorAll('[role="alert"], .text-destructive, .text-green-700')].map((item) => item.textContent?.trim()).filter(Boolean).slice(-3))
  const pageState = await page.evaluate(() => ({
    final_path: location.pathname + location.search,
    buttons: [...document.querySelectorAll('button')].map((item) => ({ text: item.textContent?.replace(/\s+/g, ' ').trim(), disabled: item.disabled })).filter((item) => item.text),
    visible_text: (document.body?.innerText || '').slice(0, 5000),
  }))
  return { http_status: response?.status() || null, clicked, message, ...pageState, diagnostics: diagnostics.stop() }
}

async function operationSnapshot(admin, operationId) {
  const { data, error } = await admin.from('operacoes').select('id,status,updated_at,risco_execucao_id,risco_assinatura_inputs').eq('id', operationId).single()
  if (error) throw error
  const { count } = await admin.from('risco_execucoes').select('id', { count: 'exact', head: true }).eq('operacao_id', operationId)
  return { ...data, risk_count: count || 0 }
}

async function waitForRisk(admin, operationId, previousCount, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const { data, error } = await admin.from('risco_execucoes').select('*').eq('operacao_id', operationId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw error
    const { count } = await admin.from('risco_execucoes').select('id', { count: 'exact', head: true }).eq('operacao_id', operationId)
    if ((count || 0) > previousCount && data) {
      const { data: reasons } = await admin.from('risco_execucao_motivos').select('codigo,severidade,quantidade,detalhes').eq('risco_execucao_id', data.id)
      const { data: review } = await admin.from('risco_revisoes').select('*').eq('risco_execucao_id', data.id).maybeSingle()
      return { latest_risk: data, latest_review: review || null, reasons: reasons || [] }
    }
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error(`Timeout aguardando risco da operacao ${operationId}`)
}

async function latestRisk(admin, operationId) {
  const { data, error } = await admin.from('risco_execucoes').select('*').eq('operacao_id', operationId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  if (!data) return { latest_risk: null, latest_review: null, reasons: [] }
  const { data: reasons } = await admin.from('risco_execucao_motivos').select('codigo,severidade,quantidade,detalhes').eq('risco_execucao_id', data.id)
  const { data: review } = await admin.from('risco_revisoes').select('*').eq('risco_execucao_id', data.id).maybeSingle()
  return { latest_risk: data, latest_review: review || null, reasons: reasons || [] }
}

async function reviewSnapshot(admin, reviewId) {
  const { data, error } = await admin.from('risco_revisoes').select('*').eq('id', reviewId).single()
  if (error) throw error
  return data
}

async function setFund(page, fundoId) {
  await page.setCookie({ name: 'bw_fundo_ativo_id', value: fundoId, url: BASE_URL, httpOnly: true, sameSite: 'Lax' })
}

async function setFundOfficial(page, fixture) {
  const expected = `QA P2.6.10 ${fixture.codigo} FIDC`
  await page.goto(`${BASE_URL}/gestor/dashboard`, { waitUntil: 'networkidle2', timeout: 60_000 })
  await page.waitForFunction(() => !document.body.innerText.includes('Carregando fundo...'), { timeout: 30_000 }).catch(() => {})
  const active = await page.$$eval('button[title]', (buttons, title) => buttons.some((button) => button.getAttribute('title') === title), expected)
  if (active) return
  const opened = await clickText(page, 'button', 'Fundo ativo:', { optional: true })
  if (!opened) throw new Error(`Seletor oficial de fundo indisponivel para ${expected}`)
  await page.waitForSelector('input[placeholder="Buscar fundo ou CNPJ"]', { timeout: 15_000 })
  await page.type('input[placeholder="Buscar fundo ou CNPJ"]', expected)
  const selected = await clickText(page, 'button', expected, { optional: true })
  if (!selected) throw new Error(`Fundo nao encontrado no seletor oficial: ${expected}`)
  await page.waitForFunction((title) => [...document.querySelectorAll('button[title]')].some((button) => button.getAttribute('title') === title), { timeout: 60_000 }, expected)
}

function monitorPage(page) {
  const consoleErrors = []
  const failedRequests = []
  const fiveXx = []
  const onConsole = (message) => { if (message.type() === 'error') consoleErrors.push(redact(message.text())) }
  const onFailed = (request) => failedRequests.push({ url: stripUrl(request.url()), error: redact(request.failure()?.errorText || 'failed') })
  const onResponse = (response) => { if (response.status() >= 500) fiveXx.push({ url: stripUrl(response.url()), status: response.status() }) }
  page.on('console', onConsole); page.on('requestfailed', onFailed); page.on('response', onResponse)
  return { stop() { page.off('console', onConsole); page.off('requestfailed', onFailed); page.off('response', onResponse); return { consoleErrors, failedRequests, fiveXx } } }
}

async function clickText(page, selector, text, options = {}) {
  const clicked = await page.$$eval(selector, (nodes, expected) => {
    const node = nodes.find((item) => item.textContent?.replace(/\s+/g, ' ').trim().includes(expected) && !item.disabled)
    if (!node) return false
    node.click()
    return true
  }, text)
  if (!clicked && !options.optional) throw new Error(`Elemento nao encontrado: ${selector} contendo ${text}`)
  return clicked
}

async function clear(page, selector) {
  await page.$eval(selector, (input) => { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })) })
}

function writeEvidence(name, value) {
  name = name.replaceAll('p2-6-10', CERTIFICATION_SUFFIX)
  const path = resolve(EVIDENCE_DIR, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function stripUrl(value) { try { const url = new URL(value); url.search = ''; url.hash = ''; return url.toString() } catch { return '<url-redigida>' } }
function redact(value) { return String(value).replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>').replace(/(token|password|senha|secret|otp|code)\s*[:=]\s*\S+/gi, '$1=<redigido>') }
