import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { freshStack } from './r1-10-fresh-stack.mjs'
import { hash } from './r1-4-restorer.mjs'
import { localStorageFixture } from './r1-2-storage.mjs'
import { verifyFiscalFencing } from '../../email-intake/fencing-db.mjs'
import { installReserveTrace } from './r1-12-trace.mjs'
import { directedControls } from './r1-12-controls.mjs'
assert.equal(process.argv[2], '--local-only')
const mode = process.argv[3]; assert(['trace-original', 'controls', 'operational'].includes(mode)); assert.equal(process.argv.length, 4)
const checkpoint = JSON.parse(await readFile('rehearsal/reports/R1_12_CHECKPOINT.json', 'utf8'))
const source = await readFile('scripts/email-intake/lifecycle-db.mjs', 'utf8')
if (mode !== 'operational') assert.equal(source, checkpoint.lifecycleSource, 'FIXTURE_CHANGED_BEFORE_PROOF')
else {
  const controls = JSON.parse(await readFile('rehearsal/reports/R1_12_FISCAL_IDENTITY_CONTROLS.json', 'utf8'))
  assert.equal(controls.result, 'PASS')
  assert.equal(source, checkpoint.lifecycleSource.replace("'9'.repeat(50)", "'1234567890'.repeat(5)"), 'NON_MINIMAL_FIXTURE_CHANGE')
}
const name = { 'trace-original': 'R1_12_EXACT_CALL_TRACE', controls: 'R1_12_FISCAL_IDENTITY_CONTROLS', operational: 'R1_12_OPERATIONAL_SUITE' }[mode]
const path = `rehearsal/reports/${name}.json`
const report = { at: new Date().toISOString(), mode, result: 'IN_PROGRESS', stacks: [], calls: [], checks: [], sourceHash: hash(source) }
const save = () => writeFile(path, JSON.stringify(report, null, 2) + '\n')
await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
const setupSource = await readFile('supabase/tests/c2_1_r2_fluxo_taxa.test.sql', 'utf8')
const setup = setupSource.match(/DO \$setup\$[\s\S]*?\$setup\$;/)?.[0]; assert(setup)
const boundary = setup.indexOf('  INSERT INTO public.notas_fiscais ('); assert(boundary > 0)
const parentSetup = setup.slice(0, boundary) + 'END;\n$setup$;'
let s, restoreTrace
try {
  s = await freshStack('operational', report.stacks)
  s.evidence.stage = 'R1_12:' + mode
  restoreTrace = installReserveTrace(s.connection, report.calls, save)
  if (mode === 'controls') {
    const trace = JSON.parse(await readFile('rehearsal/reports/R1_12_EXACT_CALL_TRACE.json', 'utf8'))
    assert.equal(trace.result, 'PASS_EXPECTED_FAILURE_REPRODUCED')
    await directedControls(s, parentSetup, report, save)
    report.result = 'PASS'
  } else {
    if (mode === 'operational') {
      await assert.rejects(s.db.query('select private.fiscal_identity_material($1,$2)', ['NFSE', '9'.repeat(50)]), e => e.code === '22023' && e.message === 'FISCAL_IDENTITY_INVALID')
      const key = '1234567890'.repeat(5)
      assert.equal((await s.db.query('select private.fiscal_identity_material($1,$2) result', ['NFSE', key])).rows[0].result, key)
      report.afterFixtureIdentityControls = 'PASS_POSITIVE_AND_NEGATIVE'
    }
    try {
      report.checks = await verifyFiscalFencing(s.db, s.connection, parentSetup, localStorageFixture(s.local, s.spec.projectId, s.connection))
      assert.equal(mode, 'operational', 'ORIGINAL_FAILURE_NOT_REPRODUCED')
      report.result = 'PASS'
    } catch (e) {
      if (mode !== 'trace-original') throw e
      const call = report.calls.at(-1)
      assert.equal(e.code, '22023'); assert.equal(e.message, 'FISCAL_IDENTITY_INVALID')
      assert.match(call.caller, /lifecycle-db\.mjs:15:/)
      assert.equal(call.documentType, 'NFSE'); assert.equal(call.length, 50); assert.equal(call.allSameDigit, true)
      assert.equal(call.actorMode, 'SYSTEM'); assert.equal(call.sha256, hash('9'.repeat(50)))
      report.failure = { code: e.code, message: e.message, where: e.where }
      report.result = 'PASS_EXPECTED_FAILURE_REPRODUCED'
    }
  }
  s.evidence.result = report.result; s.evidence.checks = report.checks
} catch (e) {
  report.result = 'FAIL'; report.failure = { code: e.code ?? 'ASSERTION', message: e.message, where: e.where, stack: e.stack?.split('\n').slice(0, 6) }
  if (s) { s.evidence.result = 'FAIL'; s.evidence.failure = report.failure }
  process.exitCode = 1
} finally {
  restoreTrace?.()
  if (s) { await s.db.query('ROLLBACK').catch(() => {}); await s.close() }
  await save()
}
console.log(JSON.stringify({ mode, result: report.result, checks: report.checks.length, lastCall: report.calls.at(-1), failure: report.failure }))
