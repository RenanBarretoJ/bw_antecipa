import assert from 'node:assert/strict'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { verifyPreservation } from './r1-19-preservation.mjs'
import { hash } from './r1-4-restorer.mjs'
import { gitBytes } from './r1-5-migration-source.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const dir = 'rehearsal/reports/'
const read = async name => JSON.parse(await readFile(dir + name + '.json', 'utf8'))
const write = (name, value) => writeFile(dir + name + '.json', JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const at = new Date().toISOString(), preservation = await verifyPreservation()
const prior = await read('R1_18_STATUS'), sql = await read('R1_19_CI_REHEARSAL/R1_18_CI_SQL')
const rehearsal = await read('R1_19_CI_SQL_REHEARSAL'), stack = sql.stacks[0]
const owned = await read('R1_19_CI_REHEARSAL/' + stack.projectId + '-resources')
assert.equal(sql.result, 'FAIL_STOPPED'); assert.equal(sql.failure.message, 'Somente rehearsal local dedicado')
assert.equal(sql.failure.code, 'P0001'); assert.equal(rehearsal.cleanup, 'PASS')
assert.equal(stack.ports.db, 57942); assert.equal(stack.applied.length, 264); assert.equal(stack.excluded, 13)
assert.equal(stack.r116.applied.length, 7); assert.equal(sql.authForward.result, 'PASS')
assert.equal(stack.fixture.certification.result, 'PASS'); assert.equal(stack.cleanup, 'PASS')
assert.equal(sql.notifications.pass, true); assert.equal(sql.notifications.checks, 111)
const forwardManifest = await read('R1_16_FORWARD_MANIFEST'), authManifest = await read('R1_16_AUTH_FORWARD_MANIFEST')
const forwards = [...forwardManifest.entries, authManifest.entry]
assert.equal(forwards.length, 8)
for (const f of forwards) assert.equal(hash(await readFile(f.path)), f.sha256)
assert.equal(authManifest.entry.sha256, '49f2ee6142cfdd040e62a4d45e8e05897d3169392252a880baf3091a1b800430')
const sacado = 'supabase/migrations/20261005173648_sacado_rls_non_sacado_short_circuit.sql'
assert.equal(hash(await readFile(sacado)), '1006e35b48f871c4f14a72f7a3f2045b1f40c13f4bb80d7efeda0e26be8df3ac')
const historicalChanges = gitBytes(['diff', '--name-only', '--diff-filter=MD', '2e8146ebe7582c5bdc10ddee1f8862d806607ee2', '--', 'supabase/migrations']).toString().trim()
assert.equal(historicalChanges, '')
const blocker = { classification: 'CI_INTEGRATION_SUITE_DEDICATED_REHEARSAL_CONTRACT_MISMATCH',
  caller: 'scripts/qa/reconciliation/r1-18-ci.mjs:67', rejectingGuard: 'supabase/tests/integration_credential_first.sql:4',
  database: 'postgres', actualApplicationName: owned.portContract.spec.applicationName,
  acceptedPostgresApplicationName: '^r110_cred_[0-9]{13}$', failure: sql.failure,
  stage: 'First integration suite, before BEGIN and before fixture DML', notificationRegression: false,
  businessRegressionProven: false, guardChanged: false, fixtureChanged: false,
  nextStep: 'Separate credential/inline/CNAB into genuinely owned dedicated canonical stacks matching their existing guards; do not relabel this shared connection or broaden fixtures. Rerun full CI on fresh resources after approval.' }
await write('R1_19_PORT_ORCHESTRATION', { at, result: 'PASS', projectId: stack.projectId, dbPort: stack.ports.db, apiPort: stack.ports.api,
  preflight: owned.portContract, createdAt: owned.createdAt, resources: owned.resources, canonicalMigrations: 264, exclusions: 13,
  forwards: forwards.map(({ path, sha256 }) => ({ path, sha256 })), fixture: stack.fixture.certification.result,
  ownership: 'PASS', localOnlyGuard: 'PASS', cleanup: 'PASS', allocatorUnitTests: { passed: 18, failed: 0 } })
await write('R1_19_NOTIFICATION_CI', { at, result: 'PASS', NOTIFICATION_CHECKS_EXECUTED: 111, NOTIFICATION_CHECKS_FAILED: 0,
  guardSha256: hash(await readFile('scripts/qa/reconciliation/r1-3-notifications.mjs')), guardUnchanged: true,
  dbPort: stack.ports.db, projectId: stack.projectId, evidence: sql.notifications.evidence })
await write('R1_19_CI_LOCAL_REHEARSAL', { at, result: 'FAIL_STOPPED', migrationGuards: sql.migrationGuards.length,
  sqlChecksPassed: sql.sql.reduce((n, t) => n + (t.checks ?? 0), 0), notificationChecksPassed: 111, p16: sql.p16,
  integrationScenarioGroups: 0, rlsChecksInThisAttempt: sql.rls.length, blocker,
  linuxQualityRerun: 'NOT_RUN_STOP_RULE', priorR118Quality: 'PRESERVED_NOT_SUBSTITUTED_FOR_CURRENT_CI', cleanup: 'PASS' })
const features = []
for (const feature of ['P16', 'SACADO', 'HEALTH_RLX', 'C5_A6', 'NOTIFICATIONS', 'INTEGRATIONS', 'GUIBOR', 'TAXAS', 'DUPLICATA']) {
  assert.equal(prior.gates['R1_18_' + feature], 'PASS')
  features.push({ feature, result: 'PASS_PRESERVED', evidence: 'R1_18_STATUS.json', gate: 'R1_18_' + feature })
}
for (const [feature, evidence] of [
  ['Canonical fiscal identity, NFSe municipal, review/frozen facts, net calculation', 'R1_18_FULL_SQL'],
  ['ACL 57 relations and structure, escrow, timestamps, origin, taxas constraints/index', 'R1_18_FINAL_CONTRACTS'],
  ['Real RLS delegation, ownership, fund isolation and LEITOR', 'R1_18_FINAL_RLS'],
  ['Duplicata authorization fail-closed, audit and idempotence', 'R1_18_DUPLICATA_AUTH'],
  ['Three-way catalog and encoding compatibility', 'R1_18_TARGET_CATALOG'],
  ['RLX producers, credentials, inline rotation, activation before CNAB', 'R1_18_SUPPLEMENTAL_SUITES'],
  ['Runtime, types, package-lock, sharp, PDF, TypeScript, full tests and lint', 'R1_18_FINAL_QUALITY'],
  ['Linux Node 22 build', 'R1_18_LINUX_BUILD'],
]) {
  const report = await read(evidence)
  assert(['PASS', 'PASS_REAL_RLS_CAPTURE'].includes(report.result), evidence)
  features.push({ feature, result: 'PASS_PRESERVED', evidence: evidence + '.json', sha256: hash(await readFile(dir + evidence + '.json')) })
}
const featureManifest = { at, result: 'PASS_PRESERVATION_ONLY', releaseReady: false, preservation, features, forwards,
  unchangedInputs: ['src/types/database.ts', 'package.json', 'package-lock.json', 'src/**', 'supabase/**'],
  scope: 'Evidence and application hashes preserved; this is not a completed CI/release certification.' }
await write('R1_FINAL_FEATURE_PRESERVATION_MANIFEST', featureManifest)
await writeFile(dir + 'R1_FINAL_FEATURE_PRESERVATION_MANIFEST.md', '# R1 - Manifest de preservacao\n\nResultado: PASS de preservacao. Certificacao final de CI: pendente; rollout: NO.\n\n' +
  features.map(f => '- ' + f.feature + ': ' + f.result + ' (' + f.evidence + ')').join('\n') +
  '\n\nOito forwards e todos os arquivos/evidencias anteriores permanecem byte-identicos. A unica alteracao de arquivo preexistente neste R1.19 e a troca do alocador em r1-18-ci.mjs. Helpers R1.19 novos sao isolados.\n\n307 checks SQL e 111 checks de notificacoes passaram nesta tentativa nova. Parada posterior: guard da primeira suite de integracoes. Nenhum resultado parcial equivale a CI completo.\n', { flag: 'wx' })
const workflows = []
for (const name of await readdir('.github/workflows')) workflows.push({ path: '.github/workflows/' + name, sha256: hash(await readFile('.github/workflows/' + name)) })
await write('R1_19_PUSH_DEPLOY_SAFETY', { at, result: 'FAIL', pushEffect: 'REMOTE_DEPLOY_POSSIBLE', workflows,
  githubWorkflows: 'Inspected CI and branch filters: no explicit deploy job in these workflows.',
  vercel: { branchBlocked: false, explicitBlock: 'validation/rlx-email04-linux only',
    documentedDefault: 'Unspecified branch deploymentEnabled=true', source: 'https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled' },
  supabase: { branchExclusionProven: false, gitIntegrationStatus: 'UNKNOWN',
    source: 'https://supabase.com/docs/guides/deployment/branching/github-integration', config: 'No reconciliation branch exception; other branch exceptions do not apply.' },
  githubHookRead: { result: 'HTTP_404', permission: 'admin:repo_hook unavailable; cannot infer absence of hooks or GitHub Apps' },
  conclusion: 'CI_ONLY cannot be proven. No commit, push or draft PR. No deployment/integration settings changed.' })
await write('R1_19_FINAL_DIFF', { at, result: 'NOT_COMPLETED_STOP_RULE', historicalMigrationEdits: [],
  finalForwards: forwards.map(({ path, sha256 }) => ({ path, sha256 })), sacadoArtifact: { path: sacado, bytes: 'EXACT', commitStatus: 'UNTRACKED_NOT_COMMITTED' },
  scopeCheck: preservation, runtimeBusinessCodeChangedThisTurn: false, fixturesChangedThisTurn: false,
  fullSecretAndReleaseArtifactReview: 'NOT_COMPLETED_AFTER_CI_STOP', safeToCommit: false })
await write('R1_19_REMOTE_CI', { at, result: 'NOT_RUN', reason: 'LOCAL_CI_FAILED_AND_PUSH_SAFETY_NOT_PROVEN', commit: false, push: false, draftPr: false, remoteWrites: 0 })
const gates = {
  R1_19_EXISTING_WORK_PRESERVED: 'PASS', R1_19_CHANGE_SCOPE: 'PASS', R1_19_NOTIFICATION_GUARD_UNCHANGED: 'PASS',
  R1_19_ALLOWED_PORT_AVAILABLE: 'PASS', R1_19_CI_STACK_OWNERSHIP: 'PASS', R1_19_LOCAL_ONLY_GUARD: 'PASS', R1_19_CI_STACK_CANONICAL: 'PASS',
  R1_19_CI_LOCAL_REHEARSAL: 'FAIL', R1_19_NOTIFICATION_CI_CHECKS: 'PASS', R1_19_R1_18_QUALITY_STILL_APPLIES: 'PASS',
  R1_19_FEATURE_PRESERVATION_MANIFEST: 'PASS', R1_19_FINAL_DIFF_REVIEW: 'FAIL', R1_19_PUSH_EFFECT: 'REMOTE_DEPLOY_POSSIBLE',
  R1_19_PUSH_DEPLOY_SAFETY: 'FAIL', R1_19_COMMIT: 'FAIL', R1_19_PUSH_DRAFT_PR: 'FAIL', RECON_CI_STANDARD: 'FAIL', RECON_CI_LINUX: 'FAIL',
  DOCKER_TEST_ENV_CLEANUP: 'PASS', RECON_PRODUCTION_CHANGED: 'NO', RECON_HOMOLOG_CHANGED: 'NO', RECON_PRODUCTION_DB_CHANGED: 'NO',
  RECON_HOMOLOG_DB_CHANGED: 'NO', RECON_R1_READY_FOR_HOMOLOG_ROLLOUT: 'NO',
}
await write('R1_19_STATUS', { at, result: 'STOPPED_INTEGRATION_REHEARSAL_GUARD', gates, blocker, preservation,
  gateSemantics: 'FAIL for downstream unexecuted gates means NOT_CERTIFIED, not a proven functional regression.',
  previousR118FunctionalEvidence: 'Preserved by hash; not counted as R119 CI execution', remoteWrites: 0,
  cleanup: 'Only R119 containers/volumes/network and disposable clone removed; all preexisting Docker resources preserved.' })
console.log(JSON.stringify({ result: 'STOPPED_INTEGRATION_REHEARSAL_GUARD', notifications: 111, sql: 307, preservation: preservation.result, cleanup: 'PASS', ready: false }))
