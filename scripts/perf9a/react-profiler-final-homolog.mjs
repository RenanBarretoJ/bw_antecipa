#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { generateTotp } from './dataset.mjs'
import { assertHomologEnvironment, getPerf9aLocalDir, loadEnvFile, writeRestrictedJson } from './common.mjs'

const baseUrl = String(process.argv.find((value) => value.startsWith('--base-url='))?.split('=')[1] || 'http://localhost:3001').replace(/\/$/, '')
const routes = {
  gestor: ['/gestor/dashboard', '/gestor/onboarding-cedentes', '/gestor/notificacoes', '/gestor/relatorios', '/gestor/escrow', '/gestor/notas-fiscais'],
  cedente: ['/cedente/operacoes/nova'],
  consultor: ['/consultor/dashboard'],
}

await main().catch((error) => { console.error(`Profiler 9A.3 falhou: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })

async function main() {
  loadEnvFile('.env.homolog'); const env = assertHomologEnvironment()
  const credentials = JSON.parse(readFileSync(resolve(getPerf9aLocalDir('credentials'), `users-${env.projectRef}.json`), 'utf8'))
  const users = new Map(credentials.users.map((user) => [user.key, user]))
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox'] })
  const results = []
  try {
    for (const [role, paths] of Object.entries(routes)) {
      const context = await browser.createBrowserContext(); const page = await context.newPage()
      await installHook(page); await login(page, users.get(`${role}_a`))
      for (const path of paths) {
        await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle2', timeout: 45_000 }); await new Promise((done) => setTimeout(done, 300))
        const commits = await page.evaluate(() => window.__PERF9A_COMMITS__ || [])
        results.push({ role, path, commits: commits.length, totalActualDurationMs: round(commits.reduce((sum, item) => sum + item.actualDuration, 0)), maxCommitMs: round(Math.max(0, ...commits.map((item) => item.actualDuration))), mostExpensive: commits.sort((a, b) => b.actualDuration - a.actualDuration)[0] || null })
      }
      await context.close()
    }
  } finally { await browser.close() }
  const status = results.every((row) => row.commits > 0) ? 'COLETADO' : 'PARCIAL_SEM_COMMITS_EM_ALGUMAS_ROTAS'
  const evidencePath = resolve(getPerf9aLocalDir('evidence'), `react-profiler-escopo9a3-${env.projectRef}-${stamp()}.json`)
  writeRestrictedJson(evidencePath, { scope: '9A.3', gate: 'react-profiler', baseUrl, executedAt: new Date().toISOString(), methodology: 'React DevTools global hook em build de desenvolvimento; duração actualDuration do Fiber raiz.', status, results })
  console.log(`React Profiler: ${status}. Evidência local restrita: ${evidencePath}`)
}

async function installHook(page) {
  await page.evaluateOnNewDocument(() => {
    window.__PERF9A_COMMITS__ = []
    let rendererId = 0
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(),
      inject(renderer) { rendererId += 1; this.renderers.set(rendererId, renderer); return rendererId },
      onCommitFiberRoot(id, root) {
        const fiber = root?.current
        window.__PERF9A_COMMITS__.push({ rendererId: id, actualDuration: Number(fiber?.actualDuration || 0), treeBaseDuration: Number(fiber?.treeBaseDuration || 0), component: fiber?.type?.displayName || fiber?.type?.name || 'Root', at: performance.now() })
      },
      onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, sub() { return () => {} },
    }
  })
}
async function login(page, user) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle2', timeout: 45_000 }); await page.type('#email', user.email); await page.type('#password', user.password)
  await Promise.all([page.waitForFunction(() => !location.pathname.endsWith('/login'), { timeout: 45_000 }), page.click('button[type="submit"]')])
  if (new URL(page.url()).pathname === '/mfa/desafio') { await page.waitForSelector('input[name="code"]', { timeout: 45_000 }); await page.type('input[name="code"]', generateTotp(user.totpSecret)); await Promise.all([page.waitForFunction(() => !location.pathname.endsWith('/mfa/desafio'), { timeout: 45_000 }), page.click('form button[type="submit"]')]) }
}
function round(value) { return Math.round(value * 100) / 100 }
function stamp() { return new Date().toISOString().replaceAll(':', '-') }
