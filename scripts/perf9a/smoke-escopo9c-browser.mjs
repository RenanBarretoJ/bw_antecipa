#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { generateTotp } from './dataset.mjs'
import {
  assertHomologEnvironment,
  createAdminClient,
  getPerf9aLocalDir,
  loadEnvFile,
  writeRestrictedJson,
} from './common.mjs'

const BASE_URL = 'http://localhost:3001'
const NOTIFICATION_PROFILES = ['gestor_a', 'cedente_a', 'consultor_a', 'sacado_a']

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main()
  } catch (error) {
    console.error(`Smoke Escopo 9C falhou: ${safeError(error)}`)
    process.exitCode = 1
  }
}

async function main() {
  loadEnvFile('.env.homolog')
  const env = assertHomologEnvironment()
  const admin = createAdminClient(env)
  const credentials = JSON.parse(readFileSync(
    resolve(getPerf9aLocalDir('credentials'), `users-${env.projectRef}.json`),
    'utf8',
  ))
  const users = new Map(credentials.users.map((user) => [user.key, user]))
  const fixtures = await loadFixtures(admin)
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const notificationResults = []
  const fundResults = []

  try {
    for (const userKey of NOTIFICATION_PROFILES) {
      notificationResults.push(await testNotifications(browser, users.get(userKey), userKey))
    }

    for (const scenario of [
      { label: 'sem cookie', cookie: null },
      { label: 'cookie invalido', cookie: 'invalido' },
      { label: 'cookie nao autorizado', cookie: fixtures.fundB.id },
      { label: 'cookie autorizado', cookie: fixtures.fundA.id },
    ]) {
      fundResults.push(await testFundContext(browser, users.get('gestor_a'), fixtures, scenario))
    }

    fundResults.push(await testCrossFundNota(browser, users.get('gestor_a'), fixtures.nfB.id))
  } finally {
    await browser.close()
  }

  const passed = notificationResults.every((result) => result.passed)
    && fundResults.every((result) => result.passed)
  const evidence = {
    scope: '9C',
    gate: 'smoke-direcionado',
    projectRef: env.projectRef,
    executedAt: new Date().toISOString(),
    notificationResults,
    fundResults,
    status: passed ? 'APROVADO' : 'NO-GO',
  }
  const evidencePath = resolve(
    getPerf9aLocalDir('evidence'),
    `smoke-escopo9c-${env.projectRef}-${new Date().toISOString().replaceAll(':', '-')}.json`,
  )
  writeRestrictedJson(evidencePath, evidence)
  console.log(`Smoke direcionado Escopo 9C: ${evidence.status}`)
  for (const result of notificationResults) console.log(`- [${result.passed ? 'OK' : 'FALHA'}] notificacoes ${result.userKey}`)
  for (const result of fundResults) console.log(`- [${result.passed ? 'OK' : 'FALHA'}] ${result.label}`)
  console.log(`Evidencia local restrita: ${evidencePath}`)
  if (!passed) process.exitCode = 1
}

async function testNotifications(browser, user, userKey) {
  if (!user) return { userKey, passed: false, reason: 'credencial ausente' }
  const { context, page, failures } = await authenticatedPage(browser, user)
  try {
    const role = userKey.split('_')[0]
    const response = await page.goto(`${BASE_URL}/${role}/notificacoes`, {
      waitUntil: 'networkidle2',
      timeout: 45_000,
    })
    const loadMore = await findButtonByText(page, 'Carregar mais')
    let clickedLoadMore = false
    if (loadMore) {
      clickedLoadMore = true
      await loadMore.click()
      await page.waitForFunction(
        () => !Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.includes('Carregando...')),
        { timeout: 30_000 },
      )
    }
    const body = await page.evaluate(() => document.body?.innerText || '')
    const hasCursorError = /CursorPayload inv[aá]lido/i.test(body)
    const hasOperationalError = /Application error|Internal Server Error/i.test(body)
    return {
      userKey,
      httpStatus: response?.status() ?? null,
      clickedLoadMore,
      failures,
      hasCursorError,
      passed: response?.status() === 200
        && !hasCursorError
        && !hasOperationalError
        && failures.every((failure) => failure.status < 500),
    }
  } finally {
    await page.close()
    await context.close()
  }
}

