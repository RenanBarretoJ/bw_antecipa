import fs from 'node:fs'
import path from 'node:path'
import {
  REHEARSAL_ROOT,
  REPORT_DIR,
  formatError,
  run,
  stableJson,
  writeJson,
} from './lib.mjs'
import { validateProductionManifest } from './production-manifest.mjs'

function runScript(file, args = []) {
  run(process.execPath, [path.join(REHEARSAL_ROOT, 'scripts', file), ...args], { capture: false })
}

function readReport(file) {
  return JSON.parse(fs.readFileSync(path.join(REPORT_DIR, file), 'utf8'))
}

function cycle(label) {
  console.log(`\nP3 cutover dry-run ${label}: reconstruindo clone original...`)
  runScript('rebuild-local.mjs')
  runScript('upgrade-local.mjs')
  runScript('post-upgrade-local.mjs', [`--output=P3_POST_UPGRADE_${label}.json`])
  runScript('release-candidate-inventory.mjs', [`--output=P3_INVENTORY_${label}.json`])
  runScript('preflight-release-candidate.mjs', [`--output=P3_PREFLIGHT_${label}.json`, '--allow-operational-blockers'])
  const postUpgrade = readReport(`P3_POST_UPGRADE_${label}.json`)
  const preflight = readReport(`P3_PREFLIGHT_${label}.json`)
  return {
    label,
    post_upgrade_hash: postUpgrade.deterministic_hash,
    hard_failures: [...postUpgrade.hard_failures, ...preflight.hard_failures],
    operational_blockers: preflight.operational_blockers,
    manifest_hash: preflight.production_manifest_hash,
    reached_step: preflight.cutover_ready ? 'ready_for_application_deploy' : 'operational_configuration_gate',
  }
}

try {
  const manifest = validateProductionManifest()
  const first = cycle('RUN_1')
  const second = cycle('RUN_2')
  const deterministic = first.post_upgrade_hash === second.post_upgrade_hash
    && first.manifest_hash === second.manifest_hash
    && stableJson(first.operational_blockers) === stableJson(second.operational_blockers)
    && first.hard_failures.length === 0
    && second.hard_failures.length === 0
  const report = {
    generated_at: new Date().toISOString(),
    environment: 'rehearsal/local',
    production_access: 'none',
    production_manifest_hash: manifest.manifest_hash,
    run_1: first,
    run_2: second,
    deterministic,
    full_cutover_completed: first.reached_step === 'ready_for_application_deploy' && second.reached_step === 'ready_for_application_deploy',
  }
  writeJson(path.join(REPORT_DIR, 'P3_CUTOVER_DRY_RUN.json'), report)
  console.log(`CUTOVER_DRY_RUN = ${deterministic ? 'DETERMINISTICO' : 'NAO_DETERMINISTICO'}`)
  console.log(`Gate operacional liberado: ${report.full_cutover_completed ? 'sim' : 'nao'}`)
  if (!deterministic) process.exitCode = 2
} catch (error) {
  console.error(`Dry-run P3 falhou: ${formatError(error)}`)
  process.exitCode = 1
}
