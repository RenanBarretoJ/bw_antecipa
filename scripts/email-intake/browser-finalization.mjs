import assert from 'node:assert/strict'
import { boundedInspection } from './browser-semantic.mjs'

/** The readiness callback must represent the destination, not a transient success toast. */
export function createInspectionFinalizer({ semantic, networkDrain, assertClean, snapshot, record, save }) {
  let tail = Promise.resolve(), readiness = null
  function expectReadiness(ready) {
    assert.equal(typeof ready, 'function', 'DESTINATION_READINESS_REQUIRED')
    readiness = ready
  }
  async function settle({ ready = readiness, timeoutMs = 20000 } = {}) {
    assert.equal(typeof ready, 'function', 'DESTINATION_READINESS_REQUIRED')
    record('FINALIZATION_READINESS_START', snapshot())
    try {
      await boundedInspection(Promise.resolve().then(ready), timeoutMs, 'NAVIGATION_READINESS_TIMEOUT')
      record('FINALIZATION_READINESS_COMPLETE', snapshot())
      await semantic.awaitDrain({ timeoutMs })
      await networkDrain({ timeoutMs })
      const state = snapshot()
      assert.equal(state.pending + state.tasks + state.failed + state.semanticPending + state.semanticFailed, 0, 'FINALIZATION_NOT_TERMINAL')
      record('FINALIZATION_ASSERT_CLEAN', state)
      return await assertClean()
    } catch (error) {
      // Never retain the provider/error message. A timeout remains a failed gate.
      const state = snapshot()
      const semanticTimeout = state.semanticPending > 0 && (error.message.endsWith('_TIMEOUT') || error.name === 'TimeoutError')
      const kind = semanticTimeout ? 'SEMANTIC_DRAIN_TIMEOUT'
        : ['SEMANTIC_DRAIN_TIMEOUT', 'NAVIGATION_READINESS_TIMEOUT'].includes(error.message) ? error.message : 'FINALIZATION_FAILED'
      record(kind, state); await save(); throw semanticTimeout ? Error(kind) : error
    }
  }
  const serialize = work => {
    const task = tail.then(work)
    tail = task.catch(() => {})
    return task
  }
  return { expectReadiness,
    settleAndAssertClean: options => serialize(() => settle(options)),
    closeAfterDrain: (close, options) => serialize(async () => {
      let forced = false
      try { return await settle(options) }
      catch (error) { forced = true; throw error }
      finally {
        // On failure, evidence is saved before forced disposal; failure still propagates.
        record('FINALIZATION_CLOSE', { ...snapshot(), forced }); await save(); await close()
      }
    }),
  }
}
