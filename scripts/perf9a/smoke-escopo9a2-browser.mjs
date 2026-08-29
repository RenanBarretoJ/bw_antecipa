#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { generateTotp } from './dataset.mjs'
import { assertHomologEnvironment, createAdminClient, getPerf9aLocalDir, loadEnvFile, writeRestrictedJson } from './common.mjs'

const BASE_URL = 'http://localhost:3001'
const ROUTES = [
  ['gestor', [
    '/gestor/dashboard', '/gestor/operacoes', '/gestor/onboarding-cedentes', '/gestor/notas-fiscais',
    '/gestor/documentos', '/gestor/cedentes', '/gestor/escrow', '/gestor/auditoria',
    '/gestor/notificacoes', '/gestor/relatorios',
  ]],
  ['cedente', [
    '/cedente/dashboard', '/cedente/notas-fiscais', '/cedente/operacoes', '/cedente/operacoes/nova',
    '/cedente/extrato', '/cedente/notificacoes',
  ]],
  ['consultor', [
    '/consultor/dashboard', '/consultor/operacoes', '/consultor/escrow', '/consultor/notificacoes',
    '/consultor/relatorios',
  ]],
  ['sacado', [
    '/sacado/dashboard', '/sacado/notas-fiscais', '/sacado/aprovacao', '/sacado/pagamentos',
    '/sacado/notificacoes',
  ]],
]

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main()
  } catch (error) {
    console.error(`Smoke navegador falhou: ${safeError(error)}`)
    process.exitCode = 1
  }
}

async function main() {
  loadEnvFile('.env.homolog')
  const env = assertHomologEnvironment()
  const admin = createAdminClient(env)
  const perf9aFundIds = await loadPerf9aFundIds(admin)
  const credentialsPath = resolve(getPerf9aLocalDir('credentials'), `users-${env.projectRef}.json`)
  const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'))
  const users = new Map(credentials.users.map((user) => [user.key, user]))
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const startedAt = new Date().toISOString()
  const results = []

  try {
    for (const [role, paths] of ROUTES) {
      const userKey = `${role}_a`
      const user = users.get(userKey)
      if (!user) throw new Error(`Credencial PERF9A ausente para ${userKey}.`)

      const context = typeof browser.createBrowserContext === 'function'
        ? await browser.createBrowserContext()
        : null
      const page = context ? await context.newPage() : await browser.newPage()
      const browserErrors = []
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') browserErrors.push({ source: 'console', type: message.type(), text: redact(message.text()) })
      })
      page.on('pageerror', (error) => browserErrors.push({ source: 'pageerror', text: redact(error.message) }))
      page.on('requestfailed', (request) => browserErrors.push({ source: 'requestfailed', url: safeUrl(request.url()), text: redact(request.failure()?.errorText || 'request failed') }))

      const loginResult = await login(page, user)
      if (!loginResult.ok) {
        results.push({ profile: role, userKey, login: loginResult, routes: [] })
        await page.close()
        if (context) await context.close()
        continue
      }

      if (role === 'gestor') {
        const fundId = userKey === 'gestor_b' ? perf9aFundIds.fundB : perf9aFundIds.fundA
        await page.setCookie({
          name: 'bw_fundo_ativo_id',
          value: fundId,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        })
      }

      const routeResults = []
      for (const path of paths) {
        const beforeErrors = browserErrors.length
        const started = Date.now()
        let response = null
        let navigationError = null
        try {
          response = await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle2', timeout: 45_000 })
        } catch (error) {
          navigationError = safeError(error)
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
        const snapshot = await readPageSnapshot(page)
        routeResults.push({
          profile: role,
          userKey,
          path,
          requestedUrl: `${BASE_URL}${path}`,
          finalUrl: safeUrl(page.url()),
          httpStatus: response?.status() ?? null,
          navigationError,
          render: snapshot.render,
          title: snapshot.title,
          metrics: snapshot.metrics,
          requests: snapshot.requests,
          bytes: snapshot.bytes,
          browserErrors: browserErrors.slice(beforeErrors),
          elapsedMs: Date.now() - started,
        })
      }
      results.push({ profile: role, userKey, login: loginResult, routes: routeResults })
      await page.close()
      if (context) await context.close()
    }
  } finally {
    await browser.close()
  }

  const evidencePath = resolve(getPerf9aLocalDir('evidence'), `smoke-escopo9a2-${env.projectRef}-${new Date().toISOString().replaceAll(':', '-')}.json`)
  writeRestrictedJson(evidencePath, {
    scope: '9A.2',
    gate: 'smoke-browser',
    projectRef: env.projectRef,
    baseUrl: BASE_URL,
    startedAt,
    finishedAt: new Date().toISOString(),
    routeCount: results.reduce((total, profile) => total + profile.routes.length, 0),
    results,
  })
  console.log(`Smoke autenticado concluido. Evidencia local restrita: ${evidencePath}`)
}

