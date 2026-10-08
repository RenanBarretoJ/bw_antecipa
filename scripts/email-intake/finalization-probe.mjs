import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'
import { boundedInspection } from './browser-semantic.mjs'
import { inspectEmailResponses } from './browser-redaction.mjs'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const root = 'rehearsal/reports', report = { result: 'IN_PROGRESS', cases: [] }
await mkdir(root, { recursive: true })
const object = 'notas-fiscais/reservation/generation/original.pdf'
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return }
  if (request.url === '/detail') {
    const now = Math.floor(Date.now() / 1000)
    const url = 'https://preview-ref.supabase.co/storage/v1/object/sign/' + object + '?token='
      + encode({ alg: 'HS512', kid: 'synthetic-key' }) + '.' + encode({ url: object, scope: 'download', iat: now, exp: now + 600 }) + '.syntheticSignature'
    response.writeHead(200, { 'content-type': 'text/x-component' }); response.end('1:' + JSON.stringify({ success: true, url })); return
  }
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end(`<main>Review complete</main><script>
    window.beginDetail = async () => {
      history.pushState({}, '', '/detail');
      await (await fetch('/detail', {method:'POST'})).text();
      document.querySelector('main').dataset.detailReady = 'true';
    };
  </script>`)
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.EMAIL_INTAKE_QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--no-first-run', '--disable-dev-shm-usage'] })
  for (let iteration = 0; iteration < 20; iteration++) {
    const context = await browser.createBrowserContext(), page = await context.newPage()
    const gate = deferred(), started = deferred(), file = `${root}/email05-r10-finalization-case-${iteration}.json`
    const inspection = await inspectEmailResponses(page, { file, signedUrlPolicy: {
      appOrigin: origin, storageOrigin: 'https://preview-ref.supabase.co', allowedBuckets: ['notas-fiscais'], maxTtlSeconds: 600,
      authorize: async () => { started.resolve(); await gate.promise; return { actorAuthenticated: true, authorized: true, scopeMatches: true, crossFundDenied: true } },
      verifySignature: async () => true,
    } })
    let closed = false
    try {
      await page.goto(origin + '/review', { waitUntil: 'load' })
      inspection.expectReadiness(() => page.waitForFunction(() => location.pathname === '/detail'
        && document.querySelector('main')?.dataset.detailReady === 'true', { timeout: 20000 }))
      const finished = inspection.closeAfterDrain(async () => { closed = true; await context.close() })
      // Capture rejection while controlled gates drive the pending completion.
      void finished.catch(() => {})
      if (iteration % 2 === 0) gate.resolve()
      await page.evaluate(() => { void window.beginDetail() })
      await boundedInspection(started.promise, 20000, 'SEMANTIC_START_TIMEOUT')
      assert.equal(closed, false)
      gate.resolve()
      const counts = await finished
      assert.equal(counts.pending + counts.semanticPending + counts.semanticFailed + counts.unexpectedCancels, 0)
      assert.equal(counts.mustInspect, counts.inspected)
      assert.equal(counts.semanticRequired, counts.semanticComplete)
      const evidence = JSON.parse(await readFile(file, 'utf8'))
      assert.ok(evidence.rows.some(row => row.signedUrls?.some(url => url.classification === 'EXPECTED_EPHEMERAL_SIGNED_URL')))
      report.cases.push({ iteration, delayed: iteration % 2 === 1, result: 'PASS', counts })
    } finally { gate.resolve(); if (!closed) await inspection.closeAfterDrain(() => context.close()) }
  }
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.errorClass = error.code ?? error.name; process.exitCode = 1 }
finally {
  await browser?.close(); server.closeAllConnections(); server.close(); await once(server, 'close')
  await writeFile(`${root}/email05-r10-finalization-probe.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ result: report.result, iterations: report.cases.length }))
}
