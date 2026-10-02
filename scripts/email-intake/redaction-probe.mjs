import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { inspectEmailResponses } from './browser-redaction.mjs'

// Each case owns a fresh page. Bodies are synthetic and inspected only in memory.
const timers = new Set()
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://qa.invalid')
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return }
  if (url.pathname === '/api/stream') {
    const delay = Number(url.searchParams.get('delay'))
    res.writeHead(200, { 'content-type': 'text/x-component' }); res.write('0:{"safe":"first"}\n')
    const timer = setTimeout(() => { res.end('1:{"safe":"last"}\n'); timers.delete(timer) }, delay)
    timers.add(timer)
  } else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<main>synthetic response inspection probe</main>') }
})
await mkdir('rehearsal/reports', { recursive: true })
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`
const file = 'rehearsal/reports/email05-r3-redaction-probe.json'
const cases = [], negativeControls = []
let browser, failure
async function runCase(name, action, delay, expectedFailure = false) {
  const page = await browser.newPage(), temporary = `rehearsal/reports/email05-r7-${name}.json`
  const inspection = await inspectEmailResponses(page, { file: temporary, phase: () => name })
  let closed = false, error, drainFailure = false
  try {
    await inspection.beforeNavigation(() => page.goto(origin))
    await page.evaluate(delay => {
      window.probeRequest = new XMLHttpRequest()
      window.probeRequest.open('GET', '/api/stream?delay=' + delay)
      window.probeRequest.onload = () => { window.probeReceived = window.probeRequest.responseText.includes('last') }
      window.probeRequest.send()
    }, delay)
    if (delay > 0) {
      const started = Date.now()
      while (!inspection.snapshot().states.some(row => row.state === 'BODY_READING')) {
        assert.ok(Date.now() - started < 5000, 'PROBE_RESPONSE_PAUSE_MISSING')
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    }
    // Explicit route-cleanup cancellation makes the adversarial control deterministic.
    const cancelAndNavigate = async () => { await page.evaluate(() => window.probeRequest.abort()); return page.goto(origin + '/next') }
    if (action === 'external-abort') await page.evaluate(() => window.probeRequest.abort())
    else if (action === 'unsafe-navigation') await cancelAndNavigate()
    else if (action === 'navigation') await inspection.beforeNavigation(cancelAndNavigate)
    else if (action === 'reload') await inspection.beforeNavigation(() => page.reload())
    else if (action === 'close') { await inspection.beforeNavigation(() => page.close()); closed = true }
    else await page.waitForFunction(() => window.probeReceived === true, { timeout: 5000 })
    try { await inspection.awaitDrain() } catch (caught) { drainFailure = true; if (!expectedFailure) throw caught }
    if (expectedFailure) assert.equal(drainFailure, true, 'NEGATIVE_CONTROL_DID_NOT_FAIL')
    else {
      const counts = inspection.snapshot()
      assert.equal(counts.mustInspect, counts.inspected); assert.equal(counts.mustInspect, counts.intercepted)
      assert.equal(counts.pending, 0); assert.equal(counts.failed, 0)
    }
  } catch (caught) { error = caught }
  finally {
    // Known negative controls may still have the bounded CDP read in flight.
    await inspection.flush(); await inspection.save()
    const evidence = JSON.parse(await readFile(temporary, 'utf8'))
    const row = { name, action, delay, expectedFailure, result: error ? 'FAIL' : 'PASS', ...evidence }
    if (expectedFailure) negativeControls.push(row); else cases.push(row)
    try {
      if (!closed) {
        try { await inspection.awaitDrain({ timeoutMs: 2000 }) }
        catch (caught) { if (!expectedFailure) error ??= caught }
        finally { await page.close() }
      }
    } finally { await unlink(temporary) }
  }
  if (error) throw error
}
try {
  browser = await puppeteer.launch({ executablePath: process.env.EMAIL_INTAKE_QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--no-first-run', '--disable-dev-shm-usage'] })
  await runCase('normal', 'complete', 0)
  await runCase('chunked', 'complete', 50)
  await runCase('delayed', 'complete', 600)
  await runCase('navigation', 'navigation', 600)
  await runCase('reload', 'reload', 600)
  await runCase('close', 'close', 600)
  await runCase('external-abort', 'external-abort', 600, true)
  await runCase('without-barrier', 'unsafe-navigation', 600, true)
  for (let index = 0; index < 20; index++) await runCase(`stress-${index + 1}`, ['navigation', 'reload', 'close'][index % 3], [0, 50, 200, 600, 1000][index % 5])
} catch (error) { failure = error }
finally {
  try { await browser?.close() }
  finally { for (const timer of timers) clearTimeout(timer); server.closeAllConnections(); server.close(); await once(server, 'close') }
  const summary = cases.reduce((total, row) => {
    for (const key of ['mustInspect', 'intercepted', 'inspected', 'uninspected', 'pending', 'failed']) total[key] += row.summary[key]
    return total
  }, { mustInspect: 0, intercepted: 0, inspected: 0, uninspected: 0, pending: 0, failed: 0 })
  const result = { result: failure ? 'FAIL' : 'PASS', summary, rows: cases.flatMap(row => row.rows), cases, negativeControls,
    stressIterations: cases.filter(row => row.name.startsWith('stress-')).length,
    failureClass: failure ? (/^[A-Z0-9_]+$/.test(failure.message) ? failure.message : failure.name) : null }
  await writeFile(file, JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ result: result.result, summary, stressIterations: result.stressIterations, negativeControls: negativeControls.map(({ name, result, summary }) => ({ name, result, summary })), failureClass: result.failureClass }))
}
if (failure) process.exitCode = 1
