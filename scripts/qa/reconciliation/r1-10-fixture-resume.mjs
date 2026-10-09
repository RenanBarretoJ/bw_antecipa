// Fixture-only resumption; prior evidence is immutable. No remote connections.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { freshStack } from './r1-10-fresh-stack.mjs'
import { verifyEmailOperators } from '../../email-intake/operators-db.mjs'
import { verifyEmailAutomation } from '../../email-intake/automation-db.mjs'
import { verifyEmailTemporalAdmission } from '../../email-intake/temporal-db.mjs'
import { verifyFiscalFencing } from '../../email-intake/fencing-db.mjs'
import { inventory } from '../../email-intake/disposable-resources.mjs'
import { localStorageFixture } from './r1-2-storage.mjs'
import { hash } from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2), ['--local-only'])
const read = p => readFile(p, 'utf8')
const checkpoint = JSON.parse(await read('rehearsal/reports/R1_10_FIXTURE_CHECKPOINT.json'))
assert.equal(JSON.parse(await read('rehearsal/reports/R1_10_STACK_HARNESS.json')).result, 'PASS')
const report = { at: new Date().toISOString(), result: 'IN_PROGRESS', method: 'FRESH_STACK',
  planned: ['credential', 'inline', 'cnab', 'operators', 'automation', 'temporal', 'operational'], stacks: [], tests: [],
  fixtureChanges: [], remoteChanges: false, remainingGates: 'NOT_RUN' }
const path = 'rehearsal/reports/R1_10_FIXTURE_RESUME.json'
const save = () => writeFile(path, JSON.stringify(report, null, 2) + '\n')
async function preservation() {
  for (const f of checkpoint.files) {
    const content = await readFile(f.path)
    if (f.path.startsWith('supabase/tests/') && Object.hasOwn(checkpoint.fixtures, f.path)) {
      const before = checkpoint.fixtures[f.path], after = content.toString('utf8')
      const boundary = 'INSERT INTO public.usuario_papeis'
      assert.equal(after.slice(after.indexOf(boundary)), before.slice(before.indexOf(boundary)), 'SCENARIO_ASSERTIONS_CHANGED:' + f.path)
      const start = 'INSERT INTO public.profiles'
      assert.equal(after.slice(0, before.indexOf(start)), before.slice(0, before.indexOf(start)), 'AUTH_SETUP_CHANGED:' + f.path)
      assert(!/INSERT INTO public\.profiles|DELETE FROM public\.profiles|UPDATE public\.profiles|ON CONFLICT/.test(after))
      assert(after.includes('pg_temp.assert_integration_auth_profile(actual,expected)'))
      assert(after.includes('pg_temp.assert_integration_auth_profile(candidate,expected)'))
    } else assert.equal(hash(content), f.sha256, 'UNRELATED_FILE_CHANGED:' + f.path)
  }
  for (const f of checkpoint.reports) assert.equal(hash(await readFile(f.path)), f.sha256, 'OLD_EVIDENCE_CHANGED:' + f.path)
  assert.deepEqual(await inventory(), checkpoint.docker, 'PREEXISTING_DOCKER_CHANGED')
  return 'PASS'
}
report.preservationBefore = await preservation()
for (const [file, before] of Object.entries(checkpoint.fixtures).filter(([file]) => file.startsWith('supabase/tests/'))) report.fixtureChanges.push({ file, before: hash(before), after: hash(await readFile(file)), assertions: 'BYTE_IDENTICAL', profileUpdate: 'NONE', initialState: 'cedente/ativo; no security overrides', scenarioRole: 'super_admin via unchanged usuario_papeis fixture' })
await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
try {
  for (const suite of report.planned) {
    const s = await freshStack(suite, report.stacks)
    try {
      s.evidence.stage = 'SQL_SUITE:' + suite
      if (['operators', 'automation', 'temporal'].includes(suite)) {
        await s.db.query(await read('supabase/tests/fixtures/guibor_a5_a6.sql'))
        s.evidence.checks = await ({ operators: verifyEmailOperators, automation: verifyEmailAutomation, temporal: verifyEmailTemporalAdmission }[suite])(s.db, s.connection)
      } else if (suite === 'operational') {
        const fixture = await read('supabase/tests/c2_1_r2_fluxo_taxa.test.sql'), setup = fixture.match(/DO \$setup\$[\s\S]*?\$setup\$;/)?.[0]
        assert(setup)
        const boundary = setup.indexOf('  INSERT INTO public.notas_fiscais ('); assert(boundary > 0)
        s.evidence.checks = await verifyFiscalFencing(s.db, s.connection, setup.slice(0, boundary) + 'END;\n$setup$;', localStorageFixture(s.local, s.spec.projectId, s.connection))
      } else {
        const file = { credential: 'integration_credential_first.sql', inline: 'integration_inline_credentials.sql', cnab: 'integration_activation_before_cnab.sql' }[suite]
        const sql = await read('supabase/tests/' + file)
        s.evidence.file = file; s.evidence.sqlHash = hash(sql)
        s.db.on('notice', n => { if (/^PASS /.test(n.message)) s.evidence.checks.push(n.message) })
        await s.db.query(sql.replace(/^\\set.*$/mg, ''))
        assert(s.evidence.checks.some(n => n.startsWith('PASS fixture negative controls')))
      }
      s.evidence.result = 'PASS'
      report.tests.push({ suite, stackId: s.spec.projectId, result: 'PASS', checks: s.evidence.checks, checkCount: s.evidence.checks.length, checkUnit: 'named scenario groups' })
    } catch (e) {
      s.evidence.result = 'FAIL'
      s.evidence.failure = { code: e.code ?? 'ASSERTION', message: e.message, where: e.where, position: e.position, stage: s.evidence.stage }
      report.tests.push({ suite, stackId: s.spec.projectId, result: 'FAIL', checks: s.evidence.checks, failure: s.evidence.failure })
      throw e
    } finally { await s.db.query('ROLLBACK').catch(() => {}); await s.close(); await save() }
  }
  report.result = 'PASS'
} catch (e) {
  report.result = 'STOPPED'
  report.failure = { code: e.code ?? 'ASSERTION', message: e.message, where: e.where, position: e.position }
  report.stopRule = 'Do not reinterpret the next failure as a fixture defect; investigate read-only and stop.'
  process.exitCode = 1
} finally {
  try { report.preservationAfter = await preservation() }
  catch (e) { report.preservationAfter = 'FAIL'; report.preservationError = e.message; process.exitCode = 1 }
  await save()
}
console.log(JSON.stringify({ result: report.result, tests: report.tests.map(t => ({ suite: t.suite, result: t.result })), failure: report.failure, preservation: report.preservationAfter }))
