import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { diagnosticPath } from './browser-diagnostics.mjs'
import { createProtocolTrace } from './browser-protocol.mjs'
import { createRedactionBarrier, terminalInspectionState } from './browser-drain.mjs'
import { bodylessResponse, inspectResponseHeaders, noBodyRequest, receiveNoBodyResponse, cancelNoBodyResponse } from './browser-no-body.mjs'

function sensitivePath(pathname) {
  return /^\/(?:api(?:\/|$)|rest\/v1(?:\/|$)|auth\/v1(?:\/|$)|(?:admin|gestor)\/integracoes-email(?:\/|$))/.test(pathname)
}

function staticResponse(pathname, method, contentType, resourceType) {
  if (!['GET', 'HEAD'].includes(method) || /[%\\]|(?:^|\/)\.{1,2}(?:\/|$)/.test(pathname)) return false
  const image = ['Image', 'Other'].includes(resourceType) && /^image\//.test(contentType)
  if (/^\/(?:favicon\.ico|icon\.png|apple-icon\.png|better-with-logo\.png)$/.test(pathname)) return image
  if (/^\/_next\/image(?:\/|$)/.test(pathname)) return image
  if (!pathname.startsWith('/_next/static/')) return false
  return image || (resourceType === 'Script' && /^(?:application|text)\/javascript$/.test(contentType))
    || (resourceType === 'Stylesheet' && contentType === 'text/css')
    || (resourceType === 'Font' && /^(?:font\/|application\/(?:font-woff|vnd\.ms-fontobject))/.test(contentType))
}

export function classifyResponse({ pathname, method, status, contentType = '', resourceType }) {
  if (bodylessResponse(method, status)) return 'NO_BODY_EXPECTED'
  if ([301, 302, 303, 307, 308].includes(status)) return 'REDIRECT'
  // Route names embedded in Next bundles are not application endpoints. Require all asset evidence.
  if (staticResponse(pathname, method, contentType, resourceType)) return 'STATIC_ASSET'
  if (sensitivePath(pathname)) return 'MUST_INSPECT_SECRET_SURFACE'
  if (method !== 'GET' || /text\/html|text\/x-component/.test(contentType)) return 'MUST_INSPECT_SECRET_SURFACE'
  // Unknown JSON and asset-looking dynamic endpoints remain fail-closed.
  return 'UNKNOWN'
}

export function inspectionError(error) {
  const message = String(error?.message ?? '')
  if (/redirect/i.test(message)) return 'BODY_UNAVAILABLE_REDIRECT'
  if (/abort|cancel/i.test(message)) return 'BODY_UNAVAILABLE_ABORTED'
  if (/navigat|target closed|session closed/i.test(message)) return 'BODY_UNAVAILABLE_NAVIGATION'
  if (/protocol|resource|preflight|interception/i.test(message)) return 'BODY_UNAVAILABLE_PROTOCOL'
  if (/timeout/i.test(message)) return 'BODY_INSPECTION_TIMEOUT'
  return 'BODY_UNAVAILABLE_UNKNOWN'
}

