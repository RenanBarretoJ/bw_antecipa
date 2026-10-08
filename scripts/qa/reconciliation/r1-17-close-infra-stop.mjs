import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { docker, inventory } from '../../email-intake/disposable-resources.mjs'
import { configureDisposableToml } from '../../perf9e/clean-room-lib.mjs'
import { hash } from './r1-4-restorer.mjs'
import { gitBytes } from './r1-5-migration-source.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const dir = 'rehearsal/reports/'
const read = async name => JSON.parse(await readFile(dir + name + '.json', 'utf8'))
const create = (name, value) => writeFile(dir + name + '.json', JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const cp = await read('R1_17_CHECKPOINT')
for (const f of [...cp.files, ...cp.reports]) assert.equal(hash(await readFile(f.path)), f.sha256, 'ARTIFACT_CHANGED:' + f.path)
assert.equal(gitBytes(['rev-parse', 'HEAD']).toString().trim(), cp.head)
assert.deepEqual(await inventory(), cp.docker)
const diagnosis = await read('R1_17_STORAGE_BOOTSTRAP_DIAGNOSIS')
const probe = JSON.parse(await readFile(diagnosis.minimalReport, 'utf8'))
assert.equal(probe.result, 'PASS')
assert.equal(probe.cleanup, 'PASS')
const oldConfigPath = 'rehearsal/tmp/bw_email03_r110cnab_1791409314726/supabase/config.toml'
const oldConfig = await readFile(oldConfigPath, 'utf8')
const newConfig = await readFile(`rehearsal/tmp/${probe.projectId}/supabase/config.toml`, 'utf8')
const normalizedOldConfig = configureDisposableToml(oldConfig, probe.spec)
const oldLines = normalizedOldConfig.split(/\r?\n/), newLines = newConfig.split(/\r?\n/)
assert.equal(oldLines.length, newLines.length, 'CONFIG_LINE_COUNT_CHANGED_REVIEW_REQUIRED')
const configDifferences = oldLines.flatMap((line, i) => line === newLines[i] ? [] : [{ line: i + 1, before: line, after: newLines[i], precedingLine: oldLines[i - 1] }])
assert.deepEqual(configDifferences.map(d => ({ before: d.before, after: d.after, precedingLine: d.precedingLine })), [{ before: 'enabled = false', after: 'enabled = true', precedingLine: '[realtime]' }], 'UNEXPECTED_CONFIG_DIFFERENCE_REVIEW_REQUIRED')
const events = await docker(['events', '--since', '2026-10-07T21:42:00Z', '--until', '2026-10-07T21:56:30Z', '--filter', 'label=com.supabase.cli.project=bw_email03_r110cnab_1791409314726', '--format', '{{json .}}'])
assert.equal(events.trim(), '', 'HISTORICAL_EVENTS_NOW_AVAILABLE_REVIEW_REQUIRED')
const storageTimeline = probe.timeline.flatMap(s => s.containers.filter(c => c.name.startsWith('supabase_storage_')).map(c => ({ atMs: s.atMs, health: c.health.Status, oomKilled: c.oomKilled, restartCount: c.restartCount, healthcheck: c.healthcheck, checkLog: c.health.Log })))
diagnosis.reviewedAt = new Date().toISOString()
diagnosis.minimalEvidence = { startupMs: probe.startupMs, firstHealthyMs: storageTimeline.find(s => s.health === 'healthy')?.atMs, storageTimeline, applicationMigrations: 0, applicationTests: 0 }
diagnosis.configurationComparison = { result: 'DIFFERENCE_DETECTED', exactSameConfigurationExceptProjectIdAndExclusivePorts: false, differences: configDifferences, interpretation: 'Historical temporary config has realtime.enabled=false; current repository-derived minimal config has true. Both start commands exclude realtime runtime. Causal relevance unproven; do not call this an exact failed-run reproduction.', historicalConfigHash: hash(oldConfig), currentConfigHash: hash(newConfig), timeoutChanged: false, retryAdded: false, globalDockerChanged: false }
diagnosis.historicalDockerEvents = { result: 'NO_RETAINED_EVENTS', querySince: '2026-10-07T21:42:00Z', queryUntil: '2026-10-07T21:56:30Z' }
diagnosis.hypotheses = [
  { cause: 'TRANSIENT_STARTUP', verdict: 'PLAUSIBLE_NOT_PROVEN', reason: 'Repository-derived isolated bootstrap succeeds, but failed-run health logs are unavailable and historical config differs in the Realtime flag.' },
  { cause: 'RESOURCE_PRESSURE', verdict: 'NOT_PROVEN', reason: 'No failed-run pressure/OOM telemetry is preserved; current startup has no OOM or restarts.' },
  { cause: 'HEALTHCHECK_TIMEOUT_TOO_SHORT', verdict: 'NOT_PROVEN', reason: 'Current Storage becomes healthy within the unchanged healthcheck window.' },
  { cause: 'STORAGE_CONFIG', verdict: 'NOT_PROVEN', reason: 'Current bootstrap succeeds without application migrations. Realtime flag differs from historical temporary config; its causal relevance is not established.' },
  { cause: 'PORT_COLLISION_OR_STALE_RESOURCE', verdict: 'NOT_REPRODUCED', reason: 'Current ports and ownership preflight pass; failed-run inspect is unavailable.' },
]
diagnosis.conclusion = 'Root cause remains UNKNOWN. The minimal reproduction passed in about 48 seconds, but does not establish the historical cause. Stop per R1.17 sections 6 and 34; do not run stability pair or subsequent certification gates.'
await writeFile(dir + 'R1_17_STORAGE_BOOTSTRAP_DIAGNOSIS.json', JSON.stringify(diagnosis, null, 2) + '\n')
const pending = ['R1_17_STORAGE_BOOTSTRAP_STABILITY', 'R1_17_SUPPLEMENTAL_SUITES', 'R1_17_DUPLICATA_FAIL_CLOSED', 'RECON_UPGRADE_FROM_PROD', 'RECON_UPGRADE_FROM_HOMOLOG', 'RECON_CLEAN_ROOM', 'RECON_SQL', 'R1_17_FINAL_RLS', 'R1_17_TARGET_CATALOG_EQUIVALENT', 'R1_17_FINAL_ACL', 'R1_17_FINAL_STRUCTURE', 'R1_17_P16', 'R1_17_SACADO', 'R1_17_HEALTH_RLX', 'R1_17_C5_A6', 'R1_17_NOTIFICATIONS', 'R1_17_INTEGRATIONS', 'R1_17_GUIBOR', 'R1_17_TAXAS', 'R1_17_DUPLICATA', 'RECON_DATABASE_TYPES', 'RECON_PACKAGE_LOCK', 'RECON_SHARP', 'RECON_PDF_RUNTIME', 'RECON_TYPESCRIPT', 'RECON_FULL_SUITE', 'RECON_LINT', 'RECON_BUILD_LINUX', 'R1_17_FEATURE_PRESERVATION_MANIFEST', 'R1_17_FINAL_DIFF_REVIEW', 'RECON_CI_STANDARD', 'RECON_CI_LINUX']
const blockedReports = ['R1_17_BOOTSTRAP_STABILITY', 'R1_17_SUPPLEMENTAL_SUITES', 'R1_17_DUPLICATA_AUTH', 'R1_17_PROD_FINAL', 'R1_17_HOMOLOG_FINAL', 'R1_17_CLEANROOM_FINAL', 'R1_17_FULL_SQL', 'R1_17_FINAL_RLS', 'R1_17_TARGET_CATALOG', 'R1_17_FINAL_QUALITY']
for (const name of blockedReports) await create(name, { at: new Date().toISOString(), result: 'NOT_RUN', reason: 'STOP_STORAGE_ROOT_CAUSE_UNKNOWN', prerequisite: 'R1_17_STORAGE_BOOTSTRAP_ROOT_CAUSE', executedChecks: 0, inheritedPriorPass: false, functionalFailureObserved: false })
const status = {
  at: new Date().toISOString(), result: 'STOPPED_STORAGE_ROOT_CAUSE_UNKNOWN', rootCause: 'UNKNOWN',
  gates: { R1_17_EXISTING_WORK_PRESERVED: 'PASS', R1_17_BUSINESS_CODE_UNCHANGED_DURING_INFRA_DIAG: 'PASS', R1_17_STORAGE_BOOTSTRAP_ROOT_CAUSE: 'FAIL', R1_17_DOCKER_PREFLIGHT: 'PASS', R1_17_MINIMAL_STORAGE_BOOTSTRAP: 'PASS', R1_17_SEQUENTIAL_STACK_ORCHESTRATION: 'PASS', ...Object.fromEntries(pending.map(g => [g, 'FAIL'])), DOCKER_TEST_ENV_CLEANUP: 'PASS', RECON_PRODUCTION_CHANGED: 'NO', RECON_HOMOLOG_CHANGED: 'NO', RECON_PRODUCTION_DB_CHANGED: 'NO', RECON_HOMOLOG_DB_CHANGED: 'NO', RECON_R1_READY_FOR_HOMOLOG_ROLLOUT: 'NO' },
  gateSemantics: 'For unexecuted downstream gates, FAIL means not certified, NOT an observed functional/test failure. Execution details below distinguish this.',
  notExecuted: pending, observedFunctionalFailures: 0,
  minimal: { projectId: probe.projectId, result: probe.result, startupMs: probe.startupMs, firstStorageHealthyMs: diagnosis.minimalEvidence.firstHealthyMs, migrations: 0, tests: 0, cleanup: 'PASS' },
  preservation: { files: cp.files.length, reports: cp.reports.length, forwards: cp.forwards.length, result: 'PASS', preexistingDocker: 'UNCHANGED' },
  historicalAuthorizationEvidence: { report: 'R1_16_AUTH_STATUS.json', preserved: true, notReusedAsFinalGate: true },
  scope: 'Added local QA diagnostics only; no existing source, fixture, migration or prior report changed',
  remoteEnvironmentCalls: 0, commit: false, push: false, deploy: false,
  nextAction: 'Obtain contemporaneous failed-bootstrap telemetry or an explicitly revised evidence gate; no speculative timeout/configuration correction is justified.',
}
await create('R1_17_STATUS', status)
console.log(JSON.stringify({ result: status.result, minimal: status.minimal, preservation: status.preservation, readyForRollout: false }))
