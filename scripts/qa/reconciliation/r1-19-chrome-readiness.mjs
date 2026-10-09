import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'

// Infrastructure readiness only: no PDF rendering, no retry, no reused browser/profile.
// The application runtime, sandbox defaults and 30s PDF assertions remain unchanged.
export async function verifyChromeReadiness(executablePath, launch = options => puppeteer.launch(options)) {
  assert(executablePath, 'CHROME_EXECUTABLE_REQUIRED')
  const started = performance.now()
  const browser = await launch({ executablePath, headless: true, timeout: 30_000 })
  const launched = performance.now()
  try {
    const page = await browser.newPage()
    assert.equal(await page.evaluate(() => 1 + 1), 2, 'CHROME_EVALUATION_FAILED')
    assert.equal(page.url(), 'about:blank', 'CHROME_NONLOCAL_PAGE')
    return { result: 'PASS', launchMs: launched - started, readinessMs: performance.now() - started, version: await browser.version(), pdfRendered: false, retries: 0 }
  } finally {
    await browser.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.deepEqual(process.argv.slice(2), ['--ci-only'])
  assert.equal(process.platform, 'linux', 'LINUX_RUNNER_REQUIRED')
  assert.equal(process.env.CI, 'true', 'EXPLICIT_CI_REQUIRED')
  const evidence = { at: new Date().toISOString(), result: 'FAIL', node: process.version }
  try {
    Object.assign(evidence, await verifyChromeReadiness(process.env.CHROME_PATH))
  } finally {
    await mkdir('rehearsal/reports', { recursive: true })
    await writeFile('rehearsal/reports/R1_19_CHROME_READINESS.json', JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify(evidence))
  }
}
