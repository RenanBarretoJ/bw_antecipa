import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyChromeReadiness } from './r1-19-chrome-readiness.mjs'

function fake({ value = 2, url = 'about:blank', closeError = false } = {}) {
  let calls = 0, closed = 0
  const launch = async options => {
    calls++
    assert.deepEqual(options, { executablePath: '/test/chrome', headless: true, timeout: 30000 })
    return { newPage: async () => ({ evaluate: async () => value, url: () => url }), version: async () => 'synthetic', close: async () => { closed++; if (closeError) throw new Error('CLOSE_FAILED') } }
  }
  return { launch, counts: () => ({ calls, closed }) }
}
test('ready browser is closed, without PDF, retries or disabled sandbox', async () => {
  const f = fake(), result = await verifyChromeReadiness('/test/chrome', f.launch)
  assert.equal(result.result, 'PASS'); assert.equal(result.pdfRendered, false); assert.equal(result.retries, 0)
  assert.deepEqual(f.counts(), { calls: 1, closed: 1 })
})
test('launch failure propagates without retry', async () => {
  let calls = 0
  await assert.rejects(verifyChromeReadiness('/test/chrome', async () => { calls++; throw new Error('LAUNCH_FAILED') }), /LAUNCH_FAILED/)
  assert.equal(calls, 1)
})
for (const options of [{ value: 0 }, { url: 'https://not-local.invalid' }, { closeError: true }]) {
  test('readiness or cleanup failure is not accepted: ' + JSON.stringify(options), async () => {
    const f = fake(options)
    await assert.rejects(verifyChromeReadiness('/test/chrome', f.launch))
    assert.deepEqual(f.counts(), { calls: 1, closed: 1 })
  })
}
test('missing executable fails before browser launch', async () => {
  const f = fake()
  await assert.rejects(verifyChromeReadiness('', f.launch), /CHROME_EXECUTABLE_REQUIRED/)
  assert.equal(f.counts().calls, 0)
})
