import assert from 'node:assert/strict'
import { readFile, writeFile, readdir, cp, unlink, rm, lstat } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { inventory } from '../../email-intake/disposable-resources.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const base = resolve('rehearsal/tmp'), root = resolve(base, 'r119-resume-ci-qWt5aW')
assert.equal(dirname(root), base); assert(root.startsWith(base + sep + 'r119-resume-ci-'))
const source = resolve(root, 'rehearsal/reports'), archive = resolve('rehearsal/reports/R1_19_RESUME_CI_REHEARSAL')
const cpPath = 'rehearsal/reports/R1_19_RESUME_CHECKPOINT.json'
const checkpoint = JSON.parse(await readFile(cpPath, 'utf8'))
const sql = JSON.parse(await readFile(resolve(source, 'R1_18_CI_SQL.json'), 'utf8'))
assert.equal(sql.result, 'PASS'); assert.equal(sql.stacks.length, 4)
assert(sql.stacks.every(s => s.cleanup === 'PASS'))
const after = await inventory(); assert.deepEqual(after, checkpoint.docker, 'ACTUAL_PREEXISTING_INVENTORY_DRIFT')
const manifests = []
for (const name of await readdir(source)) {
  if (name === 'R1_18_CI_SQL.json' || /^R1_19_CI_(credential|inline|cnab)_PREFLIGHT\.json$/.test(name) || /^bw_email03_r110(pa|cred|inl|cnab)_\d+-(resources|suite)\.json$/.test(name)) {
    await cp(resolve(source, name), resolve(archive, name), { errorOnExist: true, force: false })
    if (name.endsWith('-resources.json')) manifests.push(JSON.parse(await readFile(resolve(source, name), 'utf8')))
  }
}
assert.equal(manifests.length, 4)
const owned = Object.fromEntries(['containers', 'volumes', 'networks'].map(k => [k, manifests.flatMap(m => m.resources[k])]))
for (const kind of Object.keys(owned)) assert(owned[kind].every(n => !after[kind].includes(n)), 'OWNED_RESOURCE_REMAINS')
const missingAtChildRecheck = manifests.filter(m => !m.projectId.includes('r110pa_')).map(m => ({ projectId: m.projectId,
  absentBaseline: Object.fromEntries(Object.keys(owned).map(k => [k, m.before[k].filter(n => !after[k].includes(n))])) }))
for (const child of missingAtChildRecheck) for (const kind of Object.keys(owned)) assert(child.absentBaseline[kind].every(n => owned[kind].includes(n)), 'FOREIGN_RESOURCE_REMOVED')
const modules = resolve(root, 'node_modules'); assert((await lstat(modules)).isSymbolicLink())
await unlink(modules) // Remove only the temporary junction, never shared node_modules.
await rm(root, { recursive: true, force: false })
const report = { at: new Date().toISOString(), result: 'FAIL_STOPPED', sqlResult: 'PASS', cleanup: 'FAIL', physicalCleanup: 'PASS',
  failure: { code: 'ERR_ASSERTION', message: 'PREEXISTING_CONTAINERS_REMOVED', stage: 'SECOND_CLEANUP_POSTFLIGHT',
    classification: 'REDUNDANT_CHILD_CLEANUP_AFTER_PARENT_REMOVAL', actualPreexistingResourcesRemoved: false },
  missingAtChildRecheck, allOwnedDockerResourcesAbsent: true, preexistingInventoryPreserved: true, temporaryCloneRemoved: true,
  guardsChanged: false, nextStep: 'Cleanup lifecycle must not rerun child postflight after its owned parent was removed. Verify already-completed manifests for physical absence against the run baseline; retain original guards. Requires fresh full rerun.', remoteWrites: 0 }
await writeFile('rehearsal/reports/R1_19_RESUME_CI_SQL_REHEARSAL.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ result: report.result, sql: 'PASS', physicalCleanup: 'PASS', preexistingInventory: 'PRESERVED' }))
