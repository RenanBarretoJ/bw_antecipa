import assert from 'node:assert/strict'

const terminal = new Set(['COMPLETED', 'NO_BODY_TERMINAL', 'BODY_UNAVAILABLE', 'SECRET_MATCH', 'HEADERS_FAILED', 'CANCELLED_BEFORE_INSPECTION', 'CONTINUE_FAILED', 'PROTOCOL_FAILURE'])
export const terminalInspectionState = state => terminal.has(state)

/** Serializes harness actions; the application is never paused or modified. */
export function createRedactionBarrier({ snapshot, validate, record, save }) {
  let tail = Promise.resolve()
  async function awaitDrain({ timeoutMs = 20000, quietMs = 100 } = {}) {
    assert.ok(timeoutMs > 0 && timeoutMs <= 20000 && quietMs >= 0 && quietMs < timeoutMs, 'INVALID_DRAIN_BOUND')
    const started = performance.now()
    let idleSince = null
    record('DRAIN_START', snapshot())
    try {
      while (true) {
        const state = snapshot()
        if (state.failed > 0) throw Error('REDACTION_DRAIN_FAILED')
        if (state.pending === 0 && state.tasks === 0) {
          idleSince ??= performance.now()
          if (performance.now() - idleSince >= quietMs) {
            await validate()
            // Validation can yield to CDP events; recheck before allowing an action.
            const final = snapshot()
            if (final.pending === 0 && final.tasks === 0 && final.failed === 0) {
              record('DRAIN_PASS', final)
              return final
            }
          }
        } else idleSince = null
        if (performance.now() - started >= timeoutMs) throw Error(state.semanticPending > 0 ? 'SEMANTIC_DRAIN_TIMEOUT' : 'REDACTION_DRAIN_TIMEOUT')
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    } catch (error) {
      record(['REDACTION_DRAIN_TIMEOUT', 'SEMANTIC_DRAIN_TIMEOUT'].includes(error.message) ? error.message : 'REDACTION_DRAIN_FAILED', snapshot())
      await save()
      throw error
    }
  }
  function beforeNavigation(action, options) {
    const task = tail.then(async () => {
      await awaitDrain(options)
      const state = snapshot()
      assert.equal(state.pending + state.tasks + state.failed, 0, 'REDACTION_ACTION_NOT_DRAINED')
      record('HARNESS_ACTION_START', state)
      return action()
    })
    // A rejected action cannot prevent mandatory cleanup from attempting its own drain.
    tail = task.catch(() => {})
    return task
  }
  return { awaitDrain, beforeNavigation }
}