async function testFundContext(browser, user, fixtures, scenario) {
  const { context, page, failures } = await authenticatedPage(browser, user)
  try {
    await page.deleteCookie({ name: 'bw_fundo_ativo_id', domain: 'localhost', path: '/' })
    if (scenario.cookie) {
      await page.setCookie({
        name: 'bw_fundo_ativo_id',
        value: scenario.cookie,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      })
    }
    const response = await page.goto(`${BASE_URL}/gestor/dashboard`, {
      waitUntil: 'networkidle2',
      timeout: 45_000,
    })
    const body = await page.evaluate(() => document.body?.innerText || '')
    const hasRaceError = /Selecione um fundo ativo para continuar/i.test(body)
    const showsAuthorizedFund = body.includes(fixtures.fundA.nome)
    const showsUnauthorizedFundAsActive = body.includes(`Fundo ativo: ${fixtures.fundB.nome}`)
    return {
      label: `fundo ativo ${scenario.label}`,
      httpStatus: response?.status() ?? null,
      failures,
      hasRaceError,
      showsAuthorizedFund,
      showsUnauthorizedFundAsActive,
      passed: response?.status() === 200
        && !hasRaceError
        && showsAuthorizedFund
        && !showsUnauthorizedFundAsActive
        && failures.every((failure) => failure.status < 500),
    }
  } finally {
    await page.close()
    await context.close()
  }
}

async function testCrossFundNota(browser, user, notaFiscalId) {
  const { context, page, failures } = await authenticatedPage(browser, user)
  try {
    const response = await page.goto(`${BASE_URL}/gestor/notas-fiscais/${notaFiscalId}`, {
      waitUntil: 'networkidle2',
      timeout: 45_000,
    })
    const body = await page.evaluate(() => document.body?.innerText || '')
    const exposed = body.includes('PERF9A_FUNDO B') || /Arquivo original/i.test(body)
    return {
      label: 'ID de NF de fundo adversario',
      httpStatus: response?.status() ?? null,
      exposed,
      failures,
      passed: !exposed
        && response?.status() !== 500
        && failures.every((failure) => failure.status < 500),
    }
  } finally {
    await page.close()
    await context.close()
  }
}

async function authenticatedPage(browser, user) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  const failures = []
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push({ status: response.status(), url: safeUrl(response.url()) })
  })
  await login(page, user)
  return { context, page, failures }
}

async function login(page, user) {
  if (!user) throw new Error('Credencial PERF9A ausente.')
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 45_000 })
  await page.type('#email', user.email)
  await page.type('#password', user.password)
  await Promise.all([
    page.waitForFunction(() => !window.location.pathname.endsWith('/login'), { timeout: 45_000 }),
    page.click('button[type="submit"]'),
  ])
  if (new URL(page.url()).pathname === '/mfa/desafio') {
    await page.waitForSelector('input[name="code"]', { timeout: 45_000 })
    await page.type('input[name="code"]', generateTotp(user.totpSecret))
    await Promise.all([
      page.waitForFunction(() => !window.location.pathname.endsWith('/mfa/desafio'), { timeout: 45_000 }),
      page.click('form button[type="submit"]'),
    ])
  }
  const finalPath = new URL(page.url()).pathname
  if (finalPath === '/login' || finalPath.startsWith('/mfa/')) {
    throw new Error(`Login nao concluido: ${finalPath}`)
  }
}

async function loadFixtures(admin) {
  const { data: funds, error: fundsError } = await admin
    .from('fundos')
    .select('id,nome')
    .in('nome', ['PERF9A_FUNDO A', 'PERF9A_FUNDO B'])
  if (fundsError) throw new Error(fundsError.message)
  const fundA = funds?.find((fund) => fund.nome === 'PERF9A_FUNDO A')
  const fundB = funds?.find((fund) => fund.nome === 'PERF9A_FUNDO B')
  if (!fundA || !fundB) throw new Error('Fundos PERF9A A/B ausentes.')
  const { data: nfB, error: nfError } = await admin
    .from('notas_fiscais')
    .select('id')
    .eq('fundo_id', fundB.id)
    .limit(1)
    .maybeSingle()
  if (nfError || !nfB) throw new Error(nfError?.message || 'NF do Fundo B ausente.')
  return { fundA, fundB, nfB }
}

async function findButtonByText(page, text) {
  const handles = await page.$$('button')
  for (const handle of handles) {
    const content = await handle.evaluate((element) => element.textContent || '')
    if (content.includes(text)) return handle
  }
  return null
}

function safeUrl(value) {
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return '<url-redigida>'
  }
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>')
}
