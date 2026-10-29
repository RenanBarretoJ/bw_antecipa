import assert from 'node:assert/strict'
import { observeTransport } from './s2-2sr-transport.mjs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { delimiter, dirname, resolve } from 'node:path'
import { canonicalHash } from './s2-2s-manifest.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
assert.match(process.version, /^v22\./, 'NODE22_REQUIRED')
// A build must not silently load any locally configured account credentials.
assert.ok(!(await readdir('.')).some(name => name.startsWith('.env')), 'ENV_FILE_REQUIRES_SEPARATE_REVIEW')
const root = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence', 's2-2sr-local-20261028', `validation-${Date.now()}`)
await mkdir(root, { recursive: true })
const report = { status: 'IN_PROGRESS', node: process.version, steps: {}, files: [], remoteActions: false,
  hostedCiExecuted: false, providerCalls: 0, commitCreated: false, manifestApplyAllowed: false }
const env = { ...process.env, PATH: dirname(process.execPath) + delimiter + process.env.PATH,
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ci-synthetic-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'ci-synthetic-service', PORTAL_FIDC_CREDENTIALS_JSON: '{}',
  SERPRO_NFE_ENABLED: 'false', SERPRO_NFE_WORKER_ENABLED: 'false', SERPRO_NFE_QUERY_ENABLED: 'false',
  SERPRO_NFE_CONTRACT_VERIFIED: 'false', SERPRO_NFE_CONSUMPTION_MODE: 'OFF_ZERO_BUDGET',
  SERPRO_NFE_CONSUMER_KEY: '', SERPRO_NFE_CONSUMER_SECRET: '', NEXT_TELEMETRY_DISABLED: '1' }
const checkpoint = () => writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2))
async function run(name, program, args, timeout = 600000) {
  console.log(name)
  let result
  try {
    result = await observeTransport(program, args, undefined, timeout, { env, phase: name, ignoreInput: true })
  } catch (error) {
    report.steps[name] = { ...error.transport, exitCode: null, status: 'FAIL', processStatus: error.transport?.status ?? null }
    await checkpoint()
    throw error
  }
  await writeFile(resolve(root, `${name}.log`), result.stdout + result.stderr)
  report.steps[name] = { ...result.transport, exitCode: result.status, status: result.status === 0 ? 'PASS' : 'FAIL', processStatus: result.status }
  await checkpoint()
  try { assert.equal(result.status, 0, `${name}_FAILED ${JSON.stringify(result.transport)}`) }
  catch (error) { error.transport = result.transport; throw error }
  return result.stdout.trim()
}
const node = (name, args, timeout) => run(name, process.execPath, args, timeout)
async function changedSources() {
  const tracked = await run('tracked', 'git', ['diff', '--name-only', 'HEAD'])
  const untracked = await run('untracked', 'git', ['ls-files', '--others', '--exclude-standard'])
  return Promise.all([...new Set((tracked + '\n' + untracked).split(/\r?\n/).filter(Boolean))].sort().map(async path => ({
    path, canonicalLfSha256: canonicalHash(await readFile(path, 'utf8')),
  })))
}
try {
  report.base = await run('base', 'git', ['rev-parse', 'HEAD'])
  assert.equal(report.base, '461896b794c9059d9b8bc4c5cd3f9761cce24c79', 'BASE_DRIFT')
  await run('product-preservation', 'git', ['diff', '--exit-code', 'HEAD', '--', 'src', 'supabase', 'scripts/qa/vortx'])
  report.files = await changedSources()
  const findings = []
  for (const file of report.files) {
    const text = await readFile(file.path, 'utf8')
    const patterns = [ /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /(?:AKIA|ASIA)[A-Z0-9]{16}/,
      /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{16,}/,
      /SERPRO_NFE_CONSUMER_(?:KEY|SECRET)\s*[:=]\s*['"][^'"]+['"]/ ]
    if (patterns.some(pattern => pattern.test(text))) findings.push({ path: file.path, reason: 'REQUIRES_PRIVATE_REVIEW' })
  }
  report.secretScan = { scope: 'EXACT_CHANGED_SOURCE_FILES', files: report.files.length, findings }
  assert.deepEqual(findings, [], 'SECRET_SCAN_REVIEW_REQUIRED')
  await run('diff-check', 'git', ['diff', '--check'])
  await node('ci-contracts', ['--test', 'scripts/qa/serpro/s2-2s-ci.test.mjs'])
  await node('dependency-contracts', ['--test', 'scripts/qa/serpro/s2-2sr-linux-dependencies.test.mjs'])
  await node('native-infra-contracts', ['--test', 'scripts/qa/vortx/main-native-images.test.mjs',
    'scripts/qa/vortx/main-native-fixture.test.mjs', 'scripts/qa/vortx/main-native-snapshot.test.mjs'])
  report.manifest = JSON.parse(await node('manifest-preparation', ['scripts/qa/serpro/s2-2s-manifest.mjs', '--prepare-only']))
  report.images = JSON.parse(await node('existing-images', ['scripts/qa/serpro/s2-2s-ci-assets.mjs', '--existing-only']))
  const output = await node('contained-native-full', ['scripts/qa/serpro/s2-2r-contained-qa.mjs', '--native-full', '--quality-linux'], 1800000)
  const closeout = JSON.parse(output.split(/\r?\n/).at(-1))
  report.nativeReport = closeout.report
  const native = JSON.parse(await readFile(closeout.report, 'utf8'))
  assert.equal(native.status, 'CONTAINED_SQL_PASS')
  assert.equal(native.DOCKER_TEST_ENV_CLEANUP, 'PASS')
  report.native = { status: native.status, tests: native.native, functional: native.functional,
    DOCKER_TEST_ENV_CLEANUP: native.DOCKER_TEST_ENV_CLEANUP, preexistingPreserved: native.preexistingPreserved }
  await checkpoint()
  assert.deepEqual(native.native.qualityLinux.map(item => item.status), ['PASS', 'PASS'], 'LINUX_QUALITY_REQUIRED')
  assert.equal(native.buildLinux.status, 'PASS', 'LINUX_WEBPACK_BUILD_REQUIRED')
  report.buildLinux = native.buildLinux
  assert.deepEqual(await changedSources(), report.files, 'SOURCE_DRIFT_DURING_VALIDATION')
  report.status = 'S2_2S_LOCAL_CI_VALIDATION_PASS_MANIFEST_PENDING_OWNER'
} catch (error) {
  report.status = 'S2_2S_PARTIAL_STOP'; report.error = error.message; report.errorTransport = error.transport ?? null; process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  await checkpoint()
  console.log(JSON.stringify({ status: report.status, report: resolve(root, 'report.json') }))
}
