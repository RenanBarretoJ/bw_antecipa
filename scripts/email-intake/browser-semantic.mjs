import assert from 'node:assert/strict'

/** A deadline is a failure bound, never a delay used to establish readiness. */
export async function boundedInspection(work, timeoutMs, errorClass) {
  assert.ok(timeoutMs > 0 && timeoutMs <= 20000, 'INVALID_INSPECTION_BOUND')
  let timer
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(errorClass)), timeoutMs)
    })])
  } finally { clearTimeout(timer) }
}

/** Keeps metadata only; payloads and validation results remain with the caller. */
export function createSemanticRegistry(record = () => {}) {
  const rows = [], tasks = new Set()
  const snapshot = () => ({ semanticRequired: rows.length,
    semanticComplete: rows.filter(r => r.state === 'SEMANTIC_INSPECTION_COMPLETE').length,
    semanticPending: rows.filter(r => r.state === 'SEMANTIC_INSPECTION_PENDING').length,
    semanticFailed: rows.filter(r => r.state === 'SEMANTIC_INSPECTION_FAILED').length })
  const inspect = (registryId, work) => {
    const row = { registryId, state: 'SEMANTIC_INSPECTION_PENDING' }
    rows.push(row); record(row.state, { registryId })
    const task = (async () => {
      try {
        const result = await work()
        row.state = result.matchedSecretClasses.length ? 'SEMANTIC_INSPECTION_FAILED' : 'SEMANTIC_INSPECTION_COMPLETE'
        return result
      } catch (error) { row.state = 'SEMANTIC_INSPECTION_FAILED'; throw error }
      finally { record(row.state, { registryId }) }
    })()
    tasks.add(task)
    void task.then(() => tasks.delete(task), () => tasks.delete(task))
    return task
  }
  const awaitDrain = async ({ timeoutMs = 20000, assertSuccessful = true } = {}) => {
    const deadline = performance.now() + timeoutMs
    while (tasks.size) {
      await boundedInspection(Promise.allSettled([...tasks]), Math.max(1, deadline - performance.now()), 'SEMANTIC_DRAIN_TIMEOUT')
    }
    if (assertSuccessful) assert.equal(snapshot().semanticFailed, 0, 'SEMANTIC_INSPECTION_FAILED')
    return snapshot()
  }
  return { rows, snapshot, inspect, awaitDrain }
}