async function loadPerf9aFundIds(admin) {
  const { data, error } = await admin
    .from('fundos')
    .select('id,nome')
    .in('nome', ['PERF9A_FUNDO A', 'PERF9A_FUNDO B'])
  if (error) throw new Error(`Falha ao resolver fundos PERF9A para o smoke: ${error.message}`)
  const fundA = data?.find((fund) => fund.nome === 'PERF9A_FUNDO A')
  const fundB = data?.find((fund) => fund.nome === 'PERF9A_FUNDO B')
  if (!fundA || !fundB) throw new Error('Fundos PERF9A A/B ausentes para o smoke.')
  return { fundA: fundA.id, fundB: fundB.id }
}

async function login(page, user) {
  const errors = []
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 45_000 })
    await page.type('#email', user.email)
    await page.type('#password', user.password)
    await Promise.all([
      page.waitForFunction(() => !window.location.pathname.endsWith('/login'), { timeout: 45_000 }),
      page.click('button[type="submit"]'),
    ])
    const pathname = new URL(page.url()).pathname
    if (pathname === '/mfa/desafio') {
      await page.waitForSelector('input[name="code"]', { timeout: 45_000 })
      const code = generateTotp(user.totpSecret)
      await page.type('input[name="code"]', code)
      await Promise.all([
        page.waitForFunction(() => !window.location.pathname.endsWith('/mfa/desafio'), { timeout: 45_000 }),
        page.click('form button[type="submit"]'),
      ])
    }
    const finalPath = new URL(page.url()).pathname
    if (finalPath === '/mfa/setup') return { ok: false, finalPath, error: 'usuario redirecionado para configuracao MFA' }
    if (finalPath === '/login' || finalPath === '/mfa/desafio') return { ok: false, finalPath, error: 'login nao concluiu' }
    return { ok: true, finalPath }
  } catch (error) {
    errors.push(safeError(error))
    return { ok: false, finalPath: safeUrl(page.url()), error: errors[0] }
  }
}

async function readPageSnapshot(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || ''
    const nav = performance.getEntriesByType('navigation')[0]
    const resources = performance.getEntriesByType('resource')
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint')
    const hasFailureText = /This page could not be found|Application error|Internal Server Error|500\s*[-:]|404\s*[-:]/i.test(text)
    return {
      render: hasFailureText ? 'falha' : 'sucesso',
      title: document.title,
      metrics: nav ? {
        ttfbMs: Math.round(nav.responseStart),
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadMs: Math.round(nav.loadEventEnd),
        lcpMs: lcpEntries.length ? Math.round(lcpEntries.at(-1).startTime) : null,
      } : null,
      requests: resources.length + 1,
      bytes: resources.reduce((total, entry) => total + (entry.transferSize || 0), 0),
    }
  })
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

function redact(value) {
  return String(value)
    .replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>')
    .replace(/(password|senha|token|secret|code|otp)[^\s:=]*[\s:=]+[^\s]+/gi, '$1=<redigido>')
}

function safeError(error) {
  return redact(error instanceof Error ? error.message : String(error))
}
