import assert from 'node:assert/strict'
import { readFile, writeFile, statfs } from 'node:fs/promises'
import { cpus, freemem, totalmem, hostname } from 'node:os'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { resolve } from 'node:path'
import { docker, nativeSupabaseCli } from '../../email-intake/disposable-resources.mjs'
import { configureDisposableToml } from '../../perf9e/clean-room-lib.mjs'
import { observeBootstrap, scrub } from './r1-17-bootstrap-observer.mjs'
import { verifyPreservation } from './r1-18-preservation.mjs'
import { hash } from './r1-4-restorer.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const exec = promisify(execFile), reportDir = 'rehearsal/reports/'
const save = (name, data) => writeFile(reportDir + name + '.json', JSON.stringify(data, null, 2) + '\n')
const cp = JSON.parse(await readFile(reportDir + 'R1_18_CHECKPOINT.json', 'utf8'))
const baseConfig = await readFile('supabase/config.toml', 'utf8')
const setFlag = (s, flag) => { assert.equal((s.match(/\[realtime\]\r?\nenabled = (?:true|false)/g) ?? []).length, 1); return s.replace(/(\[realtime\]\r?\nenabled = )(?:true|false)/, '$1' + flag) }
const variantA = setFlag(baseConfig, false), variantB = setFlag(baseConfig, true)
assert.equal(setFlag(variantA, true), variantB)
const aLines = variantA.split(/\r?\n/), bLines = variantB.split(/\r?\n/)
const diff = aLines.flatMap((l, i) => l === bLines[i] ? [] : [{ line: i + 1, field: 'realtime.enabled', A: l, B: bLines[i] }])
assert.equal(diff.length, 1)
const cli = await nativeSupabaseCli()
const cliVersion = (await exec(cli, ['--version'], { windowsHide: true })).stdout.trim()
const engine = JSON.parse(await docker(['info', '--format', '{{json .}}']))
const comparison = { at: new Date().toISOString(), result: 'IN_PROGRESS', isolated: 'PASS', diff, baseConfigSha256: hash(baseConfig), normalizedASha256: hash(variantA), normalizedBSha256: hash(variantB), cliVersion, engineVersion: engine.ServerVersion, host: hostname(), worktree: resolve('.'), exclusions: 'realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor', order: ['A1', 'B1', 'B2', 'A2'], applicationMigrations: 0, historicalCause: 'UNKNOWABLE_FROM_RETAINED_EVIDENCE', runs: [] }
await save('R1_18_CONFIG_AB_COMPARISON', comparison)
const cpuTimes = () => cpus().reduce((s, c) => ({ idle: s.idle + c.times.idle, total: s.total + Object.values(c.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 })
async function hostSnapshot() {
  const before = cpuTimes(); await delay(300); const after = cpuTimes(), disk = await statfs('.')
  return { at: new Date().toISOString(), freeDiskBytes: disk.bavail * disk.bsize, availableMemoryBytes: freemem(), totalMemoryBytes: totalmem(), approximateCpuBusyPercent: 100 * (1 - (after.idle - before.idle) / Math.max(1, after.total - before.total)) }
}
function startEvents(projectId) {
  let buffer = '', stderr = ''
  const events = [], errors = []
  const child = spawn('docker', ['events', '--since', new Date().toISOString(), '--filter', `label=com.supabase.cli.project=${projectId}`, '--format', '{{json .}}'], { windowsHide: true })
  child.on('error', e => errors.push(scrub(e.message)))
  child.stderr.on('data', b => { stderr += b })
  child.stdout.on('data', b => {
    buffer += b
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1)
      try { const e = JSON.parse(line); events.push({ time: e.time, timeNano: e.timeNano, type: e.Type, action: e.Action, id: e.Actor?.ID, name: e.Actor?.Attributes?.name, exitCode: e.Actor?.Attributes?.exitCode }) } catch { errors.push('EVENT_JSON_PARSE_FAILED') }
    }
  })
  return async () => { const closed = new Promise(done => child.once('close', done)); child.kill(); await closed; return { events, errors, stderr: scrub(stderr) } }
}
async function readiness({ spec, root, cli, env, evidence }, rounds = 1) {
  const result = await exec(cli, ['status', '--output', 'json', '--workdir', root], { env, windowsHide: true, timeout: 30000 })
  const local = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'), result.stdout.lastIndexOf('}') + 1))
  assert.equal(new URL(local.API_URL).origin, `http://127.0.0.1:${spec.apiPort}`)
  evidence.httpReadiness = []
  for (let round = 0; round < rounds; round++) {
    for (const path of ['/rest/v1/', '/auth/v1/health']) {
      const response = await fetch(local.API_URL + path, { headers: { apikey: local.ANON_KEY }, signal: AbortSignal.timeout(10000) })
      evidence.httpReadiness.push({ round, path, status: response.status, at: new Date().toISOString() })
      await response.body?.cancel()
      assert.equal(response.status, 200, 'HTTP_NOT_READY:' + path)
    }
    if (round < rounds - 1) await delay(3000)
  }
}
async function run(label, index, source, full = false) {
  const projectId = `bw_email03_r118${label.toLowerCase()}_${Date.now()}`
  const before = await hostSnapshot(), stopEvents = startEvents(projectId)
  let observed, eventResult
  console.log(JSON.stringify({ stage: label, projectId, result: 'STARTING' }))
  try { observed = await observeBootstrap(index, { projectId, basePort: 58400 + index * 10, configSource: source, afterHealthy: ctx => readiness(ctx, full ? 3 : 1) }) }
  finally { eventResult = await stopEvents() }
  const { evidence } = observed
  assert.equal(eventResult.errors.length, 0, 'EVENT_CAPTURE_FAILED')
  assert(eventResult.events.length > 0, 'NO_DOCKER_EVENTS_CAPTURED')
  const actualConfig = await readFile(`rehearsal/tmp/${projectId}/supabase/config.toml`, 'utf8')
  assert.equal(hash(actualConfig), hash(configureDisposableToml(source, evidence.spec)), 'RUN_CONFIG_CHANGED')
  const imageIds = [...new Set(evidence.timeline.flatMap(s => s.containers.map(c => c.imageId)))]
  const images = []
  for (const id of imageIds) { const image = JSON.parse(await docker(['image', 'inspect', id]))[0]; images.push({ id, tags: image.RepoTags, digests: image.RepoDigests }) }
  const health = evidence.timeline.flatMap(s => s.containers.filter(c => c.name === `supabase_storage_${projectId}`).map(c => ({ atMs: s.atMs, health: c.health, oomKilled: c.oomKilled, restarts: c.restartCount })))
  const finalServices = evidence.timeline.at(-1).containers.map(c => ({ service: c.name.replace(`_${projectId}`, ''), imageId: c.imageId, healthcheck: c.healthcheck ?? null })).sort((a, b) => a.service.localeCompare(b.service))
  const r = { label, projectId, result: evidence.result, report: observed.file, configSha256: hash(actualConfig), cliVersion, engineVersion: engine.ServerVersion, hostBefore: before, hostAfter: await hostSnapshot(), startedAt: evidence.startTimestamp, startupMs: evidence.startupMs, firstStorageHealthyMs: health.find(h => h.health.Status === 'healthy')?.atMs, storageHealth: health, images, finalServices, dockerEvents: eventResult, cleanup: evidence.cleanup, failure: evidence.failure }
  await save(projectId + '-telemetry', r)
  assert.equal(evidence.cleanup, 'PASS')
  return r
}
try {
  for (const [index, label] of comparison.order.entries()) {
    const r = await run(label, index, label.startsWith('A') ? variantA : variantB)
    comparison.runs.push(r)
    await save('R1_18_CONFIG_AB_RUNS', { result: 'IN_PROGRESS', runs: comparison.runs })
    await save('R1_18_CONFIG_AB_COMPARISON', comparison)
    if (comparison.runs.filter(x => x.result === 'FAIL').length >= 2) throw new Error('REPEATED_BOOTSTRAP_FAILURE_STOP')
  }
  assert(comparison.runs.every(r => r.result === 'PASS'), 'BOOTSTRAP_FAILURE_REQUIRES_DIAGNOSIS')
  for (const r of comparison.runs) {
    assert.deepEqual(r.finalServices, comparison.runs[0].finalServices, 'SERVICE_IMAGES_OR_HEALTHCHECKS_DIFFER')
    assert(r.storageHealth.every(h => !h.oomKilled && h.restarts === 0 && h.health.Status !== 'unhealthy'))
  }
  const times = comparison.runs.map(r => r.firstStorageHealthyMs)
  comparison.timing = { milliseconds: times, spreadMs: Math.max(...times) - Math.min(...times), toleranceMs: 15000, rationale: 'All four starts must be healthy without retries/OOM/restarts; >15s timing spread requires manual review, not automatic causal classification.' }
  assert(comparison.timing.spreadMs <= comparison.timing.toleranceMs, 'TIMING_DIFFERENCE_REQUIRES_REVIEW')
  comparison.result = 'PASS'; comparison.realtimeFlagCausality = 'NOT_SUPPORTED'; comparison.historicalFailure = 'UNREPRODUCIBLE_LOCAL_BOOTSTRAP_FAILURE'; comparison.currentBootstrapReproducibility = 'PASS'
  comparison.gateReplacement = 'User-authorized R1.18 case 1: current reproducibility replaces impossible exact historical-cause gate; no historical cause claimed.'
  await save('R1_18_CONFIG_AB_COMPARISON', comparison)
  await save('R1_18_CONFIG_AB_RUNS', { result: 'PASS', runs: comparison.runs })
  const full = { result: 'IN_PROGRESS', necessaryServices: ['db', 'rest', 'auth', 'storage', 'kong'], source: 'Canonical repository config; identical service set used by supplemental freshStack', runs: [] }
  for (const index of [4, 5]) {
    const r = await run('F' + (index - 3), index, baseConfig, true); full.runs.push(r)
    await save('R1_18_BOOTSTRAP_STABILITY', full)
    assert.equal(r.result, 'PASS', 'FULL_CAPABILITY_BOOTSTRAP_FAILED')
  }
  full.result = 'PASS'; await save('R1_18_BOOTSTRAP_STABILITY', full)
} catch (error) {
  comparison.result = 'STOPPED'; comparison.failure = { message: scrub(error.message), code: error.code }; process.exitCode = 1
  await save('R1_18_CONFIG_AB_COMPARISON', comparison)
} finally {
  comparison.preservation = await verifyPreservation(['scripts/qa/reconciliation/r1-17-bootstrap-observer.mjs'])
  assert.deepEqual(comparison.preservation.docker, 'PREEXISTING_PRESERVED')
  assert.equal(hash(await readFile('supabase/config.toml')), hash(baseConfig))
  assert.equal(cp.head, '2e8146ebe7582c5bdc10ddee1f8862d806607ee2')
  await save('R1_18_CONFIG_AB_COMPARISON', comparison)
}
console.log(JSON.stringify({ result: comparison.result, runs: comparison.runs.map(r => ({ label: r.label, result: r.result, firstHealthyMs: r.firstStorageHealthyMs })), failure: comparison.failure }))
