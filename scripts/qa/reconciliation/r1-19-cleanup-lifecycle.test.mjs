import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanupPlan, assertCompletedAbsent } from './r1-19-cleanup-lifecycle.mjs'

const empty = () => ({ containers: [], volumes: [], networks: [] })
const baseline = { containers: ['existing-container'], volumes: ['existing-volume'], networks: ['existing-network'] }
const resources = id => Object.fromEntries(Object.keys(baseline).map(k => [k, [k + '_' + id]]))
function fixture() {
  const projectId = 'bw_email03_r110pa_1791468531130'
  const root = { projectId, resources: resources(projectId), before: structuredClone(baseline), createdAt: '2026-10-08T14:00:00Z', cleanupRuns: [{ result: 'PASS' }],
    portContract: { before: structuredClone(baseline), spec: { projectId } } }
  const childId = 'bw_email03_r110cred_1791468619969'
  const child = { projectId: childId, resources: resources(childId),
    before: Object.fromEntries(Object.keys(baseline).map(k => [k, [...baseline[k], ...root.resources[k]].sort()])),
    createdAt: '2026-10-08T14:01:00Z', cleanupRuns: [{ result: 'PASS' }] }
  return { root, child, manifests: [root, child], current: structuredClone(baseline) }
}
test('Completed child and removed owned parent: verify only, no second stop', () => {
  const f = fixture(), plan = cleanupPlan(f.manifests, f.current)
  assert.deepEqual(plan.steps.map(s => s.action), ['VERIFY_COMPLETED_ABSENT', 'VERIFY_COMPLETED_ABSENT'])
  assert.deepEqual(plan.baseline, baseline)
  assertCompletedAbsent(f.child, f.current, empty())
})
test('Unfinished child is cleaned before its parent with original guard', () => {
  const f = fixture()
  for (const m of f.manifests) { m.cleanupRuns = []; for (const k of Object.keys(baseline)) f.current[k].push(...m.resources[k]) }
  const plan = cleanupPlan(f.manifests, f.current)
  assert.deepEqual(plan.steps.map(s => s.projectId), [f.child.projectId, f.root.projectId])
  assert(plan.steps.every(s => s.action === 'CLEANUP_WITH_ORIGINAL_GUARD'))
})
for (const kind of Object.keys(baseline)) {
  test('Reject truly missing preexisting ' + kind, () => {
    const f = fixture(); f.current[kind] = []
    assert.throws(() => cleanupPlan(f.manifests, f.current), /REAL_PREEXISTING_RESOURCE_REMOVED/)
  })
  test('Reject completed resource reappearance: ' + kind, () => {
    const f = fixture(); f.current[kind].push(...f.child.resources[kind])
    assert.throws(() => cleanupPlan(f.manifests, f.current), /COMPLETED_RESOURCE_REAPPEARED/)
  })
}
test('Unknown labeled resource cannot be hidden by a completed manifest', () => {
  const f = fixture(), labeled = empty(); labeled.containers.push('unknown')
  assert.throws(() => assertCompletedAbsent(f.child, f.current, labeled), /UNMANIFESTED_LABELED_RESOURCE/)
})
test('Child baseline cannot explain away unrelated missing objects', () => {
  const f = fixture(); f.child.before.containers.push('foreign')
  assert.throws(() => cleanupPlan(f.manifests, f.current), /UNEXPECTED_CHILD_BASELINE/)
})
test('Completed means latest successful cleanup, never an old PASS followed by FAIL', () => {
  const f = fixture(); f.child.cleanupRuns.push({ result: 'FAIL' })
  assert.equal(cleanupPlan(f.manifests, f.current).steps[0].action, 'CLEANUP_WITH_ORIGINAL_GUARD')
  assert.throws(() => assertCompletedAbsent(f.child, f.current, empty()), /CLEANUP_NOT_COMPLETED/)
})
test('Reject missing root manifest', () => assert.throws(() => cleanupPlan([fixture().child], baseline), /EXACTLY_ONE_RUN_ROOT_REQUIRED/))
test('Reject duplicate project manifests', () => {
  const f = fixture(); assert.throws(() => cleanupPlan([...f.manifests, f.child], baseline), /DUPLICATE_PROJECT/)
})
test('Reject resource ownership forgery', () => {
  const f = fixture(); f.child.resources.volumes.push('foreign-volume')
  assert.throws(() => cleanupPlan(f.manifests, baseline), /UNOWNED_RESOURCE_NAME/)
})
test('Reject unmanifested inventory drift', () => {
  const f = fixture(); f.current.networks.push('unknown-network')
  assert.throws(() => cleanupPlan(f.manifests, f.current), /UNMANIFESTED_RESOURCE/)
})
