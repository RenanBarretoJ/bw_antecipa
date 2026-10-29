import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { EventEmitter } from 'node:events'
import { observeTransport } from './s2-2sr-transport.mjs'
import { runLinuxProductionBuild, verifyBuilderInspection, verifyDependencyLock, dependencyLimits } from './s2-2sr-linux-dependencies.mjs'

test('all existing lock dependencies have public registry and immutable integrity', () => {
  assert.match(verifyDependencyLock(readFileSync('package-lock.json', 'utf8')), /^[a-f0-9]{64}$/)
})
for (const [name, patch] of [
  ['other registry', { resolved: 'https://other.invalid/package.tgz' }],
  ['credentials', { resolved: 'https://secret@registry.npmjs.org/a.tgz' }],
  ['query token', { resolved: 'https://registry.npmjs.org/a.tgz?token=synthetic' }],
  ['linked package', { link: true }],
  ['missing integrity', { integrity: null }],
]) test(`dependency plan rejects ${name}`, () => {
  const lock = { lockfileVersion: 3, packages: { 'node_modules/test': {
    resolved: 'https://registry.npmjs.org/a.tgz', integrity: 'sha512-synthetic', ...patch,
  } } }
  assert.throws(() => verifyDependencyLock(JSON.stringify(lock)))
})
function fixture() {
  const id = 'bw-s22r-123-456'
  return { id, network: { Labels: { 'bw.qa.s22r': id }, Internal: false }, container: {
    Name: `${id}-npm`, Config: { Labels: { 'bw.qa.s22r': id } }, Image: 'sha256:synthetic',
    HostConfig: { PortBindings: {}, PublishAllPorts: false }, State: { Running: false },
    NetworkSettings: { Networks: { [`${id}-npm-net`]: {} } }, Mounts: [
      { Type: 'bind', Destination: '/inputs/package.json', RW: false },
      { Type: 'bind', Destination: '/inputs/package-lock.json', RW: false },
      { Type: 'volume', Name: `${id}-deps`, Destination: '/deps' },
    ],
  } }
}
test('registry builder sees only two readonly manifests and its own volume, with no host ports', () => {
  const f = fixture()
  assert.equal(verifyBuilderInspection(f.container, f.network, f.id).repositoryMounted, false)
  assert.equal(dependencyLimits.transportMs, 600000, 'No timeout increase')
  assert.equal(dependencyLimits.bytes, 2147483648)
})
for (const [name, patch] of [
  ['host port', f => { f.container.HostConfig.PortBindings = { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '1234' }] } }],
  ['whole repo mount', f => { f.container.Mounts[0].Destination = '/work' }],
  ['writable input', f => { f.container.Mounts[0].RW = true }],
  ['foreign volume', f => { f.container.Mounts[2].Name = 'preexisting' }],
  ['QA network', f => { f.container.NetworkSettings.Networks = { 'qa-network': {} } }],
]) test(`builder inspection rejects ${name}`, () => {
  const f = fixture(); patch(f)
  assert.throws(() => verifyBuilderInspection(f.container, f.network, f.id))
})
test('runner uses read-only Linux volume; no monolithic Windows node_modules Docker copy', () => {
  const runner = readFileSync('scripts/qa/serpro/s2-2r-contained-qa.mjs', 'utf8')
  const contracts = readFileSync('scripts/qa/serpro/s2-2r-native-contracts.mjs', 'utf8')
  assert.ok(runner.includes('prepareLinuxDependencyVolume'))
  assert.ok(runner.includes('READ_ONLY_LINUX_DEPENDENCY_VOLUME_REQUIRED'))
  assert.ok(contracts.includes("fs.symlinkSync('/linux-deps/node_modules','/qa/node_modules')"))
  assert.ok(!contracts.includes("['cp', resolve(linuxDeps"))
  for (const guard of ['NATIVE_CONTRACT_FAILURE', 'FULL_SUITE_UNSUCCESSFUL', 'FULL_SUITE_COLLECTION_FAILURE', 'FULL_SUITE_INCOMPLETE']) assert.ok(contracts.includes(guard))
})

// Inspect the actual container program without creating infrastructure or
// running Next. Filesystem/process doubles keep these regression tests local.
async function captureBuildProgram() {
  const stop = new Error('CAPTURE_ONLY_NO_DOCKER')
  let script
  await assert.rejects(runLinuxProductionBuild({
    docker: async args => {
      if (args[0] === 'network') return ''
      assert.equal(args[0], 'create')
      script = args.at(-1)
      throw stop
    },
    id: 'bw-s22r-123-456', image: 'synthetic-image', owned: [],
    phase: async () => {}, root: 'unused', volume: 'synthetic-volume',
  }), error => error === stop)
  assert.equal(typeof script, 'string')
  return script
}

