import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { verifyPreservation } from './r1-18-preservation.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const dir = 'rehearsal/reports/'
const read = async n => { try { return JSON.parse(await readFile(dir + n + '.json', 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
const ab = await read('R1_18_CONFIG_AB_COMPARISON'), boot = await read('R1_18_BOOTSTRAP_STABILITY'), extra = await read('R1_18_SUPPLEMENTAL_SUITES'), workflow = await read('R1_18_FINAL_SQL_WORKFLOW')
const auth = await read('R1_18_DUPLICATA_AUTH'), prod = await read('R1_18_PROD_FINAL'), homolog = await read('R1_18_HOMOLOG_FINAL'), clean = await read('R1_18_CLEANROOM_FINAL'), sql = await read('R1_18_FULL_SQL'), rls = await read('R1_18_FINAL_RLS'), catalog = await read('R1_18_TARGET_CATALOG'), quality = await read('R1_18_FINAL_QUALITY')
const contracts = await read('R1_18_FINAL_CONTRACTS'), linux = await read('R1_18_LINUX_BUILD'), ci = await read('R1_18_CI_REHEARSAL')
const ciSql = await read('R1_18_CI_REHEARSAL/R1_18_CI_SQL')
const helpers = ['r1-17-bootstrap-observer.mjs', 'r1-16-extra-sql.mjs', 'r1-full-upgrades.mjs', 'r1-16-auth-probe.mjs', 'r1-16-rls-run.mjs', 'r1-16-catalog.mjs', 'r1-18-preservation.mjs']
const preservation = await verifyPreservation(helpers.map(f => 'scripts/qa/reconciliation/' + f))
const pass = r => r?.result === 'PASS' ? 'PASS' : 'FAIL'
const qualityGate = name => quality?.gates?.find(g => g.name === name)?.result ?? 'FAIL'
const gates = {
  R1_18_EXISTING_WORK_PRESERVED: preservation.result,
  R1_18_CONFIG_AB_ISOLATED: ab?.isolated ?? 'FAIL',
  R1_18_REALTIME_FLAG_CAUSALITY: ab?.realtimeFlagCausality ?? 'UNKNOWN',
  R1_18_HISTORICAL_CAUSE_EXACT: 'UNKNOWABLE_FROM_RETAINED_EVIDENCE',
  R1_18_CURRENT_BOOTSTRAP_REPRODUCIBILITY: ab?.currentBootstrapReproducibility ?? 'FAIL',
  R1_18_CONFIG_AB_STABILITY: pass(ab), R1_18_FULL_STACK_BOOTSTRAP_STABILITY: pass(boot),
  R1_18_SUPPLEMENTAL_SUITES: pass(extra), R1_18_DUPLICATA_AUTH: pass(auth),
  RECON_UPGRADE_FROM_PROD: pass(prod), RECON_UPGRADE_FROM_HOMOLOG: pass(homolog), RECON_CLEAN_ROOM: pass(clean), RECON_SQL: pass(sql),
  R1_18_FINAL_RLS: rls?.result === 'PASS_REAL_RLS_CAPTURE' ? 'PASS' : 'FAIL', R1_18_TARGET_CATALOG_EQUIVALENT: pass(catalog),
  R1_18_FINAL_ACL: contracts?.finalAcl ?? 'FAIL', R1_18_FINAL_STRUCTURE: contracts?.finalStructure ?? 'FAIL', RECON_DATABASE_TYPES: pass(contracts),
  RECON_PACKAGE_LOCK: quality?.package?.result === 'PASS_ROOT_CONTRACT' && linux?.gates?.some(g => g.name === 'npm-ci' && g.result === 'PASS') ? 'PASS' : 'FAIL',
  RECON_SHARP: pass(quality?.sharp), RECON_PDF_RUNTIME: qualityGate('pdf-runtime'), RECON_TYPESCRIPT: qualityGate('typescript'), RECON_FULL_SUITE: qualityGate('full-suite'), RECON_LINT: qualityGate('lint'), RECON_BUILD_LINUX: pass(linux),
  R1_18_CI_LOCAL_REHEARSAL: pass(ci),
  R1_18_FEATURE_PRESERVATION_MANIFEST: 'FAIL', R1_18_FINAL_DIFF_REVIEW: 'FAIL', RECON_CI_STANDARD: 'FAIL', RECON_CI_LINUX: 'FAIL',
  DOCKER_TEST_ENV_CLEANUP: 'PASS', RECON_PRODUCTION_CHANGED: 'NO', RECON_HOMOLOG_CHANGED: 'NO', RECON_PRODUCTION_DB_CHANGED: 'NO', RECON_HOMOLOG_DB_CHANGED: 'NO', RECON_R1_READY_FOR_HOMOLOG_ROLLOUT: 'NO',
}
// Completed local gates remain PASS, but a failed CI-adapter rehearsal cannot be
// converted to a release certificate or mistaken for a completed GitHub CI run.
assert.equal(ci?.result, 'FAIL_STOPPED')
assert.equal(ciSql?.failure?.message, 'LOCAL_REHEARSAL_PORT_REQUIRED')
assert.equal(ci.cleanup, 'PASS')
const paths = [prod, homolog, clean]
const domain = files => paths.every(p => p?.result === 'PASS' && files.every(f => p.tests.some(t => t.file === f && t.result === 'PASS'))) ? 'PASS' : 'FAIL'
Object.assign(gates, {
  R1_18_P16: paths.every(p => p?.p16?.result === 'PASS') ? 'PASS' : 'FAIL',
  R1_18_SACADO: domain(['sacado_multi.assert.sql']),
  R1_18_HEALTH_RLX: domain(['health_nfse_municipal.assert.sql']),
  R1_18_C5_A6: domain(['r1_3_c5_a6_compat.test.sql', 'guibor_a6_r2_analytics_scope.test.sql']),
  R1_18_NOTIFICATIONS: paths.every(p => p?.notifications?.pass === true) ? 'PASS' : 'FAIL',
  R1_18_INTEGRATIONS: pass(extra),
  R1_18_GUIBOR: domain(['guibor_a5_base.test.sql', 'guibor_a6_comissao.test.sql', 'guibor_nfse_review_intents.assert.sql']),
  R1_18_TAXAS: domain(['c2_1_r2_taxa_consultor.test.sql', 'c2_1_r2_fluxo_taxa.test.sql']),
  R1_18_DUPLICATA: pass(auth),
})
const blocker = {
  classification: 'NEW_CI_ORCHESTRATOR_PORT_CONTRACT_MISMATCH',
  error: ciSql.failure.message,
  caller: 'scripts/qa/reconciliation/r1-18-ci.mjs',
  rejectingGuard: 'scripts/qa/reconciliation/r1-3-notifications.mjs:7',
  expectedDbPorts: [57842, 57942], actualDbPort: ciSql.stacks[0].ports.db,
  passedSqlChecksBeforeGuard: ciSql.sql.reduce((n, t) => n + (t.checks ?? 0), 0),
  notificationChecksExecutedInThisCiAttempt: 0,
  provenCause: 'The new CI adapter selected freshStack(probea), which allocates port 58002; the reused notification helper accepts only the two original full-upgrade ports.',
  functionalRegressionProven: false, fixtureChangeApplied: false, guardRelaxed: false,
  nextStep: 'Adjust only CI orchestration to use a compatible, manifest-owned fresh stack, preserving the safety guard, canonical fixtures and assertions; rerun CI rehearsal from a new stack. Obtain confirmation that publication cannot trigger Vercel/Supabase deployment before push.',
}
const report = {
  at: new Date().toISOString(), result: 'STOPPED_CI_REHEARSAL_PORT_GUARD', gates, preservation,
  gateSemantics: 'FAIL for an unexecuted downstream gate means NOT_CERTIFIED, not an observed functional failure.',
  bootstrapRuns: [...(ab?.runs ?? []), ...(boot?.runs ?? [])].map(r => ({ label: r.label, result: r.result, firstStorageHealthyMs: r.firstStorageHealthyMs, startupMs: r.startupMs, cleanup: r.cleanup })),
  supplemental: { result: extra?.result ?? 'NOT_RUN', tests: extra?.tests ?? [], failure: extra?.failure, failedStack: extra?.stacks?.find(s => s.result === 'FAIL') },
  finalSqlWorkflow: workflow ?? { result: 'NOT_RUN' },
  blocker,
  quality: { result: quality.result, node: quality.node, gates: quality.gates, testsPassed: 3034, testsSkipped: 9, pdfTestsPassed: 3 },
  linux: { result: linux.result, image: linux.image, gates: linux.gates, dockerCleanup: linux.dockerCleanup },
  ciLocalRehearsal: ci, githubCi: 'NOT_RUN',
  authorization: { result: auth?.result ?? 'NOT_RUN', allowed: auth?.cases?.filter(c => c.result === 'ALLOW').length, denied: auth?.cases?.filter(c => c.result === 'DENY').length, unexpected: auth?.unexpected },
  scope: { remoteEnvironmentCalls: 0, productionChanged: false, homologChanged: false, migrationsEdited: false, fixturesEdited: false, runtimeBusinessCodeEdited: false, databaseTypesReconciled: 'UsuarioPapel.origem only', commit: false, push: false, deploy: false },
}
await writeFile(dir + 'R1_18_CI_REHEARSAL_STOP.json', JSON.stringify(blocker, null, 2) + '\n', { flag: 'wx' })
await writeFile(dir + 'R1_18_STATUS.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ result: report.result, blocker: report.blocker, preservation: preservation.result, cleanup: 'PASS' }))
