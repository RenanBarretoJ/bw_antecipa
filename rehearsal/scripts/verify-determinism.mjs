import fs from 'node:fs'
import path from 'node:path'
import { REHEARSAL_ROOT, REPORT_DIR, formatError, run } from './lib.mjs'

function runCycle() {
  run(process.execPath, [path.join(REHEARSAL_ROOT, 'scripts', 'rebuild-local.mjs')])
  const report = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, 'baseline-current.json'), 'utf8'))
  return report.deterministic_hash
}

try {
  const first = runCycle()
  const second = runCycle()
  if (first !== second) throw new Error(`Restore nao deterministico: ${first} != ${second}.`)
  console.log(`RESTORE_PRODUCAO_LOCAL = DETERMINISTICO (${first})`)
} catch (error) {
  console.error(`Validacao de determinismo falhou: ${formatError(error)}`)
  process.exitCode = 1
}