function runBuildProgram(script, result) {
  const observations = [], calls = []
  const emptyHash = createHash('sha256').update('').digest('hex')
  const proof = JSON.stringify({ lockSha256: emptyHash, packageSha256: emptyHash })
  const fs = {
    mkdirSync() {}, cpSync() {}, symlinkSync() {},
    readFileSync: path => path === '/linux-deps/dependency-proof.json' ? proof : '',
  }
  let ticks = 1000
  const context = {
    require: name => {
      if (name === 'node:fs') return fs
      if (name === 'node:crypto') return { createHash }
      assert.equal(name, 'node:child_process')
      return { spawnSync: (...args) => { calls.push(args); return result } }
    },
    process: { version: 'v22.synthetic', execPath: 'synthetic-node' },
    Date: { now: () => { const value = ticks; ticks += 250; return value } },
    // The parent persists stdout on success and its tail on failure; stderr
    // alone would lose successful observations in the current Docker wrapper.
    console: { log: value => observations.push(JSON.parse(value)) },
  }
  return { observations, calls, execute: () => runInNewContext(script, context) }
}

for (const [name, result, failed] of [
  ['success', { status: 0, signal: null }, false],
  ['nonzero exit', { status: 7, signal: null }, true],
  ['signal termination', { status: null, signal: 'SIGKILL' }, true],
  ['timeout', { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } }, true],
  ['spawn failure', { status: null, signal: null, error: { code: 'ENOENT' } }, true],
  ['error despite exit zero', { status: 0, signal: null, error: { code: 'EIO' } }, true],
  ['missing exit status', {}, true],
]) test(`build exit observability: ${name}; strict result and budgets preserved`, async () => {
  const probe = runBuildProgram(await captureBuildProgram(), result)
  if (failed) assert.throws(probe.execute, /LINUX_WEBPACK_BUILD_FAILED/)
  else probe.execute()
  assert.deepEqual(probe.observations, [{
    event: 'LINUX_WEBPACK_BUILD_PROCESS_EXIT', elapsedMs: 250,
    status: result.status ?? null, signal: result.signal ?? null, errorCode: result.error?.code ?? null,
  }])
  assert.equal(probe.calls.length, 1, 'No automatic retry')
  const [executable, args, options] = probe.calls[0]
  assert.equal(executable, 'synthetic-node')
  assert.deepEqual(Array.from(args), ['node_modules/next/dist/bin/next', 'build', '--webpack'])
  assert.deepEqual({ ...options }, { cwd: '/build', stdio: 'inherit', timeout: 540000 })
})

test('build exit observation excludes messages, arguments, output, and secrets', async () => {
  const secret = 'SYNTHETIC_MUST_NOT_APPEAR'
  const probe = runBuildProgram(await captureBuildProgram(), {
    status: null, signal: null, error: { code: 'ENOENT', message: secret, stack: secret, spawnargs: [secret] },
    stdout: secret, stderr: secret, env: { SECRET: secret },
  })
  assert.throws(probe.execute, /LINUX_WEBPACK_BUILD_FAILED/)
  assert.equal(JSON.stringify(probe.observations).includes(secret), false)
  assert.deepEqual(Object.keys(probe.observations[0]).sort(), ['elapsedMs', 'errorCode', 'event', 'signal', 'status'])
})

function transportFixture() {
  const child = new EventEmitter(), calls = [], cancelled = []
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter()
  child.stdin.end = input => { calls.push({ input }) }
  child.kill = signal => { calls.push({ killedWith: signal }); child.emit('close', null, signal); return true }
  let tick = 1000, fireTimeout
  const runtime = {
    spawn: (...args) => { calls.push({ spawn: args }); return child },
    now: () => { const value = tick; tick += 250; return value },
    setTimeout: (callback, ms) => { fireTimeout = callback; calls.push({ timeoutMs: ms }); return 1 },
    clearTimeout: timer => cancelled.push(timer),
  }
  return { child, calls, cancelled, runtime, expire: () => fireTimeout() }
}

