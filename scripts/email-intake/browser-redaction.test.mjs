import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { classifyResponse, secretClasses, inspectEmailResponses } from './browser-redaction.mjs'

test('API and RSC responses cannot be downgraded by an asset suffix or MIME', () => {
  for (const pathname of ['/api/credential.js', '/admin/integracoes-email', '/rest/v1/rpc/email_operator_dashboard']) {
    assert.equal(classifyResponse({ pathname, method: 'GET', status: 200, contentType: 'image/png', resourceType: 'Image' }), 'MUST_INSPECT_SECRET_SURFACE')
  }
  assert.equal(classifyResponse({ pathname: '/unexpected', method: 'GET', status: 200, contentType: 'application/octet-stream' }), 'UNKNOWN')
  assert.equal(classifyResponse({ pathname: '/_next/static/a.js', method: 'GET', status: 200, contentType: 'text/javascript', resourceType: 'Script' }), 'STATIC_ASSET')
  assert.equal(classifyResponse({ pathname: '/better-with-logo.png', method: 'GET', status: 200, contentType: 'image/png', resourceType: 'Other' }), 'STATIC_ASSET')
  assert.equal(classifyResponse({ pathname: '/api/better-with-logo.png', method: 'GET', status: 200, contentType: 'image/png', resourceType: 'Other' }), 'MUST_INSPECT_SECRET_SURFACE')
})

test('known static namespaces require compatible method, resource type and MIME', () => {
  const asset = { pathname: '/_next/static/chunks/app/admin/integracoes-email/foo.js', method: 'GET', status: 200, resourceType: 'Script', contentType: 'application/javascript' }
  assert.equal(classifyResponse(asset), 'STATIC_ASSET')
  for (const override of [{ method: 'POST' }, { resourceType: 'Fetch' }, { contentType: 'application/json' },
    { pathname: '/spoof/_next/static/foo.js' }, { pathname: '/_next/static/../api/foo.js' }, { pathname: '/_next/static/%2e%2e/api/foo.js' }]) {
    assert.notEqual(classifyResponse({ ...asset, ...override }), 'STATIC_ASSET')
  }
  for (const [pathname, resourceType, contentType] of [
    ['/_next/static/css/app.css', 'Stylesheet', 'text/css'],
    ['/_next/static/media/font.woff2', 'Font', 'font/woff2'],
    ['/_next/static/media/logo.png', 'Image', 'image/png'],
    ['/_next/image', 'Image', 'image/webp'],
  ]) assert.equal(classifyResponse({ ...asset, pathname, resourceType, contentType }), 'STATIC_ASSET')
})

test('HTML/RSC admin routes and APIs stay mandatory, unknown JSON fails closed', () => {
  for (const contentType of ['text/html', 'text/x-component']) {
    assert.equal(classifyResponse({ pathname: '/admin/integracoes-email', method: 'GET', status: 200, contentType, resourceType: 'Document' }), 'MUST_INSPECT_SECRET_SURFACE')
  }
  for (const pathname of ['/api/admin/integracoes-email', '/api/unknown', '/rest/v1/rpc/unknown']) {
    assert.equal(classifyResponse({ pathname, method: 'GET', status: 200, contentType: 'application/json', resourceType: 'Fetch' }), 'MUST_INSPECT_SECRET_SURFACE')
  }
  assert.equal(classifyResponse({ pathname: '/unknown.json', method: 'GET', status: 200, contentType: 'application/json', resourceType: 'Fetch' }), 'UNKNOWN')
  assert.equal(classifyResponse({ pathname: '/favicon.ico', method: 'GET', status: 200, contentType: 'text/html', resourceType: 'Other' }), 'MUST_INSPECT_SECRET_SURFACE')
  assert.equal(classifyResponse({ pathname: '/favicon.ico', method: 'GET', status: 204, contentType: '', resourceType: 'Other' }), 'NO_BODY_EXPECTED')
})