/** Returns classes only. Values and matched snippets never leave this function. */
export function secretClasses(body, known = []) {
  const text = String(body).replaceAll('\\"', '"'), found = new Set()
  for (const { value, kind } of known) if (value && value.length >= 8 && text.includes(value)) found.add(kind)
  const rules = [
    ['CLIENT_SECRET', /["'](?:client_secret|clientSecret)["']\s*:\s*["'][^"']+/i],
    ['ACCESS_TOKEN', /["']access_token["']\s*:\s*["'][^"']+/i],
    ['REFRESH_TOKEN', /["']refresh_token["']\s*:\s*["'][^"']+/i],
    ['BEARER', /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/i],
    ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|["']private_key["']\s*:\s*["'][^"']+/i],
    ['ENCRYPTED_SECRET', /identityCiphertext|secretCiphertext|secret_ciphertext|encrypted_client_secret/],
    ['INTERNAL_SECRET_REFERENCE', /(?:vault|secret|credential):\/\/[A-Za-z0-9/_-]+|["'](?:secret_ref|secretReference|credential_secret_ref)["']\s*:\s*["'][^"']+/i],
    ['JOB_SECRET', /["'](?:scheduler_secret|job_secret|EMAIL_INTAKE_JOB_SECRET)["']\s*[:=]\s*["'][^"']+/],
    ['SERVER_ENV_SECRET', /["'](?:SUPABASE_SERVICE_ROLE_KEY|PORTAL_FIDC_CREDENTIAL_KEYS_JSON|MICROSOFT_GRAPH_CLIENT_SECRET|OPENAI_API_KEY)["']\s*[:=]\s*["'][^"']+/],
    ['SIGNED_URL', /\/storage\/v1\/object\/sign\/|[?&](?:X-Amz-Signature|X-Goog-Signature)=/i],
  ]
  for (const [kind, pattern] of rules) if (pattern.test(text)) found.add(kind)
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    try { if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).role === 'service_role') found.add('SERVICE_ROLE_KEY') } catch { /* Not a JWT; no value is recorded. */ }
  }
  return [...found].sort()
}

/** Pause at the HTTP response boundary, inspect in memory, then deliver unchanged to the app.
 * This closes the CDP/navigation eviction race without replaying actions or skipping RSC bodies.
 */
export async function inspectEmailResponses(page, { file, knownSecrets = [], phase = () => 'BROWSER' }) {
  const cdp = await page.createCDPSession(), rows = [], aborted = [], pending = new Set(), requests = new Map(), byNetwork = new Map(), passive = new Map(), recordedPassive = new Set()
  const consoleMatches = [], failures = []
  const protocol = await createProtocolTrace(cdp)
  const registry = []
  const transition = (entry, state) => {
    if (!entry || (terminalInspectionState(entry.state) && entry.state !== 'COMPLETED')) return
    entry.state = state
    protocol.record('INSPECTION_STATE', null, null, { registryId: entry.id, state })
  }
  let serial = 0
  const safeMeta = request => ({ method: request.method, pathname: diagnosticPath(request.url) })
  cdp.on('Network.requestWillBeSent', event => {
    if (!/^https?:/.test(event.request.url)) return
    protocol.record('Network.requestWillBeSent', event.requestId, null, { ...safeMeta(event.request), resourceType: event.type })
    const headers = event.request.headers
    const entry = { id: registry.length + 1, ...safeMeta(event.request), state: 'DISCOVERED',
      noBody: noBodyRequest(event.request.method),
      required: sensitivePath(new URL(event.request.url).pathname) || ['Document', 'Fetch', 'XHR'].includes(event.type) }
    registry.push(entry)
    requests.set(event.requestId, { entry, ...safeMeta(event.request), sensitive: sensitivePath(new URL(event.request.url).pathname),
      initiatorClass: ['parser', 'script', 'preload', 'preflight', 'SignedExchange', 'other'].includes(event.initiator?.type) ? event.initiator.type : 'unknown',
      lifecycle: 'REQUESTED',
      intent: headers['Next-Router-Prefetch'] === '1' || headers['next-router-prefetch'] === '1' ? 'RSC_PREFETCH'
        : headers.RSC === '1' || headers.rsc === '1' ? 'RSC_NAVIGATION' : event.request.method === 'POST' ? 'ACTION' : event.type === 'Document' ? 'DOCUMENT' : 'RESOURCE',
      phase: phase(), resourceType: event.type })
  })
  cdp.on('Network.responseReceived', event => {
    const request = requests.get(event.requestId)
    if (!request) return
    protocol.record('Network.responseReceived', event.requestId, null, { status: event.response.status, resourceType: event.type })
    const contentType = (event.response.mimeType ?? '').toLowerCase()
    request.lifecycle = 'RESPONSE_RECEIVED'
    const classification = classifyResponse({ pathname: new URL(event.response.url).pathname, method: request.method,
      status: event.response.status, contentType, resourceType: event.type })
    request.entry.required = ['MUST_INSPECT_SECRET_SURFACE', 'NO_BODY_EXPECTED'].includes(classification)
    receiveNoBodyResponse(request.entry.noBody, event.response, text => secretClasses(text, knownSecrets))
    if (classification === 'NO_BODY_EXPECTED') {
      const evidence = request.entry.noBody
      protocol.record('HEADERS_INSPECTED', event.requestId, null, { ...evidence })
      transition(request.entry, evidence.sensitiveHeaderMatch ? 'SECRET_MATCH'
        : evidence.terminalState === 'NO_BODY_TERMINAL' ? 'NO_BODY_TERMINAL' : 'HEADERS_FAILED')
      if (evidence.terminalState === 'NO_BODY_TERMINAL') protocol.record('NO_BODY_TERMINAL', event.requestId, null)
      const row = byNetwork.get(event.requestId)
      if (row) row.noBody = evidence
    }
    if (request.entry.state === 'DISCOVERED') transition(request.entry, 'CLASSIFIED')
    passive.set(event.requestId, { method: request.method, pathname: request.pathname, status: event.response.status, contentType,
      resourceType: event.type, phase: request.phase, classification, size: null, matchedSecretClasses: [], bodyInspectionErrorClass: null,
      initiatorClass: request.initiatorClass, lifecycle: request.lifecycle, intercepted: false,
      ...(classification === 'NO_BODY_EXPECTED' ? { noBody: request.entry.noBody } : {}) })
  })
  const lifecycle = (id, state) => {
    for (const row of [requests.get(id), passive.get(id), byNetwork.get(id)]) if (row) row.lifecycle = state
  }
  cdp.on('Network.loadingFinished', event => {
    protocol.record('Network.loadingFinished', event.requestId); lifecycle(event.requestId, 'COMPLETED')
    const request = requests.get(event.requestId)
    if (request && !byNetwork.has(event.requestId)) transition(request.entry, 'COMPLETED')
  })
  cdp.on('Network.loadingFailed', event => {
    protocol.record('Network.loadingFailed', event.requestId, null, { errorClass: /ERR_ABORTED/.test(event.errorText) ? 'ERR_ABORTED' : 'NETWORK_FAILURE' })
    lifecycle(event.requestId, 'FAILED_OR_CANCELLED')
    const request = requests.get(event.requestId)
    if (!request) return
    const inspection = byNetwork.get(event.requestId)
    const afterInspection = inspection?.inspectionResult === 'PASS'
    const noBodyCancellation = cancelNoBodyResponse(request.entry.noBody)
    const afterNoBody = noBodyCancellation === 'CANCELLED_AFTER_TERMINAL_NO_BODY'
    transition(request.entry, afterInspection ? 'COMPLETED' : afterNoBody ? 'NO_BODY_TERMINAL' : 'CANCELLED_BEFORE_INSPECTION')
    aborted.push({ method: request.method, pathname: request.pathname, intent: request.intent, phase: request.phase,
      ...request.entry.noBody,
      classification: afterInspection ? 'CANCELLED_AFTER_INSPECTION' : noBodyCancellation,
      errorClass: /ERR_ABORTED/.test(event.errorText) ? 'ERR_ABORTED' : 'NETWORK_FAILURE' })
  })
  const inspect = async event => {
    const headers = Object.fromEntries((event.responseHeaders ?? []).map(header => [header.name.toLowerCase(), header.value]))
    const contentType = (headers['content-type'] ?? '').split(';')[0].toLowerCase()
    const status = event.responseStatusCode ?? 0, path = new URL(event.request.url).pathname
    const classification = classifyResponse({ pathname: path, method: event.request.method, status, contentType, resourceType: event.resourceType })
    const row = { id: ++serial, ...safeMeta(event.request), status, contentType, resourceType: event.resourceType, phase: phase(), classification,
      size: null, inspectionResult: 'PENDING', matchedSecretClasses: [], bodyInspectionErrorClass: null,
      initiatorClass: requests.get(event.networkId)?.initiatorClass ?? 'unknown', lifecycle: 'RESPONSE_PAUSED', intercepted: true }
    rows.push(row)
    let entry = requests.get(event.networkId)?.entry
    if (!entry) { entry = { id: registry.length + 1, ...safeMeta(event.request), state: 'DISCOVERED', noBody: noBodyRequest(event.request.method) }; registry.push(entry) }
    entry.required = ['MUST_INSPECT_SECRET_SURFACE', 'NO_BODY_EXPECTED'].includes(classification)
    row.registryId = entry.id
    transition(entry, 'CLASSIFIED'); transition(entry, 'INTERCEPTED'); transition(entry, 'RESPONSE_PAUSED')
    protocol.record('Fetch.requestPaused', event.networkId, event.requestId, { pathname: row.pathname, classification, status, resourceType: event.resourceType, contentType })
    if (event.networkId) byNetwork.set(event.networkId, row)
    try {
      // Redirect targets can leak credentials even without a response body.
      row.matchedSecretClasses = secretClasses(headers.location ?? '', knownSecrets)
      if (classification === 'NO_BODY_EXPECTED') {
        row.headerInspection = inspectResponseHeaders(event.responseHeaders, text => secretClasses(text, knownSecrets))
        row.matchedSecretClasses.push(...row.headerInspection.matchedSecretClasses)
        row.inspectionResult = row.headerInspection.headersInspected ? 'NO_BODY_EXPECTED' : 'FAIL'
        transition(entry, row.headerInspection.headersInspected ? 'HEADERS_INSPECTED' : 'HEADERS_FAILED')
        row.noBody = entry.noBody
      } else if (classification === 'REDIRECT') row.inspectionResult = 'NO_BODY_EXPECTED'
      else {
        transition(entry, 'BODY_READING')
        const response = await protocol.command('Fetch.getResponseBody', { requestId: event.requestId }, { networkId: event.networkId, lifecycle: row.lifecycle }, { timeout: 15000 })
        const body = response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response.body
        row.size = Buffer.byteLength(body)
        row.matchedSecretClasses.push(...secretClasses(body, knownSecrets))
        row.inspectionResult = classification === 'UNKNOWN' ? 'UNKNOWN_SURFACE' : 'PASS'
        transition(entry, 'BODY_INSPECTED')
        entry.noBody.inspectionTime = performance.now()
        entry.noBody.terminalState = 'BODY_INSPECTED'
        protocol.record('BODY_INSPECTED', event.networkId, event.requestId, { inspectionResult: row.inspectionResult })
      }
      if (row.matchedSecretClasses.length) { row.inspectionResult = 'SECRET_PATTERN_MATCH'; transition(entry, 'SECRET_MATCH') }
    } catch (error) {
      row.bodyInspectionErrorClass = inspectionError(error)
      row.inspectionResult = ['STATIC_ASSET', 'MAY_INSPECT'].includes(classification) ? 'NON_SECRET_BODY_UNAVAILABLE' : 'FAIL'
      transition(entry, 'BODY_UNAVAILABLE')
    } finally {
      try {
        transition(entry, 'CONTINUING')
        await protocol.command('Fetch.continueRequest', { requestId: event.requestId }, { networkId: event.networkId, lifecycle: row.lifecycle })
        if (classification !== 'NO_BODY_EXPECTED') transition(entry, 'COMPLETED')
      } catch (error) {
        transition(entry, 'CONTINUE_FAILED')
        failures.push({ kind: 'CONTINUE_RESPONSE_FAILED', errorClass: inspectionError(error), pathname: row.pathname })
      }
    }
  }
  cdp.on('Fetch.requestPaused', event => {
    const task = inspect(event).catch(error => { failures.push({ kind: 'INSPECTION_HANDLER_FAILED', errorClass: inspectionError(error) }) })
    pending.add(task); void task.finally(() => pending.delete(task))
  })
  page.on('console', message => {
    for (const kind of secretClasses(message.text(), knownSecrets)) consoleMatches.push({ phase: phase(), kind })
    const task = Promise.all(message.args().map(async arg => {
      try {
        const value = await arg.jsonValue()
        for (const kind of secretClasses(JSON.stringify(value), knownSecrets)) consoleMatches.push({ phase: phase(), kind })
      } catch (error) { failures.push({ kind: 'CONSOLE_INSPECTION_FAILED', errorClass: inspectionError(error) }) }
    }))
    pending.add(task); void task.finally(() => pending.delete(task))
  })
  await cdp.send('Network.enable', { maxTotalBufferSize: 64 * 1024 * 1024, maxResourceBufferSize: 16 * 1024 * 1024, enableDurableMessages: true })
  // Intercept data/document responses. Chrome's favicon loader is independent of page navigation;
  // pausing it can retain an obsolete icon request across reloads. Static metadata is still audited.
  await cdp.send('Fetch.enable', { patterns: [
    ...['Document', 'Fetch', 'XHR'].map(resourceType => ({ urlPattern: 'http*', resourceType, requestStage: 'Response' })),
    ...['*/api/*', '*/rest/v1/*', '*/auth/v1/*', '*/admin/integracoes-email*', '*/gestor/integracoes-email*'].map(urlPattern => ({ urlPattern, requestStage: 'Response' })),
  ] })
  const flush = async () => { while (pending.size) await Promise.all([...pending]) }
  const summary = () => {
    const must = rows.filter(row => row.classification === 'MUST_INSPECT_SECRET_SURFACE')
    const inspected = must.filter(row => row.inspectionResult === 'PASS').length
    return { mustInspect: must.length, intercepted: must.filter(row => row.intercepted).length, inspected, uninspected: must.length - inspected,
      pending: registry.filter(entry => entry.required && !terminalInspectionState(entry.state)).length,
      failed: registry.filter(entry => entry.required && terminalInspectionState(entry.state) && !['COMPLETED', 'NO_BODY_TERMINAL'].includes(entry.state)).length,
      noBody: registry.filter(entry => entry.noBody?.classification === 'NO_BODY_EXPECTED').length,
      noBodyTerminal: registry.filter(entry => entry.state === 'NO_BODY_TERMINAL').length,
      unexpectedCancels: aborted.filter(row => !['CANCELLED_AFTER_INSPECTION', 'CANCELLED_AFTER_TERMINAL_NO_BODY'].includes(row.classification) || row.errorClass !== 'ERR_ABORTED').length,
      total: rows.length, aborted: aborted.length, consoleMatches: consoleMatches.length }
  }
  const save = async () => {
    for (const [id, row] of passive) {
      if (byNetwork.has(id) || recordedPassive.has(id)) continue
      const safe = ['STATIC_ASSET', 'MAY_INSPECT'].includes(row.classification)
      rows.push({ id: ++serial, ...row, inspectionResult: row.classification === 'NO_BODY_EXPECTED'
        ? row.noBody?.terminalState === 'NO_BODY_TERMINAL' ? 'NO_BODY_EXPECTED' : 'UNINSPECTED_SURFACE'
        : safe ? 'NON_SECRET_STATIC' : 'UNINSPECTED_SURFACE' })
      recordedPassive.add(id)
    }
    await writeFile(file, JSON.stringify({ summary: summary(), rows, registry, aborted, consoleMatches, failures, protocol: { versions: protocol.versions, timeline: protocol.timeline } }, null, 2))
  }
  const assertHealthy = async () => {
      await flush(); await save()
      const counts = summary()
      assert.equal(counts.inspected, counts.mustInspect, 'MUST_INSPECT_COVERAGE_FAILED')
      assert.equal(counts.intercepted, counts.mustInspect, 'MUST_INSPECT_INTERCEPT_COVERAGE_FAILED')
      assert.equal(rows.filter(row => ['FAIL', 'PENDING', 'UNKNOWN_SURFACE', 'UNINSPECTED_SURFACE', 'SECRET_PATTERN_MATCH'].includes(row.inspectionResult)).length, 0, 'RESPONSE_REDACTION_FAILED')
      assert.equal(counts.unexpectedCancels, 0, 'UNINSPECTED_OR_UNEXPECTED_ABORT')
      assert.equal(counts.noBody, counts.noBodyTerminal, 'NO_BODY_TERMINAL_REQUIRED')
      assert.equal(failures.length, 0, 'RESPONSE_INSPECTION_PROTOCOL_FAILED')
      assert.equal(consoleMatches.length, 0, 'CONSOLE_SECRET_PATTERN_MATCH')
      return counts
  }
  const snapshot = () => ({ ...summary(), tasks: pending.size, states: registry.filter(entry => entry.required && !['COMPLETED', 'NO_BODY_TERMINAL'].includes(entry.state)).map(({ pathname, state }) => ({ pathname, state })) })
  const barrier = createRedactionBarrier({
    snapshot,
    validate: assertHealthy, save,
    record: (event, metadata) => {
      protocol.record(event, null, null, metadata)
      if (event === 'REDACTION_DRAIN_TIMEOUT') failures.push({ kind: event })
    },
  })
  return { flush, save, assertHealthy, snapshot, ...barrier,
    async assertClean() {
      await barrier.awaitDrain()
      const counts = await assertHealthy()
      assert.ok(counts.mustInspect > 0, 'NO_SECRET_SURFACE_OBSERVED')
      assert.deepEqual(secretClasses(await page.content(), knownSecrets), [], 'HTML_SECRET_PATTERN_MATCH')
      return counts
    },
  }
}