for (const [name, code, signal, timeout] of [
  ['success', 0, null, false], ['nonzero', 7, null, false],
  ['signal', null, 'SIGKILL', false], ['transport timeout', null, 'SIGTERM', true],
]) test(`transport records ${name} without changing the caller exit-zero rule or budget`, async () => {
  const f = transportFixture()
  const pending = observeTransport('docker', ['exec', 'SYNTHETIC_SECRET_ARGUMENT'], 'SYNTHETIC_INPUT', 600000,
    { phase: 'TEST_PHASE' }, f.runtime)
  f.child.stdout.emit('data', Buffer.from('output\n')); f.child.stderr.emit('data', Buffer.from('diagnostic'))
  if (timeout) f.expire()
  else f.child.emit('close', code, signal)
  const result = await pending
  assert.deepEqual(result.transport, { event: 'QA_TRANSPORT_EXIT', program: 'docker', phase: 'TEST_PHASE', elapsedMs: 250,
    timeoutMs: 600000, timeoutKind: timeout ? 'TRANSPORT_TIMEOUT' : null, status: code, signal, errorCode: null, nativeError: null })
  assert.equal(result.status === 0, name === 'success')
  assert.equal(result.stdout, 'output\n'); assert.equal(result.stderr, 'diagnostic')
  assert.equal(f.calls.filter(call => call.spawn).length, 1, 'No automatic retry')
  assert.deepEqual(f.calls.filter(call => call.timeoutMs), [{ timeoutMs: 600000 }])
  assert.deepEqual(f.cancelled, [1])
  if (timeout) assert.deepEqual(f.calls.filter(call => call.killedWith), [{ killedWith: 'SIGTERM' }])
  assert.equal(JSON.stringify(result.transport).includes('SYNTHETIC_'), false)
})

for (const synchronous of [false, true]) test(`transport preserves sanitized native spawn error; synchronous=${synchronous}`, async () => {
  const f = transportFixture()
  const nativeError = Object.assign(new Error('spawn SYNTHETIC_SECRET ENOENT'), { code: 'ENOENT', spawnargs: ['SYNTHETIC_SECRET'] })
  if (synchronous) f.runtime.spawn = () => { throw nativeError }
  const pending = observeTransport('docker', ['exec'], undefined, 120000,
    { phase: 'SPAWN_TEST', sanitize: value => value.replaceAll('SYNTHETIC_SECRET', '[REDACTED]') }, f.runtime)
  if (!synchronous) f.child.emit('error', nativeError)
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'ENOENT')
    assert.equal(error.transport.errorCode, 'ENOENT')
    assert.equal(error.transport.phase, 'SPAWN_TEST')
    assert.equal(error.transport.nativeError.message, 'spawn [REDACTED] ENOENT')
    assert.equal(error.message.includes('SYNTHETIC_SECRET'), false)
    assert.equal(JSON.stringify(error.transport).includes('spawnargs'), false)
    return true
  })
})

test('transport records one completion when error is followed by close', async () => {
  const f = transportFixture()
  const pending = observeTransport('docker', [], undefined, undefined, {}, f.runtime)
  f.child.emit('error', Object.assign(new Error('synthetic'), { code: 'ENOENT' }))
  f.child.emit('close', -2, null)
  await assert.rejects(pending, error => error.transport.errorCode === 'ENOENT')
  assert.deepEqual(f.cancelled, [1])
  assert.deepEqual(f.calls.filter(call => call.timeoutMs), [{ timeoutMs: 120000 }])
})

test('transport observes real synthetic child exit and termination without Docker', async () => {
  const failed = await observeTransport(process.execPath, ['-e', 'process.exit(7)'], undefined, 10000, { phase: 'REAL_EXIT' })
  assert.equal(failed.status, 7); assert.equal(failed.transport.signal, null)
  const timeout = await observeTransport(process.execPath, ['-e', 'setInterval(()=>{},1000)'], undefined, 100, { phase: 'REAL_TIMEOUT' })
  assert.equal(timeout.status, null); assert.equal(timeout.transport.timeoutKind, 'TRANSPORT_TIMEOUT')
  assert.equal(timeout.transport.signal, 'SIGTERM')
})

test('both runners retain strict failure checks, diagnostics and original timeout budgets', () => {
  const runner = readFileSync('scripts/qa/serpro/s2-2r-contained-qa.mjs', 'utf8')
  const validation = readFileSync('scripts/qa/serpro/s2-2s-local-validation.mjs', 'utf8')
  assert.ok(runner.includes('timeout = 120000'))
  assert.ok(runner.includes('if (result.status === 0) return stdout'))
  assert.ok(runner.includes('report.errorDetails ='))
  assert.ok(runner.includes('error.transport = result.transport'))
  assert.ok(validation.includes('timeout = 600000'))
  assert.ok(validation.includes('assert.equal(result.status, 0,'))
  assert.ok(validation.includes("'--quality-linux'], 1800000)"))
  assert.ok(validation.includes('report.errorTransport ='))
})
