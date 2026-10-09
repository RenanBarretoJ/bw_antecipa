import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { docker, inventory, disposableResources, nativeSupabaseCli } from '../../email-intake/disposable-resources.mjs'
import { configureDisposableToml, sanitizedLocalEnvironment, redactCommandOutput } from '../../perf9e/clean-room-lib.mjs'

const exec = promisify(execFile)
export function scrub(value) {
  return redactCommandOutput(value).split(/\r?\n/).map(line =>
    /password|secret|authorization|api[_ -]?key|access[_ -]?key|refresh[_ -]?token|publishable|sb_(?:secret|publishable)|PG Send:|PG Recv:/i.test(line)
      ? '[SENSITIVE_OR_PROTOCOL_LINE_REDACTED]' : line).join('\n')
}
export async function assertFreePorts(ports) {
  for (const port of ports) await new Promise((done, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ host: '0.0.0.0', port, exclusive: true }, () => server.close(done))
  })
}
const save = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n')

/** Observes only containers carrying this run's unique project label. Never reads Config.Env. */
async function sample(projectId, evidence, elapsedMs) {
  const names = (await docker(['ps', '-a', '--filter', `label=com.supabase.cli.project=${projectId}`, '--format', '{{.Names}}'])).split(/\r?\n/).filter(Boolean)
  const containers = []
  for (const name of names) {
    try {
      const data = JSON.parse(await docker(['inspect', name]))[0]
      assert.equal(data.Config.Labels['com.supabase.cli.project'], projectId)
      const safe = {
        name, image: data.Config.Image, imageId: data.Image,
        created: data.Created, status: data.State.Status, running: data.State.Running,
        exitCode: data.State.ExitCode, oomKilled: data.State.OOMKilled,
        startedAt: data.State.StartedAt, finishedAt: data.State.FinishedAt,
        error: scrub(data.State.Error), restartCount: data.RestartCount,
        health: data.State.Health ? { ...data.State.Health, Log: data.State.Health.Log.map(l => ({ ...l, Output: scrub(l.Output) })) } : null,
        healthcheck: data.Config.Healthcheck,
        mounts: data.Mounts.map(m => ({ type: m.Type, name: m.Name, destination: m.Destination, readWrite: m.RW })),
        ports: data.NetworkSettings.Ports,
        networks: Object.keys(data.NetworkSettings.Networks),
      }
      containers.push(safe)
      const log = await exec('docker', ['logs', '--timestamps', '--tail', '200', name], { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 })
      evidence.logs[name] = { atMs: elapsedMs, output: scrub(log.stdout + log.stderr) }
    } catch (error) {
      // Auto-removed bootstrap containers may disappear between ps, inspect and logs.
      evidence.observationErrors.push({ atMs: elapsedMs, name, message: scrub(error.message).slice(0, 400) })
    }
  }
  evidence.timeline.push({ atMs: elapsedMs, containers })
}

export async function observeBootstrap(index = 0, options = {}) {
  assert(Number.isInteger(index) && index >= 0 && index < 6)
  const nonce = Date.now(), projectId = options.projectId ?? `bw_email03_r117_${nonce}`
  const base = options.basePort ?? 58300 + index * 10
  const spec = { projectId, apiPort: base + 1, dbPort: base + 2, shadowPort: base, studioPort: base + 3, mailPort: base + 4, analyticsPort: base + 7 }
  await assertFreePorts(Object.values(spec).filter(v => typeof v === 'number'))
  const root = resolve('rehearsal/tmp', projectId)
  const file = `rehearsal/reports/${projectId}-bootstrap.json`
  const owned = await disposableResources({ projectId, file: `rehearsal/reports/${projectId}-resources.json`, tempDirs: [root] })
  const evidence = { projectId, spec, createdAt: new Date().toISOString(), result: 'IN_PROGRESS', applicationMigrations: 0, applicationTests: 0, timeline: [], logs: {}, observationErrors: [], cleanup: 'NOT_RUN' }
  await mkdir(resolve(root, 'supabase/migrations'), { recursive: true })
  await writeFile(resolve(root, 'supabase/config.toml'), configureDisposableToml(options.configSource ?? await readFile('supabase/config.toml', 'utf8'), spec))
  const cli = await nativeSupabaseCli()
  const env = sanitizedLocalEnvironment()
  for (const key of Object.keys(env)) if (/SUPABASE|DATABASE|POSTGRES|EMAIL_INTAKE|SECRET|PASSWORD|TOKEN|CREDENTIAL|OPENAI|S3_/i.test(key)) delete env[key]
  const startedAt = Date.now()
  evidence.startTimestamp = new Date(startedAt).toISOString()
  let settled = false, output = '', stdout = '', stderr = '', timer, child
  try {
    const completed = new Promise((done, reject) => {
      child = spawn(cli, ['start', '--debug', '--exclude', 'realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor', '--workdir', root], { env, windowsHide: true })
      child.stdout.on('data', b => { output += b; stdout += b })
      child.stderr.on('data', b => { output += b; stderr += b })
      child.once('error', error => { settled = true; reject(error) })
      child.once('close', (code, signal) => { settled = true; done({ code, signal }) })
      timer = setTimeout(() => { evidence.safetyTimeout = '10_MINUTES_OBSERVATION_LIMIT'; child.kill() }, 600000)
    })
    while (!settled) {
      await sample(projectId, evidence, Date.now() - startedAt)
      evidence.startOutput = scrub(output)
      await save(file, evidence)
      await delay(2000)
    }
    evidence.start = await completed
    clearTimeout(timer)
    await sample(projectId, evidence, Date.now() - startedAt)
    evidence.startOutput = scrub(output)
    evidence.startupMs = Date.now() - startedAt
    await owned.capture()
    const last = evidence.timeline.at(-1).containers
    assert.equal(evidence.start.code, 0, 'BOOTSTRAP_CLI_FAILED')
    for (const service of ['db', 'auth', 'storage', 'rest', 'kong']) {
      const container = last.find(c => c.name === `supabase_${service}_${projectId}`)
      assert(container?.running, `SERVICE_NOT_RUNNING:${service}`)
      if (container.health) assert.equal(container.health.Status, 'healthy', `SERVICE_NOT_HEALTHY:${service}`)
    }
    assert.equal(last.find(c => c.name === `supabase_storage_${projectId}`).health?.Status, 'healthy')
    if (options.afterHealthy) {
      await options.afterHealthy({ spec, root, cli, env, evidence })
      await sample(projectId, evidence, Date.now() - startedAt)
      for (const c of evidence.timeline.at(-1).containers) {
        assert(c.running, 'SERVICE_STOPPED_DURING_READINESS')
        if (c.health) assert.equal(c.health.Status, 'healthy', 'HEALTH_REGRESSED_DURING_READINESS')
      }
    }
    evidence.result = 'PASS'
  } catch (error) {
    evidence.result = 'FAIL'
    evidence.failure = { code: error.code, message: scrub(error.message) }
  } finally {
    clearTimeout(timer)
    evidence.startOutput = scrub(output)
    evidence.stdout = scrub(stdout)
    evidence.stderr = scrub(stderr)
    await save(file, evidence)
    await owned.cleanup(async () => {
      await exec(cli, ['stop', '--project-id', projectId, '--no-backup', '--workdir', root], { env, windowsHide: true, timeout: 120000 })
    })
    evidence.cleanup = 'PASS'
    assert.deepEqual(await inventory(), owned.manifest.before, 'PREEXISTING_INVENTORY_CHANGED')
    await save(file, evidence)
  }
  return { file, evidence }
}
