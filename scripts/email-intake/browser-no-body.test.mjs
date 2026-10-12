import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bodylessResponse, inspectResponseHeaders, noBodyRequest, receiveNoBodyResponse, cancelNoBodyResponse } from './browser-no-body.mjs'
import { secretClasses } from './browser-redaction.mjs'

const clean = { 'content-type': 'application/json' }
test('only protocol semantics determine bodylessness; informational status is not final', () => {
  for (const [method, status] of [['HEAD', 200], ['GET', 204], ['GET', 205], ['GET', 304], ['GET', 103]]) assert.equal(bodylessResponse(method, status), true)
  for (const status of [0, undefined, 200, 202, 400]) assert.equal(bodylessResponse('GET', status), false)
  const informational = receiveNoBodyResponse(noBodyRequest('GET'), { status: 103, headers: clean }, secretClasses, 1)
  assert.equal(cancelNoBodyResponse(informational, 2), 'UNINSPECTED_ABORT')
})
test('HEAD, 204 and 304 cancel only after certified response headers', () => {
  for (const [method, status] of [['HEAD', 200], ['GET', 204], ['GET', 304]]) {
    const state = receiveNoBodyResponse(noBodyRequest(method), { status, headers: clean }, secretClasses, 10)
    assert.equal(state.terminalState, 'NO_BODY_TERMINAL')
    assert.equal(state.bodyExpected, false)
    assert.equal(cancelNoBodyResponse(state, 11), 'CANCELLED_AFTER_TERMINAL_NO_BODY')
    assert.equal(state.inspectionTime, 10)
    assert.equal(state.cancellationTime, 11)
  }
})
test('missing response, missing headers and late evidence never rescue cancellation', () => {
  for (const status of [200, 204, 304]) {
    const state = receiveNoBodyResponse(noBodyRequest('HEAD'), { status }, secretClasses, 10)
    assert.equal(cancelNoBodyResponse(state, 11), 'UNINSPECTED_ABORT')
  }
  const early = noBodyRequest('HEAD')
  assert.equal(cancelNoBodyResponse(early, 1), 'UNINSPECTED_ABORT')
  receiveNoBodyResponse(early, { status: 200, headers: clean }, secretClasses, 2)
  assert.equal(early.responseReceived, false)
})
test('GET and RSC cancellation cannot gain bodyless exception', () => {
  for (const contentType of ['application/json', 'text/x-component']) {
    const state = receiveNoBodyResponse(noBodyRequest('GET'), { status: 200, headers: { 'content-type': contentType } }, secretClasses, 1)
    assert.equal(state.bodyExpected, true)
    assert.equal(cancelNoBodyResponse(state, 2), 'UNINSPECTED_ABORT')
  }
})
test('header secret classes and known values are detected without retaining values', () => {
  const sentinel = 'SYNTHETIC_HEADER_SENTINEL'
  for (const headers of [{ 'x-client-secret': sentinel }, { authorization: 'Bearer ' + sentinel }, { location: '/storage/v1/object/sign/fixture?token='+sentinel },
    { 'x-value': sentinel }, { 'x-key': '-----BEGIN PRIVATE KEY-----' }, { 'x-access-token': sentinel }, { 'refresh_token': sentinel }, { 'x-service-role': sentinel }]) {
    const state = receiveNoBodyResponse(noBodyRequest('HEAD'), { status: 200, headers }, text => secretClasses(text, [{ value: sentinel, kind: 'KNOWN_SECRET' }]), 1)
    assert.equal(state.sensitiveHeaderMatch, true)
    assert.equal(cancelNoBodyResponse(state, 2), 'UNINSPECTED_ABORT')
    assert.equal(JSON.stringify(state).includes(sentinel), false)
  }
})
test('session cookies are classified separately, integration secrets are never exempt', () => {
  const cookie = 'sb-qa-auth-token=base64-' + Buffer.from(JSON.stringify({ access_token: 'synthetic-session', refresh_token: 'synthetic-refresh' })).toString('base64url') + '; HttpOnly'
  const safe = inspectResponseHeaders({ 'set-cookie': cookie }, secretClasses)
  assert.equal(safe.sessionCookieHeaders, 1); assert.equal(safe.sensitiveHeaderMatch, false)
  const unsafe = inspectResponseHeaders({ 'set-cookie': cookie+'\nclient_secret=SYNTHETIC_CREDENTIAL; HttpOnly' }, secretClasses)
  assert.equal(unsafe.sensitiveHeaderMatch, true)
  assert.equal(inspectResponseHeaders({ 'set-cookie': cookie }, text => secretClasses(text, [{value:'synthetic-session',kind:'KNOWN_INTEGRATION_SECRET'}])).sensitiveHeaderMatch, true)
})
test('header inspection exceptions remain closed and contain no raw errors', () => {
  const result = inspectResponseHeaders(clean, () => { throw Error('PRIVATE_SENTINEL') })
  assert.equal(result.headersInspected, false)
  assert.equal(result.headerInspectionErrorClass, 'HEADER_INSPECTION_FAILED')
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false)
})

test('credential parameters in response URLs do not depend on knowing the secret', () => {
  for (const name of ['location', 'content-location', 'link']) {
    const result = inspectResponseHeaders({ [name]: 'https://qa.invalid/path?access_token=unknown-token' }, secretClasses)
    assert.ok(result.matchedSecretClasses.includes('SENSITIVE_URL_PARAMETER'))
  }
})
