import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRedactionBarrier } from './browser-drain.mjs'

test('drain serializes navigation and includes requests discovered during validation', async () => {
  const events = [], state = { pending: 1, tasks: 0, failed: 0 }
  let validations = 0
  const barrier = createRedactionBarrier({ snapshot: () => ({ ...state }), save: async () => {},
    record: event => events.push(event), validate: async () => {
      if (++validations === 1) { state.pending++; setTimeout(() => { state.pending-- }, 20) }
    } })
  setTimeout(() => { state.pending-- }, 20)
  await Promise.all([barrier.beforeNavigation(async () => { assert.equal(state.pending, 0); events.push('FIRST'); await new Promise(r => setTimeout(r, 20)) }, { quietMs: 0 }),
    barrier.beforeNavigation(() => { assert.equal(state.pending, 0); events.push('SECOND') }, { quietMs: 0 })])
  assert.ok(events.indexOf('FIRST') < events.indexOf('SECOND'))
  assert.equal(events.filter(event => event === 'DRAIN_PASS').length, 2)
})

test('bounded timeout persists failure and never invokes navigation', async () => {
  const events = []
  let saved = false, called = false
  const barrier = createRedactionBarrier({ snapshot: () => ({ pending: 1, tasks: 1, failed: 0 }),
    validate: async () => {}, record: event => events.push(event), save: async () => { saved = true } })
  await assert.rejects(barrier.beforeNavigation(() => { called = true }, { timeoutMs: 50, quietMs: 0 }), /REDACTION_DRAIN_TIMEOUT/)
  assert.equal(saved, true); assert.equal(called, false); assert.ok(events.includes('REDACTION_DRAIN_TIMEOUT'))
})

test('external failure cannot be drained into a passing navigation', async () => {
  const barrier = createRedactionBarrier({ snapshot: () => ({ pending: 0, tasks: 0, failed: 1 }),
    validate: async () => {}, record: () => {}, save: async () => {} })
  await assert.rejects(barrier.beforeNavigation(() => assert.fail('navigation ran')), /REDACTION_DRAIN_FAILED/)
})
