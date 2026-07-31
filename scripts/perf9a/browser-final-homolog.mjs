#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { generateTotp } from './dataset.mjs'
import { assertHomologEnvironment, createAdminClient, getPerf9aLocalDir, loadEnvFile, writeRestrictedJson } from './common.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith('--') ? [value.slice(2), all[index + 1]?.startsWith('--') ? true : all[index + 1]] : null).filter(Boolean))
const baseUrl = String(args['base-url'] || 'http://localhost:3002').replace(/\/$/, '')
const routes = {
  gestor: ['/gestor/onboarding-cedentes', '/gestor/notas-fiscais', '/gestor/cedentes', '/gestor/dashboard', '/gestor/relatorios', '/gestor/auditoria'],
  cedente: ['/cedente/notas-fiscais', '/cedente/operacoes/nova'],
  consultor: ['/consultor/dashboard', '/consultor/relatorios'],
  sacado: ['/sacado/dashboard'],
}
const offsetCases = [
  ['gestor', '/gestor/cedentes', 'page', 'pageSize'], ['gestor', '/gestor/onboarding-cedentes', 'page', 'pageSize'],
  ['gestor', '/gestor/notas-fiscais', 'page', 'pageSize'], ['gestor', '/gestor/documentos', 'page', 'pageSize'],
  ['gestor', '/gestor/operacoes', 'page', 'pageSize'], ['cedente', '/cedente/notas-fiscais', 'pagina', 'limite'],
  ['consultor', '/consultor/operacoes', 'page', 'pageSize'], ['gestor', '/gestor/relatorios', 'page', 'pageSize'],
  ['consultor', '/consultor/relatorios', 'page', 'pageSize'],
]

await main().catch((error) => { console.error(`Navegador final 9A.3 falhou: ${redact(error instanceof Error ? error.message : String(error))}`); process.exitCode = 1 })

async function main() {
  loadEnvFile('.env.homolog')
  const env = assertHomologEnvironment()
  const admin = createAdminClient(env)
  const credentials = JSON.parse(readFileSync(resolve(getPerf9aLocalDir('credentials'), `users-${env.projectRef}.json`), 'utf8'))
  const users = new Map(credentials.users.map((user) => [user.key, user]))
  const fund = await one(admin.from('fundos').select('id').eq('nome', 'PERF9A_FUNDO A').single(), 'fundo PERF9A A')
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const metrics = []
  const pagination = []
  try {
    const sessions = new Map()
    for (const role of Object.keys(routes)) {
      const context = await browser.createBrowserContext()
      const page = await context.newPage()
      await login(page, users.get(`${role}_a`))
      if (role === 'gestor') await page.setCookie({ name: 'bw_fundo_ativo_id', value: fund.id, url: baseUrl, httpOnly: true, sameSite: 'Lax' })
      sessions.set(role, { context, page })
    }

    for (const [role, paths] of Object.entries(routes)) {
      const page = sessions.get(role).page
      const cdp = await page.createCDPSession()
      for (const path of paths) {
        for (let repetition = 1; repetition <= 3; repetition += 1) {
          await cdp.send('Network.clearBrowserCache')
          metrics.push(await navigateAndMeasure(page, role, path, 'fria', repetition))
          metrics.push(await navigateAndMeasure(page, role, path, 'aquecida', repetition, true))
        }
      }
    }

    for (const [role, path, pageParam, sizeParam] of offsetCases) {
      const page = sessions.get(role).page
      const cases = []
      for (const size of [10, 20, 40]) {
        const first = await inspectList(page, path, pageParam, sizeParam, 1, size)
        const second = await inspectList(page, path, pageParam, sizeParam, 2, size)
        cases.push({ size, first, second, overlap: intersection(first.ids, second.ids), status: first.render === 'sucesso' && second.render === 'sucesso' && intersection(first.ids, second.ids).length === 0 ? 'APROVADO' : 'INCONCLUSIVO' })
      }
      const invalid = await inspectList(page, path, pageParam, sizeParam, 999999, 10)
      pagination.push({ role, path, cases, invalid, status: cases.every((item) => item.status === 'APROVADO') && invalid.render === 'sucesso' ? 'APROVADO_NOS_CASOS_AUTOMATIZADOS' : 'INCONCLUSIVO' })
    }

    for (const { context } of sessions.values()) await context.close()
  } finally {
    await browser.close()
  }
  const summarized = summarize(metrics)
  const evidencePath = resolve(getPerf9aLocalDir('evidence'), `browser-final-escopo9a3-${env.projectRef}-${stamp()}.json`)
  writeRestrictedJson(evidencePath, { scope: '9A.3', gate: 'browser-final', baseUrl, executedAt: new Date().toISOString(), metrics, summary: summarized, pagination })
  console.log(`Navegador final concluido. Rotas: ${summarized.length}; paginações: ${pagination.length}.`)
  console.log(`Evidência local restrita: ${evidencePath}`)
}

