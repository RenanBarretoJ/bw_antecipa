import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { inspectEmailResponses } from './browser-redaction.mjs'

// A consumer that cancels a Flight-like stream must not make its delivered data uninspectable.
const server = createServer((req, res) => {
  // This synthetic page has no favicon. Do not return the HTML fallback to Chrome's icon loader.
  if (req.url === '/favicon.ico') {
    res.writeHead(204); res.end()
  } else if (req.url === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/x-component' })
    res.write('0:{"safe":"first"}\n')
    setTimeout(() => res.end('1:{"safe":"last"}\n'), 50)
  } else {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<main>synthetic response inspection probe</main>')
  }
})
await mkdir('rehearsal/reports', { recursive: true })
server.listen(0, '127.0.0.1'); await once(server, 'listening')
let browser, inspection
try {
  browser = await puppeteer.launch({ executablePath: process.env.EMAIL_INTAKE_QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--no-first-run', '--disable-dev-shm-usage'] })
  const page = await browser.newPage()
  inspection = await inspectEmailResponses(page, { file: 'rehearsal/reports/email05-r3-redaction-probe.json' })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.evaluate(async () => {
    const result = await fetch('/api/stream', { method: 'POST' })
    const reader = result.body.getReader(); await reader.read(); await reader.cancel()
  })
  await page.waitForNetworkIdle({ timeout: 15000 })
  const result = await inspection.assertClean()
  assert.equal(result.mustInspect, 2)
  assert.equal(result.intercepted, 2)
  assert.equal(result.inspected, 2)
  assert.equal(result.uninspected, 0)
  console.log(JSON.stringify({ result: 'PASS', ...result }))
} finally {
  try { await inspection?.flush(); await inspection?.save() }
  finally { await browser?.close(); server.close(); await once(server, 'close') }
}
