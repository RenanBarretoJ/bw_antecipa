import { test } from 'node:test'
import assert from 'node:assert/strict'
import { navigationMetadata, staleDiscovered, assertFundSwitchReady } from './browser-navigation.mjs'
import { createRedactionBarrier } from './browser-drain.mjs'

test('RSC prefetch needs protocol evidence and retains only local navigation IDs', () => {
  const aliases = new Map()
  const localId = (kind, value) => { const key = kind + value; if (!aliases.has(key)) aliases.set(key, aliases.size + 1); return kind + aliases.get(key) }
  const source = { request: { headers: { RSC: '1', 'Next-Router-Prefetch': '1', Cookie: 'SENSITIVE_COOKIE' } },
    initiator: { type: 'script', stack: { secret: 'SENSITIVE_STACK' } }, frameId: 'SENSITIVE_FRAME', loaderId: 'SENSITIVE_LOADER' }
  const result = navigationMetadata(source, localId)
  assert.equal(result.requestClass, 'PREFETCH')
  assert.equal(result.initiatorClass, 'script')
  assert.equal(result.redirectCount, 0)
  assert.ok(!JSON.stringify(result).includes('SENSITIVE'))
  assert.equal(navigationMetadata({ ...source, redirectResponse: {} }, localId, 1).redirectCount, 2)
  assert.equal(navigationMetadata({ ...source, request: { headers: { rsc: '1' } } }, localId).requestClass, 'NAVIGATION_RSC')
  assert.equal(navigationMetadata({ ...source, request: { url: '/prefetch/rsc', headers: {} } }, localId).requestClass, 'UNKNOWN')
})

test('a cookie update alone is insufficient: route, rendered context and single navigation must agree', () => {
  const ready = { cookieMatches: true, selectionMatches: true, routeMatches: true, headingReady: true, hardReloads: 0, pending: 0, stale: 0 }
  assertFundSwitchReady(ready)
  for (const key of ['cookieMatches', 'selectionMatches', 'routeMatches', 'headingReady']) assert.throws(() => assertFundSwitchReady({ ...ready, [key]: false }))
  assert.throws(() => assertFundSwitchReady({ ...ready, hardReloads: 1 }), /DOUBLE_NAVIGATION/)
  assert.throws(() => assertFundSwitchReady({ ...ready, pending: 1 }), /REQUIRED_REQUEST_PENDING/)
  assert.throws(() => assertFundSwitchReady({ ...ready, stale: 1 }), /STALE_DISCOVERED/)
})

test('stale DISCOVERED is bounded and a proved prefetch is still mandatory', async () => {
  const entry = { required: true, state: 'DISCOVERED', discoveredAtMs: 10, requestClass: 'PREFETCH' }
  assert.equal(staleDiscovered(entry, 20009), false)
  assert.equal(staleDiscovered(entry, 20010), true)
  assert.equal(staleDiscovered({ ...entry, state: 'COMPLETED' }, 20010), false)
  let called = false, saved = false
  const events = []
  const barrier = createRedactionBarrier({ snapshot: () => ({ pending: 1, staleDiscovered: 1, failed: 0, tasks: 0 }),
    validate: async () => {}, record: event => events.push(event), save: async () => { saved = true } })
  await assert.rejects(barrier.beforeNavigation(() => { called = true }), /STALE_DISCOVERED_REQUEST/)
  assert.equal(called, false); assert.equal(saved, true)
  assert.ok(events.includes('STALE_DISCOVERED_REQUEST'))
})

test('a concurrent prefetch must finish before a fund switch, and stalled required requests fail', async () => {
  const state = { pending: 1, failed: 0, tasks: 0, staleDiscovered: 0 }, events = []
  const barrier = createRedactionBarrier({ snapshot: () => ({ ...state }), validate: async () => {}, save: async () => {}, record: e => events.push(e) })
  setTimeout(() => { state.pending = 0 }, 20)
  await barrier.beforeNavigation(() => assert.equal(state.pending, 0), { timeoutMs: 1000, quietMs: 0 })
  state.pending = 1
  await assert.rejects(barrier.beforeNavigation(() => assert.fail('required request was bypassed'), { timeoutMs: 50, quietMs: 0 }), /REDACTION_DRAIN_TIMEOUT/)
  assert.ok(events.includes('REDACTION_DRAIN_TIMEOUT'))
})
