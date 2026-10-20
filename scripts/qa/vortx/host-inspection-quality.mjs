import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Generated evidence only; never loads Preview credentials, provider URLs or keyrings.
const output = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-host-inspection-20261020', `quality-${Date.now()}`)
mkdirSync(output, { recursive: true })
const report = { scope: 'PRESERVED_REPORT_HOST_READ_ONLY', output, checks: [], productionChanged: false, homologChanged: false }
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ci-placeholder-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'ci-placeholder-service-role-key', PORTAL_FIDC_CREDENTIALS_JSON: '{}', NEXT_TELEMETRY_DISABLED: '1',
  INTEGRATION_RUNTIME_ENV: 'homologacao', NEXT_PUBLIC_APP_ENV: 'homologacao', VORTX_REPORT_HOST_INSPECTION_JSON: '' }
const tasks = [
  ['focused', ['node_modules/vitest/vitest.mjs', 'run', 'src/lib/integracoes/vortx', 'src/app/api/integracoes/vortx', '--maxWorkers=2']],
  ['tests', ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=2', '--reporter=json', `--outputFile=${resolve(output, 'vitest.json')}`]],
  ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['lint', ['node_modules/eslint/bin/eslint.js', '.']],
  ['build', ['node_modules/next/dist/bin/next', 'build', '--webpack']],
]
for (const [name, args] of tasks) {
  const start = Date.now()
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 600000,
    maxBuffer: 32 * 1024 * 1024, env })
  const log = (result.stdout || '') + '\n' + (result.stderr || '')
  writeFileSync(resolve(output, `${name}.log`), log)
  const item = { name, exitCode: result.status, durationMs: Date.now() - start, logSha256: createHash('sha256').update(log).digest('hex') }
  report.checks.push(item)
  writeFileSync(resolve(output, 'QUALITY.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(item))
  if (result.status !== 0) { process.exitCode = 1; break }
}
if (!process.exitCode) {
  const tests = JSON.parse(readFileSync(resolve(output, 'vitest.json'), 'utf8'))
  assert.equal(tests.numFailedTests, 0)
  report.tests = { passed: tests.numPassedTests, failed: tests.numFailedTests, skipped: tests.numPendingTests }
}
writeFileSync(resolve(output, 'QUALITY.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ output, passed: report.checks.length === tasks.length && report.checks.every(c => c.exitCode === 0), tests: report.tests }))
