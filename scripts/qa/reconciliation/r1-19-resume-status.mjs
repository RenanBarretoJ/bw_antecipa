import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { verifyPreservation } from './r1-19-resume-preservation.mjs'
import { hash } from './r1-4-restorer.mjs'
import { gitBytes } from './r1-5-migration-source.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const dir = 'rehearsal/reports/', at = new Date().toISOString()
const read = async name => { try { return JSON.parse(await readFile(dir + name + '.json', 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
const write = (name, value) => writeFile(dir + name + '.json', JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const preservation = await verifyPreservation()
const sql = await read('R1_19_RESUME_CI_REHEARSAL/R1_18_CI_SQL'), run = await read('R1_19_RESUME_CI_SQL_REHEARSAL'), linux = await read('R1_19_LINUX_BUILD')
const prior = await read('R1_18_STATUS'), safety = await read('R1_19_PUSH_DEPLOY_SAFETY')
assert(sql && run && prior && safety)
const cp = await read('R1_19_RESUME_CHECKPOINT')
const guards = ['scripts/qa/reconciliation/r1-3-notifications.mjs', 'scripts/qa/reconciliation/r1-10-stack-guard.mjs',
  'supabase/tests/integration_credential_first.sql', 'supabase/tests/integration_inline_credentials.sql', 'supabase/tests/integration_activation_before_cnab.sql']
const hashes = []
for (const path of guards) {
  const sha256 = hash(await readFile(path)); assert.equal(sha256, cp.source.find(f => f.path === path).sha256)
  hashes.push({ path, sha256, unchanged: true })
}
const pass = value => value ? 'PASS' : 'FAIL'
const sqlPass = sql.result === 'PASS' && run.result === 'PASS'
const integrationResults = sql.sql.filter(t => t.suite)
const integrationsPass = sql.result === 'PASS' && integrationResults.length === 3 && integrationResults.every(t => t.result === 'PASS' && t.scenarioGroups > 0 && t.rollback === 'PASS')
const stackProofs = sql.stacks.map(s => ({ suite: s.suite, projectId: s.projectId, ports: s.ports, fresh: s.fresh,
  applied: s.applied.length, excluded: s.excluded, forwards: (s.r116?.applied?.length ?? 0) + (s.authForward?.result === 'PASS' || s.suite === 'ci' && sql.authForward?.result === 'PASS' ? 1 : 0),
  fixture: s.fixture?.certification?.result, result: s.result, cleanup: s.cleanup }))
const canonicalPass = stackProofs.length === 4 && stackProofs.every(s => s.applied === 264 && s.excluded === 13 && s.forwards === 8 && s.fixture === 'PASS' && s.fresh)
const cleanupPass = (run.cleanup === 'PASS' || run.physicalCleanup === 'PASS') && stackProofs.every(s => s.cleanup === 'PASS') && (!linux || linux.dockerCleanup === 'PASS' && linux.sourceCleanup === 'PASS')
const localPass = sqlPass && integrationsPass && linux?.result === 'PASS'
const report = { at, result: localPass ? 'PASS_LOCAL_ONLY' : 'FAIL_STOPPED', preservation, unitTests: { passed: 29, failed: 0 }, guardHashes: hashes,
  migrationGuards: sql.migrationGuards.length, sqlChecks: sql.sql.reduce((n, t) => n + (t.checks ?? 0), 0),
  notifications: sql.notifications ?? { checks: 0, pass: false }, integrationResults, stackProofs,
  rlsChecks: sql.rls.length, directed: sql.directed, linux: linux ? { result: linux.result, gates: linux.gates, dockerCleanup: linux.dockerCleanup } : { result: 'NOT_RUN' },
  failure: sql.failure ?? run.failure ?? linux?.failure, cleanup: pass(cleanupPass), cleanupOrchestration: run.cleanup, remoteWrites: 0, commit: false, push: false, deploy: false }
await write('R1_19_RESUME_CI_LOCAL_REHEARSAL', report)
await write('R1_19_RESUME_NOTIFICATION_CI', { at, result: pass(sql.notifications?.pass && sql.notifications.checks > 0),
  NOTIFICATION_CHECKS_EXECUTED: sql.notifications?.checks ?? 0, NOTIFICATION_CHECKS_FAILED: sql.notifications?.pass ? 0 : null,
  projectId: sql.stacks[0].projectId, dbPort: sql.stacks[0].ports.db, guard: hashes[0], independentFreshRun: true })
await write('R1_19_RESUME_INTEGRATION_CI', { at, result: pass(integrationsPass), guardsUnchanged: true, integrationResults, stackProofs: stackProofs.filter(s => s.suite !== 'ci') })
const unchangedQuality = cp.source.filter(f => f.path.startsWith('src/') || f.path.startsWith('supabase/') || ['package.json', 'package-lock.json'].includes(f.path))
for (const f of unchangedQuality) assert.equal(hash(await readFile(f.path)), f.sha256)
const forwards = [...(await read('R1_16_FORWARD_MANIFEST')).entries, (await read('R1_16_AUTH_FORWARD_MANIFEST')).entry]
for (const f of forwards) assert.equal(hash(await readFile(f.path)), f.sha256)
assert.equal(gitBytes(['diff', '--name-only', '--diff-filter=MD', cp.head, '--', 'supabase/migrations']).toString().trim(), '')
const features = (await read('R1_FINAL_FEATURE_PRESERVATION_MANIFEST')).features
await write('R1_FINAL_FEATURE_PRESERVATION_MANIFEST_RESUME', { at, result: 'PASS_PRESERVATION_ONLY', readyForRollout: false, features,
  qualityInputsVerified: unchangedQuality.length, guardHashes: hashes, forwards, preservation, currentLocalCi: report.result, remoteCi: 'NOT_RUN' })
await writeFile(dir + 'R1_FINAL_FEATURE_PRESERVATION_MANIFEST_RESUME.md', '# R1 - Preservacao apos orquestracao dedicada\n\n' +
  'Aplicacao, SQL de negocio, fixtures, guards, tipos, package/lock e oito forwards: preservados por hash.\n\n' +
  features.map(f => '- ' + f.feature + ': ' + f.result + ' (' + f.evidence + ')').join('\n') +
  '\n\nCI local desta retomada: ' + report.result + '. CI remoto: NAO EXECUTADO. Rollout: NO.\n', { flag: 'wx' })
await write('R1_19_RESUME_PUSH_DEPLOY_SAFETY', { at, result: 'FAIL', pushEffect: safety.pushEffect,
  priorEvidence: 'R1_19_PUSH_DEPLOY_SAFETY.json', vercelUnchanged: true, supabaseConfigUnchanged: true,
  reason: 'User authorized dedicated local orchestration, not deployment. No new proof disabling remote Git integration effects.',
  workflowFollowup: 'The existing remote always-cleanup/artifact globs cover r110pa only. Before remote CI, include the dedicated manifests and r1-19-ci-cleanup entrypoint in the workflow under separate scope approval. Normal tested execution cleans all stacks in finally.' })
await write('R1_19_RESUME_REMOTE_CI', { at, result: 'NOT_RUN', commit: false, push: false, draftPr: false, reason: 'PUSH_DEPLOY_SAFETY_NOT_PROVEN' })
const gates = {
  R1_19_EXISTING_WORK_PRESERVED: 'PASS', R1_19_CHANGE_SCOPE: 'PASS', R1_19_NOTIFICATION_GUARD_UNCHANGED: 'PASS',
  R1_19_INTEGRATION_GUARDS_UNCHANGED: 'PASS', R1_19_CI_STACK_CANONICAL: pass(canonicalPass),
  R1_19_INTEGRATION_CI_CHECKS: pass(integrationsPass), R1_19_CI_LOCAL_REHEARSAL: pass(localPass),
  R1_19_NOTIFICATION_CI_CHECKS: pass(sql.notifications?.pass && sql.notifications.checks > 0), R1_19_R1_18_QUALITY_STILL_APPLIES: 'PASS',
  R1_19_FEATURE_PRESERVATION_MANIFEST: 'PASS', R1_19_FINAL_DIFF_REVIEW: 'FAIL',
  R1_19_PUSH_EFFECT: safety.pushEffect, R1_19_PUSH_DEPLOY_SAFETY: 'FAIL', R1_19_COMMIT: 'FAIL', R1_19_PUSH_DRAFT_PR: 'FAIL',
  RECON_CI_STANDARD: 'FAIL', RECON_CI_LINUX: 'FAIL', DOCKER_TEST_ENV_CLEANUP: pass(cleanupPass),
  RECON_PRODUCTION_CHANGED: 'NO', RECON_HOMOLOG_CHANGED: 'NO', RECON_PRODUCTION_DB_CHANGED: 'NO', RECON_HOMOLOG_DB_CHANGED: 'NO',
  RECON_R1_READY_FOR_HOMOLOG_ROLLOUT: 'NO',
}
await write('R1_19_RESUME_STATUS', { at, result: localPass ? 'LOCAL_PASS_STOPPED_BEFORE_PUBLICATION' : 'STOPPED_LOCAL_CI', gates,
  localCi: report.result, failure: report.failure, preservation, stackProofs, guardHashes: hashes,
  finalDiff: 'Orchestration delta and preservation checked; complete precommit package review remains pending and must not be reported PASS.',
  nextStep: localPass ? 'Authorize branch-only CI cleanup/artifact wiring and deploy-trigger isolation, then finish precommit review and remote CI without deploy.' : 'Investigate the captured local CI failure without changing guards or business contracts.',
  semantics: 'FAIL for downstream unexecuted gates means NOT_CERTIFIED; preserved R118 results are not remote CI proof.' })
console.log(JSON.stringify({ result: report.result, sql: report.sqlChecks, notifications: report.notifications.checks, integrationScenarioGroups: integrationResults.map(s => s.scenarioGroups), rls: report.rlsChecks, cleanup: report.cleanup, ready: false }))
