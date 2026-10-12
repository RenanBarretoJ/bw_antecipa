import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

/** Diagnostic artifact only: never retain URLs, query strings, headers or payloads. */
export function diagnosticPath(raw) {
  try {
    const path = new URL(raw).pathname
    if (['/favicon.ico', '/better-with-logo.png'].includes(path)) return path
    if (path.startsWith('/storage/')) return '/storage/[redacted]'
    return path.split('/').map(part => /^[a-zA-Z][a-zA-Z-]{0,35}$/.test(part) ? part : part ? '[redacted]' : '').join('/')
  } catch { return '[invalid-path]' }
}

export function diagnosticError(text) {
  if (/Failed to fetch RSC payload/.test(text)) return 'RSC_FETCH_FAILED'
  if (/Minified React error #(\d+)/.test(text)) return `REACT_${/Minified React error #(\d+)/.exec(text)[1]}`
  if (/net::(ERR_[A-Z_]+)/.test(text)) return /net::(ERR_[A-Z_]+)/.exec(text)[1]
  if (/AbortError/.test(text)) return 'ABORT'
  return 'UNCLASSIFIED_ERROR'
}

export async function instrumentEmailBrowser(page, file) {
  const pending = new Map(), requests = [], events = [], checkpoints = [], nativePending = new Map(), nativeRequests = []
  let phase = 'INITIAL', writes = Promise.resolve()
  const record = request => ({ method: request.method(), pathname: diagnosticPath(request.url()),
    resourceType: request.resourceType(), startedAt: new Date().toISOString(), startedMs: performance.now(), phase, status: null })
  const snapshot = () => ({ phase, requests, events, checkpoints, nativeRequests,
    nativePending: [...nativePending.values()].map(({ startedMs, ...row }) => ({ ...row, durationMs: Math.round(performance.now() - startedMs) })),
    pending: [...pending.values()].map(({ startedMs, ...row }) => ({ ...row, durationMs: Math.round(performance.now() - startedMs) })) })
  const save = () => { const serialized = JSON.stringify(snapshot(), null, 2); writes = writes.then(() => writeFile(file, serialized)); return writes }
  page.on('request', request => pending.set(request, record(request)))
  page.on('response', response => { const row = pending.get(response.request()); if (row) row.status = response.status() })
  const finish = (request, outcome) => {
    const row = pending.get(request)
    if (!row) return
    pending.delete(request)
    const { startedMs, ...safe } = row
    requests.push({ ...safe, durationMs: Math.round(performance.now() - startedMs), outcome })
    if (requests.length > 5000) requests.shift()
  }
  page.on('requestfinished', request => finish(request, 'FINISHED'))
  page.on('requestfailed', request => { events.push({ kind: 'REQUEST_FAILED', phase, code: diagnosticError(request.failure()?.errorText ?? '') }); finish(request, 'FAILED') })
  page.on('console', async message => {
    if (message.type() !== 'error') return
    const event = { kind: 'CONSOLE_ERROR', phase, code: diagnosticError(message.text()), pathname: diagnosticPath(message.location().url ?? '') }
    events.push(event)
    const descriptions = await Promise.all(message.args().map(arg => arg.evaluate(value => value instanceof Error ? String(value.message) : '').catch(() => '')))
    event.code = diagnosticError([message.text(), ...descriptions].join(' '))
  })
  page.on('pageerror', () => events.push({ kind: 'PAGE_ERROR', phase }))
  await page.exposeFunction('__emailQaUnhandled', () => { events.push({ kind: 'UNHANDLED_REJECTION', phase }) })
  await page.evaluateOnNewDocument(() => { addEventListener('unhandledrejection', () => { void window.__emailQaUnhandled() }) })
  const cdp = await page.createCDPSession()
  await cdp.send('Network.enable')
  cdp.on('Network.requestWillBeSent', event => {
    nativePending.set(event.requestId, { method: event.request.method, pathname: diagnosticPath(event.request.url), resourceType: event.type,
      startedAt: new Date().toISOString(), startedMs: performance.now(), phase, status: null })
  })
  cdp.on('Network.responseReceived', event => { const row = nativePending.get(event.requestId); if (row) row.status = event.response.status })
  const nativeFinish = (event, outcome) => {
    const row = nativePending.get(event.requestId)
    if (!row) return
    nativePending.delete(event.requestId)
    const { startedMs, ...safe } = row
    nativeRequests.push({ ...safe, durationMs: Math.round(performance.now() - startedMs), outcome })
    if (nativeRequests.length > 5000) nativeRequests.shift()
  }
  cdp.on('Network.loadingFinished', event => nativeFinish(event, 'FINISHED'))
  cdp.on('Network.loadingFailed', event => nativeFinish(event, diagnosticError(event.errorText)))
  return {
    async phase(name) { phase = name; checkpoints.push({ phase, at: new Date().toISOString(), pending: pending.size }); await save() },
    async idle(name) {
      await this.phase(`${name}:NETWORK_IDLE`)
      const timer = setInterval(() => { void save() }, 5000)
      try { await page.waitForNetworkIdle({ idleTime: 500, timeout: 60000 }) }
      finally { clearInterval(timer); await save() }
    },
    async save() { await save() },
    async assertClean() {
      await save()
      assert.equal(events.filter(event => ['CONSOLE_ERROR', 'PAGE_ERROR', 'UNHANDLED_REJECTION'].includes(event.kind)).length, 0, 'BROWSER_CONSOLE_OR_REJECTION')
      assert.equal(events.filter(event => event.kind === 'REQUEST_FAILED' && event.code !== 'ERR_ABORTED').length, 0, 'UNEXPECTED_REQUEST_FAILURE')
      assert.equal(requests.filter(request => request.status >= 400).length, 0, 'BROWSER_HTTP_FAILURE')
      assert.equal([...nativePending.values()].filter(row => performance.now() - row.startedMs > 30000).length, 0, 'STALLED_BROWSER_REQUEST')
    },
  }
}
