import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/central-bases-20261021', `quality-${Date.now()}`)
mkdirSync(output, { recursive: true })
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ci-placeholder-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'ci-placeholder-service-role-key', PORTAL_FIDC_CREDENTIALS_JSON: '{}', NEXT_TELEMETRY_DISABLED: '1',
  INTEGRATION_RUNTIME_ENV: 'homologacao', NEXT_PUBLIC_APP_ENV: 'homologacao' }
const report = { output, checks: [], REMOTE_CHANGED: false, PREVIEW_DEPLOYED: false }
const checks = [
  ['typecheck', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['tests', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers', '2', '--reporter=json', `--outputFile=${resolve(output, 'vitest.json')}`]],
  ['lint_scoped', process.execPath, ['node_modules/eslint/bin/eslint.js', 'src', 'scripts/qa/vortx']],
  ['lint_global', process.execPath, ['node_modules/eslint/bin/eslint.js', '.']],
  ['build', process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack']],
  ['diff_check', 'git', ['diff', '--check']],
]
for (const [name, command, args] of checks) {
  const started = Date.now()
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 16 * 1024 * 1024 })
  writeFileSync(resolve(output, `${name}.log`), `${result.stdout || ''}\n${result.stderr || ''}`)
  report.checks.push({ name, exitCode: result.status, error: result.error?.code || null, durationMs: Date.now() - started })
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.checks.at(-1)))
  if (result.status !== 0 && name !== 'lint_global') { process.exitCode = 1; break }
}
report.complete = report.checks.length === checks.length
report.scopedPassed = report.complete && report.checks.filter(check => check.name !== 'lint_global').every(check => check.exitCode === 0)
report.globalPassed = report.complete && report.checks.every(check => check.exitCode === 0)
writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ output, complete: report.complete, scopedPassed: report.scopedPassed, globalPassed: report.globalPassed }))
if (!report.globalPassed) process.exitCode = 1
