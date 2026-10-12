import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { inspectEmailResponses } from './browser-redaction.mjs'

const timers = new Set(), cases = []
const later = (action, ms) => { const id = setTimeout(() => { timers.delete(id); action() }, ms); timers.add(id) }
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://qa.invalid')
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return }
  if (url.pathname !== '/api/probe') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<main>bodyless protocol probe</main>'); return }
  const mode = url.searchParams.get('mode'), status = Number(url.searchParams.get('status') ?? 200)
  const send = () => {
    res.writeHead(status, { 'content-type': mode === 'rsc' ? 'text/x-component' : 'application/json',
      ...(mode === 'secret' ? { 'x-client-secret': 'SYNTHETIC_HEADER_SENTINEL' } : {}) })
    if (req.method === 'HEAD' || [204, 304].includes(status)) res.end()
    else { res.write('{"safe":'); later(() => res.end('true}'), Number(url.searchParams.get('delay') ?? 50)) }
  }
  if (mode === 'early') later(send, 500); else send()
})
await mkdir('rehearsal/reports', { recursive: true })
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`
let browser, failure
async function run(name, { method = 'HEAD', mode = 'normal', status = 200, abort = false, negative = false, delay = 50 } = {}) {
  const page = await browser.newPage(), file = `rehearsal/reports/email05-r8-probe-${name}.json`
  const inspection = await inspectEmailResponses(page, { file, phase: () => name })
  let error, rejected = false
  try {
    await inspection.beforeNavigation(() => page.goto(origin))
    await page.evaluate(({ method, mode, status, abort, delay }) => {
      const controller = new AbortController()
      void fetch(`/api/probe?mode=${mode}&status=${status}&delay=${delay}`, { method, signal: controller.signal }).then(async response => {
        if (abort && method === 'HEAD' && mode !== 'early') controller.abort()
        else await response.text()
      }).catch(() => {}).finally(() => { window.probeDone = true })
      if (mode === 'early' || (abort && method !== 'HEAD')) setTimeout(() => controller.abort(), 30)
    }, { method, mode, status, abort, delay })
    await page.waitForFunction(() => window.probeDone, { timeout: 5000 })
    try { await inspection.assertClean() } catch (caught) { rejected = true; if (!negative) throw caught }
    assert.equal(rejected, negative, 'EXPECTED_REDACTION_RESULT')
    await inspection.save()
    const evidence = JSON.parse(await readFile(file, 'utf8'))
    if (abort && !negative) assert.ok(evidence.aborted.some(row => row.classification === 'CANCELLED_AFTER_TERMINAL_NO_BODY'), 'AFTER_TERMINAL_CANCEL_NOT_OBSERVED')
    if (mode === 'secret') assert.ok(evidence.rows.some(row => row.matchedSecretClasses.includes('CLIENT_SECRET')), 'HEADER_SECRET_NOT_DETECTED')
    if (!negative) { assert.equal(evidence.summary.unexpectedCancels, 0); assert.equal(evidence.summary.noBody, evidence.summary.noBodyTerminal) }
  } catch (caught) { error = caught }
  finally {
    await inspection.flush(); await inspection.save()
    const evidence = JSON.parse(await readFile(file, 'utf8'))
    cases.push({ name, negative, rejected, result: error ? 'FAIL' : 'PASS', ...evidence })
    try { if (!negative) await inspection.awaitDrain({ timeoutMs: 2000 }) } catch (caught) { error ??= caught }
    finally { await page.close(); await unlink(file) }
  }
  if (error) throw error
}
try {
  browser = await puppeteer.launch({ executablePath: process.env.EMAIL_INTAKE_QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run', '--disable-dev-shm-usage'] })
  await run('head-normal')
  await run('head-abort-after', { abort: true })
  await run('head-abort-before', { mode: 'early', abort: true, negative: true })
  await run('get-abort', { method: 'GET', abort: true, delay: 600, negative: true })
  await run('rsc-abort', { method: 'GET', mode: 'rsc', abort: true, delay: 600, negative: true })
  await run('no-content', { method: 'GET', status: 204 })
  await run('not-modified', { method: 'GET', status: 304 })
  await run('header-secret', { mode: 'secret', negative: true })
  for (let i = 0; i < 20; i++) await run(`stress-${i + 1}`, [ {}, { abort: true }, { method: 'GET', delay: [0, 30, 60][i % 3] }, { method: 'GET', mode: 'rsc', delay: 40 } ][i % 4])
} catch (error) { failure = error }
finally {
  try { await browser?.close() } finally { for (const timer of timers) clearTimeout(timer); server.closeAllConnections(); server.close(); await once(server, 'close') }
  const result = { result: failure ? 'FAIL' : 'PASS', failureClass: failure ? (/^[A-Z_]+$/.test(failure.message) ? failure.message : failure.name) : null,
    stressIterations: cases.filter(row => row.name.startsWith('stress-')).length, cases }
  await writeFile('rehearsal/reports/email05-r8-no-body-probe.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ result: result.result, failureClass: result.failureClass, stressIterations: result.stressIterations, cases: cases.map(({ name, result, summary }) => ({ name, result, summary })) }))
}
if (failure) process.exitCode = 1