test('secret detection returns classes only, including escaped RSC values', () => {
  const cases = [
    ['CLIENT_SECRET', '{"client_secret":"synthetic"}'], ['ACCESS_TOKEN', '{"access_token":"synthetic"}'],
    ['REFRESH_TOKEN', '{\\"refresh_token\\":\\"synthetic\\"}'], ['PRIVATE_KEY', '-----BEGIN PRIVATE KEY-----'],
    ['BEARER', 'Bearer syntheticbearertoken'], ['ENCRYPTED_SECRET', 'secretCiphertext'],
    ['INTERNAL_SECRET_REFERENCE', 'vault://credentials/synthetic'], ['JOB_SECRET', '{"EMAIL_INTAKE_JOB_SECRET":"synthetic"}'],
    ['SERVER_ENV_SECRET', '{"SUPABASE_SERVICE_ROLE_KEY":"synthetic"}'], ['SIGNED_URL', '/storage/v1/object/sign/doc?token=synthetic'],
  ]
  for (const [kind, body] of cases) assert.ok(secretClasses(body).includes(kind), kind)
  assert.deepEqual(secretClasses('metadata only'), [])
  assert.deepEqual(secretClasses('exact synthetic value', [{ value: 'synthetic value', kind: 'KNOWN_SECRET' }]), ['KNOWN_SECRET'])
})

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'email05-redaction-'))
  try {
    const cdp = new EventEmitter(), page = new EventEmitter()
    let unavailable = false
    const calls = []
    cdp.send = async (method, parameters) => {
      calls.push({ method, parameters })
      if (method === 'Fetch.getResponseBody') { if (unavailable) throw Error('Protocol: No resource with given identifier found SENSITIVE_SENTINEL'); return { body: '{"safe":true}', base64Encoded: false } }
      return {}
    }
    page.createCDPSession = async () => cdp
    page.content = async () => '<main>safe</main>'
    const file = join(root, 'report.json'), inspection = await inspectEmailResponses(page, { file })
    const response = (id, path = '/admin/integracoes-email') => {
      const request = { method: 'GET', url: `https://qa.invalid${path}?token=SENSITIVE_SENTINEL`, headers: { RSC: '1' } }
      cdp.emit('Network.requestWillBeSent', { requestId: id, request, type: 'Fetch' })
      cdp.emit('Fetch.requestPaused', { requestId: `fetch-${id}`, networkId: id, request, resourceType: 'Fetch', responseStatusCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'text/x-component' }] })
    }
    await run({ cdp, response, inspection, file, calls, unavailable: () => { unavailable = true } })
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'email05-redaction-'))
    await rm(root, { recursive: true, force: true })
  }
}

test('a relevant unavailable body fails and persists only an error class', () => fixture(async ({ response, inspection, file, unavailable }) => {
  unavailable(); response('1'); await inspection.flush()
  await assert.rejects(inspection.assertClean(), /REDACTION_DRAIN_FAILED/)
  const raw = await readFile(file, 'utf8'), report = JSON.parse(raw)
  assert.equal(report.rows[0].bodyInspectionErrorClass, 'BODY_UNAVAILABLE_PROTOCOL')
  assert.equal(raw.includes('SENSITIVE_SENTINEL'), false)
  assert.equal(raw.includes('token='), false); assert.equal(raw.includes('No resource'), false)
  assert.equal(report.rows[0].inspectionResult, 'FAIL')
}))

test('cancelled action before inspection fails; cancellation after inspection has explicit evidence', () => fixture(async ({ cdp, response, inspection, file }) => {
  response('1'); await inspection.flush()
  cdp.emit('Network.loadingFailed', { requestId: '1', errorText: 'net::ERR_ABORTED' })
  await inspection.assertClean()
  assert.equal(JSON.parse(await readFile(file, 'utf8')).aborted[0].classification, 'CANCELLED_AFTER_INSPECTION')
  cdp.emit('Network.requestWillBeSent', { requestId: '2', request: { url: 'https://qa.invalid/admin/integracoes-email', method: 'POST', headers: {} }, type: 'Fetch' })
  cdp.emit('Network.loadingFailed', { requestId: '2', errorText: 'net::ERR_ABORTED' })
  await assert.rejects(inspection.assertClean(), /REDACTION_DRAIN_FAILED/)
}))

test('response body uses its Fetch ID and is inspected before continuation', () => fixture(async ({ response, inspection, calls, file }) => {
  response('network-distinct'); await inspection.assertClean()
  const body = calls.findIndex(call => call.method === 'Fetch.getResponseBody')
  const continued = calls.findIndex(call => call.method === 'Fetch.continueRequest')
  assert.ok(body >= 0 && continued > body)
  assert.equal(calls[body].parameters.requestId, 'fetch-network-distinct')
  assert.equal(calls[continued].parameters.requestId, 'fetch-network-distinct')
  const timeline = JSON.parse(await readFile(file, 'utf8')).protocol.timeline
  assert.ok(timeline.findIndex(row => row.event === 'BODY_INSPECTED') < timeline.findIndex(row => row.event === 'Fetch.continueRequest'))
  assert.ok(timeline.filter(row => row.event === 'Fetch.getResponseBody').every(row => row.networkId !== row.fetchId))
}))
