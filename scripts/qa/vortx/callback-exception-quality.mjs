// Local validation only; synthetic build settings, no hosted credentials or DB writes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const output = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-callback-risk-exception-20261019', `quality-${Date.now()}`)
mkdirSync(output, { recursive: true })
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ci-placeholder-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'ci-placeholder-service-role-key', PORTAL_FIDC_CREDENTIALS_JSON: '{}', NEXT_TELEMETRY_DISABLED: '1',
  INTEGRATION_RUNTIME_ENV: 'homologacao', NEXT_PUBLIC_APP_ENV: 'homologacao', VORTX_REPORT_CALLBACK_PREVIEW_ENABLED: 'false', VORTX_REPORT_CALLBACK_URL_RISK_ACCEPTED: 'false' }
const preservation = [
  'supabase/migrations/20261019201346_vortx_report_callback_inbox.sql',
  'supabase/migrations/20261019203424_vortx_callback_admin_ui.sql',
  'src/app/admin/fundos/callback-vortx-actions.ts',
  'src/app/api/integracoes/vortx/relatorios/callback/route.ts',
  'src/lib/integracoes/vortx/relatorios-contexto.server.ts',
].map(path => {
  const baseline = spawnSync('git', ['show', `0714ef76265dce06cc5cf1abf3e4e5cfbd609d18:${path}`], { windowsHide: true })
  if (baseline.status !== 0) throw new Error(`BASELINE_UNAVAILABLE:${path}`)
  const hash = bytes => createHash('sha256').update(bytes.toString('utf8').replaceAll('\r\n', '\n')).digest('hex')
  const before = hash(baseline.stdout), after = hash(readFileSync(path))
  if (before !== after) throw new Error(`PRESERVATION_FAILED:${path}`)
  return { path, before, after, unchanged: true }
})
const tasks = [
  ['typecheck', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['tests', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers', '2', '--reporter=json', `--outputFile=${resolve(output, 'vitest.json')}`]],
  ['browser', process.execPath, ['scripts/qa/vortx/callback-browser.mjs']],
  ['preview_scope', process.execPath, ['--test', 'scripts/qa/vortx/preview-scope.test.mjs']],
  ['lint', process.execPath, ['node_modules/eslint/bin/eslint.js', '.']],
  ['build', process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack']],
  ['diff_check', 'git', ['diff', '--check']],
]
const checks = []
for (const [name, command, args] of tasks) {
  const start = Date.now()
  const result = spawnSync(command, args, { env, encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 16 * 1024 * 1024 })
  writeFileSync(resolve(output, `${name}.log`), (result.stdout || '') + '\n' + (result.stderr || ''))
  checks.push({ name, exitCode: result.status, error: result.error?.code ?? null, durationMs: Date.now() - start })
  writeFileSync(resolve(output, 'QUALITY.json'), JSON.stringify({ output, preservation, checks, sqlReexecuted: false, reason: 'No migration, Auth/RLS/RPC or receiver changes.' }, null, 2))
  console.log(JSON.stringify(checks.at(-1)))
  if (result.status !== 0) { process.exitCode = 1; break }
}
console.log(JSON.stringify({ output, passed: checks.length === tasks.length && checks.every(c => c.exitCode === 0) }))
