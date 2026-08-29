import fs from 'node:fs'
import path from 'node:path'
import {
  REHEARSAL_ROOT,
  REPORT_DIR,
  formatError,
  run,
  writeJson,
} from './lib.mjs'

function runCycle(label) {
  run(process.execPath, [path.join(REHEARSAL_ROOT, 'scripts', 'rebuild-local.mjs')], { capture: false })
  run(process.execPath, [path.join(REHEARSAL_ROOT, 'scripts', 'upgrade-local.mjs')], { capture: false })
  run(process.execPath, [
    path.join(REHEARSAL_ROOT, 'scripts', 'post-upgrade-local.mjs'),
    `--output=POST_UPGRADE_${label}.json`,
  ], { capture: false })
  return JSON.parse(fs.readFileSync(path.join(REPORT_DIR, `POST_UPGRADE_${label}.json`), 'utf8'))
}

try {
  const first = runCycle('RUN_1')
  const second = runCycle('RUN_2')
  const deterministic = first.deterministic_hash === second.deterministic_hash
    && first.hard_failures.length === 0
    && second.hard_failures.length === 0
  const summary = {
    generated_at: new Date().toISOString(),
    run_1_hash: first.deterministic_hash,
    run_2_hash: second.deterministic_hash,
    run_1_hard_failures: first.hard_failures,
    run_2_hard_failures: second.hard_failures,
    deterministic,
  }
  writeJson(path.join(REPORT_DIR, 'upgrade-determinism.json'), summary)
  if (!deterministic) throw new Error(`Upgrade nao deterministico: ${first.deterministic_hash} != ${second.deterministic_hash}.`)
  console.log(`UPGRADE_REHEARSAL = DETERMINISTICO (${first.deterministic_hash})`)
} catch (error) {
  console.error(`Validacao do upgrade falhou: ${formatError(error)}`)
  process.exitCode = 1
}
