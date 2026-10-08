import assert from 'node:assert/strict'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { requireR118Bootstrap } from './r1-18-bootstrap-gate.mjs'
import { verifyPreservation } from './r1-18-preservation.mjs'
import { hash } from './r1-4-restorer.mjs'
import { sanitizedLocalEnvironment, redactCommandOutput } from '../../perf9e/clean-room-lib.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
await requireR118Bootstrap()
const dir = 'rehearsal/reports/'
const read = async name => JSON.parse(await readFile(dir + name + '.json', 'utf8'))
const supplemental = await read('R1_18_SUPPLEMENTAL_SUITES')
assert.equal(supplemental.result, 'PASS')
const manifest = await read('R1_5_MANIFESTS')
const forwards = [...(await read('R1_16_FORWARD_MANIFEST')).entries, (await read('R1_16_AUTH_FORWARD_MANIFEST')).entry]
assert.equal(forwards.length, 8)
for (const m of forwards) assert.equal(hash(await readFile(m.path)), m.sha256)
const finalManifest = { at: new Date().toISOString(), result: 'PASS', sourceManifestHash: hash(await readFile(dir + 'R1_5_MANIFESTS.json')), forwards, paths: Object.fromEntries(Object.entries(manifest).filter(([, p]) => p.applyOrder).map(([key, p]) => [key, { canonicalApplyOrder: p.applyOrder, finalApplyOrder: [...p.applyOrder, ...forwards.map(f => f.version)], exclusions: p.entries.filter(e => e.classification.endsWith('DO_NOT_APPLY')).map(e => e.version) }])), historicalMigrationsUnchanged: true }
await writeFile(dir + 'R1_18_FINAL_MIGRATION_MANIFEST.json', JSON.stringify(finalManifest, null, 2) + '\n', { flag: 'wx' })
const report = { at: new Date().toISOString(), result: 'IN_PROGRESS', stages: [], remoteCalls: 0 }
const save = () => writeFile(dir + 'R1_18_FINAL_SQL_WORKFLOW.json', JSON.stringify(report, null, 2) + '\n')
const env = sanitizedLocalEnvironment()
for (const k of Object.keys(env)) if (/SUPABASE|DATABASE|POSTGRES|SECRET|PASSWORD|TOKEN|CREDENTIAL|OPENAI/i.test(k)) delete env[k]
async function run(name, file, args) {
  const record = { name, result: 'IN_PROGRESS', startedAt: new Date().toISOString() }; report.stages.push(record); await save()
  console.log(JSON.stringify({ stage: name, result: 'STARTING' }))
  const result = await new Promise((done, reject) => {
    const p = spawn(process.execPath, ['scripts/qa/reconciliation/' + file, ...args], { env, windowsHide: true })
    let output = ''
    for (const s of [p.stdout, p.stderr]) s.on('data', b => { output += b })
    p.once('error', reject); p.once('close', code => done({ code, output }))
  })
  const log = dir + 'R1_18_' + name + '.log'
  await writeFile(log, redactCommandOutput(result.output), { flag: 'wx' })
  Object.assign(record, { result: result.code === 0 ? 'PASS' : 'FAIL', exitCode: result.code, finishedAt: new Date().toISOString(), log })
  await save(); console.log(JSON.stringify(record))
  assert.equal(result.code, 0, 'FINAL_SQL_STOP:' + name)
}
async function aliasLatest(pattern, target) {
  const files = (await readdir(dir)).filter(f => pattern.test(f)).sort(); assert.equal(files.length, 1, 'AMBIGUOUS_REPORT:' + target)
  const bytes = await readFile(dir + files[0]); await writeFile(dir + target + '.json', bytes, { flag: 'wx' }); return JSON.parse(bytes)
}
try {
  await run('DUPLICATA_AUTH_RUN', 'r1-16-auth-probe.mjs', ['--candidate', '--local-only', '--r118'])
  const auth = await aliasLatest(/^R1_18_AUTH_CANDIDATE_\d+\.json$/, 'R1_18_DUPLICATA_AUTH')
  assert.equal(auth.result, 'PASS'); assert.equal(auth.cases.length, 20); assert.equal(auth.cases.filter(c => c.result === 'ALLOW').length, 7); assert.deepEqual(auth.unexpected, [])
  await run('UPGRADES_RUN', 'r1-full-upgrades.mjs', ['--local-only', '--r118final'])
  const upgrades = await read('R1_18_FINAL_FULL_UPGRADES'); assert.equal(upgrades.result, 'PASS')
  for (const p of upgrades.paths) await writeFile(dir + 'R1_18_' + p.name.toUpperCase() + '_FINAL.json', JSON.stringify(p, null, 2) + '\n', { flag: 'wx' })
  await run('CLEANROOM_RUN', 'r1-full-upgrades.mjs', ['--local-only', '--r118final', '--cleanroom'])
  const clean = await read('R1_18_FINAL_CLEANROOM'); assert.equal(clean.result, 'PASS')
  await writeFile(dir + 'R1_18_CLEANROOM_FINAL.json', JSON.stringify(clean.paths[0], null, 2) + '\n', { flag: 'wx' })
  await run('RLS_RUN', 'r1-16-rls-run.mjs', ['--local-only', '--r118'])
  const rls = await aliasLatest(/^R1_18_RLS_\d+\.json$/, 'R1_18_FINAL_RLS'); assert.equal(rls.result, 'PASS_REAL_RLS_CAPTURE')
  await run('CATALOG_RUN', 'r1-16-catalog.mjs', ['--local-only', '--r118'])
  const paths = [...upgrades.paths, ...clean.paths]
  const full = { at: new Date().toISOString(), result: 'PASS', sqlChecks: paths.reduce((n, p) => n + p.tests.reduce((s, t) => s + (t.checks ?? 0), 0) + (p.notifications?.checks ?? 0), 0), failedSqlChecks: 0, fiscalScenarioGroups: paths.reduce((n, p) => n + (p.municipalChecks?.length ?? 0), 0), supplementalScenarioGroups: supplemental.tests.reduce((n, t) => n + t.checkCount, 0), authorizationActors: auth.cases.length, rlsComparisons: rls.comparisons.length, countingRule: 'pgTAP checks, named scenario groups, authorization actors and RLS comparisons are distinct units; not summed together' }
  await writeFile(dir + 'R1_18_FULL_SQL.json', JSON.stringify(full, null, 2) + '\n', { flag: 'wx' })
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL_STOPPED'; report.failure = { message: redactCommandOutput(error.message), code: error.code }; process.exitCode = 1 }
finally {
  report.preservation = await verifyPreservation(['r1-17-bootstrap-observer.mjs', 'r1-16-extra-sql.mjs', 'r1-full-upgrades.mjs', 'r1-16-auth-probe.mjs', 'r1-16-rls-run.mjs', 'r1-16-catalog.mjs'].map(f => 'scripts/qa/reconciliation/' + f))
  await save()
}
console.log(JSON.stringify({ result: report.result, stages: report.stages, failure: report.failure }))
