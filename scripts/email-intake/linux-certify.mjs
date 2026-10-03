import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { redactCommandOutput } from '../perf9e/clean-room-lib.mjs'

assert.equal(process.platform, 'linux', 'LINUX_CERTIFICATION_REQUIRES_LINUX')
await mkdir('rehearsal/reports', { recursive: true })
const environment = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ci-placeholder-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'ci-placeholder-service-role-key' }
const gates = [
  ['diagnostic-tests', ['--test', 'scripts/email-intake/browser-diagnostics.test.mjs', 'scripts/email-intake/browser-redaction.test.mjs', 'scripts/email-intake/browser-protocol.test.mjs', 'scripts/email-intake/browser-drain.test.mjs', 'scripts/email-intake/browser-no-body.test.mjs', 'scripts/email-intake/disposable-resources.test.mjs', 'scripts/email-intake/runner-evidence.test.mjs']],
  ['response-probe', ['scripts/email-intake/redaction-probe.mjs']],
  ['no-body-probe', ['scripts/email-intake/no-body-probe.mjs']],
  ['typescript', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['full-suite', ['node_modules/vitest/vitest.mjs', 'run', '--pool=threads', '--maxWorkers=1', '--no-file-parallelism']],
  ['lint', ['node_modules/eslint/bin/eslint.js', '.']],
  ['build', ['node_modules/next/dist/bin/next', 'build', '--webpack']],
  ['clean-room', ['scripts/email-intake/clean-room.mjs', '--storage-api', '--automation', '--operators']],
]
const result = { result: 'IN_PROGRESS', gates: [] }
try {
  for (const [name, args] of gates) {
    console.log(JSON.stringify({ stage: name }))
    const startedAt = Date.now()
    const outcome = await new Promise((done, reject) => {
      const child = spawn(process.execPath, args, { env: environment })
      let output = ''
      for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output += bytes.toString() })
      child.on('error', reject); child.on('exit', code => done({ code, output }))
    })
    await writeFile(`rehearsal/reports/email05-r3-${name}.log`, redactCommandOutput(outcome.output))
    result.gates.push({ name, result: outcome.code === 0 ? 'PASS' : 'FAIL', durationMs: Date.now() - startedAt })
    await writeFile('rehearsal/reports/email05-r3-linux.json', JSON.stringify(result, null, 2))
    assert.equal(outcome.code, 0, `LINUX_GATE_FAILED:${name}`)
  }
  result.result = 'PASS'
} catch (error) { result.result = 'FAIL'; result.failure = error.message; process.exitCode = 1 }
finally {
  await writeFile('rehearsal/reports/email05-r3-linux.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}