async function login(page, user) {
  if (!user) throw new Error('Credencial PERF9A ausente.')
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle2', timeout: 45_000 })
  await page.type('#email', user.email); await page.type('#password', user.password)
  await Promise.all([page.waitForFunction(() => !location.pathname.endsWith('/login'), { timeout: 45_000 }), page.click('button[type="submit"]')])
  if (new URL(page.url()).pathname === '/mfa/desafio') {
    await page.waitForSelector('input[name="code"]', { timeout: 45_000 })
    await page.type('input[name="code"]', generateTotp(user.totpSecret))
    await Promise.all([page.waitForFunction(() => !location.pathname.endsWith('/mfa/desafio'), { timeout: 45_000 }), page.click('form button[type="submit"]')])
  }
  if (/\/login|\/mfa\//.test(new URL(page.url()).pathname)) throw new Error(`Login não concluído para ${user.key}.`)
}

async function navigateAndMeasure(page, role, path, cache, repetition, reload = false) {
  const errors = []
  const failed = []
  const onConsole = (message) => { if (message.type() === 'error') errors.push(redact(message.text())) }
  const onFailed = (request) => failed.push({ url: strip(request.url()), error: redact(request.failure()?.errorText || 'failed') })
  page.on('console', onConsole); page.on('requestfailed', onFailed)
  const started = performance.now()
  let response
  try {
    response = reload ? await page.reload({ waitUntil: 'networkidle2', timeout: 45_000 }) : await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle2', timeout: 45_000 })
    await new Promise((done) => setTimeout(done, 250))
  } finally {
    page.off('console', onConsole); page.off('requestfailed', onFailed)
  }
  const snapshot = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const resources = performance.getEntriesByType('resource')
    const text = document.body?.innerText || ''
    return { ttfbMs: nav ? Math.round(nav.responseStart) : null, domMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null, loadMs: nav ? Math.round(nav.loadEventEnd) : null, requests: resources.length + 1, bytes: resources.reduce((sum, item) => sum + (item.transferSize || 0), 0), render: /This page could not be found|Application error|Internal Server Error/i.test(text) ? 'falha' : 'sucesso' }
  })
  return { role, path, cache, repetition, httpStatus: response?.status() ?? null, totalMs: Math.round(performance.now() - started), ...snapshot, failedRequests: failed, consoleErrors: errors }
}

async function inspectList(page, path, pageParam, sizeParam, pageNumber, size) {
  const url = new URL(`${baseUrl}${path}`); url.searchParams.set(pageParam, String(pageNumber)); url.searchParams.set(sizeParam, String(size))
  const response = await page.goto(url.toString(), { waitUntil: 'networkidle2', timeout: 45_000 })
  const result = await page.evaluate(() => {
    const text = document.body?.innerText || ''
    const ids = [...document.querySelectorAll('a[href]')].map((node) => node.getAttribute('href')).filter((href) => href && /\/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(href))
    return { ids: [...new Set(ids)], textMarker: text.match(/Página\s+\d+\s+de\s+\d+[^\n]*/i)?.[0] || null, render: /Application error|Internal Server Error/i.test(text) ? 'falha' : 'sucesso', finalPath: location.pathname + location.search }
  })
  return { httpStatus: response?.status() ?? null, ...result }
}

function summarize(rows) {
  const groups = new Map()
  for (const row of rows) { const key = `${row.role}:${row.path}:${row.cache}`; const current = groups.get(key) || []; current.push(row); groups.set(key, current) }
  return [...groups.entries()].map(([key, values]) => ({ key, repetitions: values.length, medianTtfbMs: median(values.map((row) => row.ttfbMs)), maxTtfbMs: Math.max(...values.map((row) => row.ttfbMs || 0)), medianTotalMs: median(values.map((row) => row.totalMs)), maxTotalMs: Math.max(...values.map((row) => row.totalMs)), medianRequests: median(values.map((row) => row.requests)), medianBytes: median(values.map((row) => row.bytes)), errors: values.reduce((sum, row) => sum + row.consoleErrors.length + row.failedRequests.length, 0) }))
}
function median(values) { const ordered = values.filter(Number.isFinite).sort((a, b) => a - b); return ordered.length ? ordered[Math.floor(ordered.length / 2)] : null }
function intersection(a, b) { const right = new Set(b); return a.filter((item) => right.has(item)) }
async function one(query, label) { const { data, error } = await query; if (error || !data) throw new Error(`Falha ao carregar ${label}: ${error?.message || 'sem retorno'}`); return data }
function strip(value) { try { const url = new URL(value); url.search = ''; url.hash = ''; return url.toString() } catch { return '<url-redigida>' } }
function redact(value) { return String(value).replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>').replace(/(token|password|senha|secret|otp|code)\s*[:=]\s*\S+/gi, '$1=<redigido>') }
function stamp() { return new Date().toISOString().replaceAll(':', '-') }
