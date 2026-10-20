import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const output = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-native-stock-20261019', `quality-${Date.now()}`)
mkdirSync(output, { recursive: true })
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ci-placeholder-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'ci-placeholder-service-role-key', PORTAL_FIDC_CREDENTIALS_JSON: '{}', NEXT_TELEMETRY_DISABLED: '1',
  INTEGRATION_RUNTIME_ENV: 'homologacao', NEXT_PUBLIC_APP_ENV: 'homologacao' }
const checks = []
for (const [name, command, args] of [
  ['typecheck', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['tests', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers', '2', '--reporter=json', `--outputFile=${resolve(output, 'vitest.json')}`]],
  ['sql_two_stacks', process.execPath, ['scripts/qa/vortx/native-stock-sql-rehearsal.mjs']],
  ['preview_scope', process.execPath, ['--test', 'scripts/qa/vortx/preview-scope.test.mjs']],
  ['lint', process.execPath, ['node_modules/eslint/bin/eslint.js', '.']],
  ['build', process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack']],
  ['diff_check', 'git', ['diff', '--check']],
]) {
  const start = Date.now()
  const result = spawnSync(command, args, { env, encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 16 * 1024 * 1024 })
  writeFileSync(resolve(output, `${name}.log`), (result.stdout || '') + '\n' + (result.stderr || ''))
  checks.push({ name, exitCode: result.status, error: result.error?.code ?? null, durationMs: Date.now() - start })
  writeFileSync(resolve(output, 'QUALITY.json'), JSON.stringify({ output, checks }, null, 2))
  console.log(JSON.stringify(checks.at(-1)))
  if (result.status !== 0) { process.exitCode = 1; break }
}
console.log(JSON.stringify({ output, passed: checks.length === 7 && checks.every(c => c.exitCode === 0) }))
