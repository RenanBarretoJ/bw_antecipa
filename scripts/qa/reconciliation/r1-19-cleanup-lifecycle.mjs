import assert from 'node:assert/strict'

const kinds = ['containers', 'volumes', 'networks']
const completed = m => m.cleanupRuns.at(-1)?.result === 'PASS'

export function cleanupPlan(manifests, current) {
  assert(manifests.length > 0, 'CLEANUP_MANIFEST_REQUIRED')
  const roots = manifests.filter(m => /^bw_email03_r110pa_\d{13}$/.test(m.projectId))
  assert.equal(roots.length, 1, 'EXACTLY_ONE_RUN_ROOT_REQUIRED')
  const root = roots[0], baseline = root.before
  assert.deepEqual(root.portContract.before, baseline, 'ROOT_BASELINE_MISMATCH')
  assert.equal(root.portContract.spec.projectId, root.projectId)
  assert.equal(new Set(manifests.map(m => m.projectId)).size, manifests.length, 'DUPLICATE_PROJECT')
  for (const m of manifests) {
    assert.match(m.projectId, /^bw_email03_r110(pa|cred|inl|cnab)_\d{13}$/)
    for (const kind of kinds) {
      for (const name of m.resources[kind]) {
        assert(name.endsWith('_' + m.projectId), 'UNOWNED_RESOURCE_NAME')
        assert(!m.before[kind].includes(name) && !baseline[kind].includes(name), 'RESOURCE_PREEXISTED')
      }
      // A child baseline may include the main stack, but never an unrelated missing resource.
      const expected = m === root ? baseline[kind] : [...baseline[kind], ...root.resources[kind]].sort()
      assert.deepEqual(m.before[kind], expected, 'UNEXPECTED_CHILD_BASELINE')
      assert(baseline[kind].every(n => current[kind].includes(n)), 'REAL_PREEXISTING_RESOURCE_REMOVED')
      if (completed(m)) assert(m.resources[kind].every(n => !current[kind].includes(n)), 'COMPLETED_RESOURCE_REAPPEARED')
    }
  }
  for (const kind of kinds) {
    const owned = manifests.flatMap(m => m.resources[kind])
    assert(current[kind].every(n => baseline[kind].includes(n) || owned.includes(n)), 'UNMANIFESTED_RESOURCE')
  }
  // Unfinished children must finish under their original strict guard before the parent.
  const ordered = [...manifests.filter(m => m !== root).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), root]
  return { baseline, steps: ordered.map(m => ({ projectId: m.projectId, action: completed(m) ? 'VERIFY_COMPLETED_ABSENT' : 'CLEANUP_WITH_ORIGINAL_GUARD' })) }
}

export function assertCompletedAbsent(manifest, current, labeled) {
  assert(completed(manifest), 'CLEANUP_NOT_COMPLETED')
  for (const kind of kinds) {
    assert(manifest.resources[kind].every(n => !current[kind].includes(n)), 'COMPLETED_RESOURCE_REAPPEARED')
    assert.equal(labeled[kind].length, 0, 'UNMANIFESTED_LABELED_RESOURCE')
  }
}
