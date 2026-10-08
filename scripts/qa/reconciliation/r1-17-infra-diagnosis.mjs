import assert from 'node:assert/strict'
import { readFile, writeFile, readdir, statfs } from 'node:fs/promises'
import { freemem, totalmem } from 'node:os'
import { inventory, docker, nativeSupabaseCli } from '../../email-intake/disposable-resources.mjs'
import { hash } from './r1-4-restorer.mjs'
import { gitBytes } from './r1-5-migration-source.mjs'
import { assertFreePorts, observeBootstrap } from './r1-17-bootstrap-observer.mjs'
import { execFileSync } from 'node:child_process'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const read = async p => JSON.parse(await readFile(p, 'utf8'))
const reports = 'rehearsal/reports/'
const create = (name, data) => writeFile(reports + name + '.json', JSON.stringify(data, null, 2) + '\n', { flag: 'wx' })
assert.equal(gitBytes(['branch', '--show-current']).toString().trim(), 'reconcile/main-homolog-2026-10-06')
const head = gitBytes(['rev-parse', 'HEAD']).toString().trim()
assert.equal(head, '2e8146ebe7582c5bdc10ddee1f8862d806607ee2')
const prior = await read(reports + 'R1_16_AUTH_BASELINE_1791408722083_CHECKPOINT.json')
const priorStatus = await read(reports + 'R1_16_AUTH_STATUS.json')
for (const f of [...prior.files, ...prior.reports]) {
  const approved = priorStatus.preservation.changedQaHelpers.find(c => c.path === f.path)
  assert.equal(hash(await readFile(f.path)), approved?.after ?? f.sha256, 'PRIOR_ARTIFACT_CHANGED:' + f.path)
}
const manifests = await read(reports + 'R1_16_FORWARD_MANIFEST.json')
const auth = await read(reports + 'R1_16_AUTH_FORWARD_MANIFEST.json')
const forwards = [...manifests.entries, auth.entry]
assert.equal(forwards.length, 8)
for (const f of forwards) assert.equal(hash(await readFile(f.path)), f.sha256)
assert.equal(auth.entry.sha256, '49f2ee6142cfdd040e62a4d45e8e05897d3169392252a880baf3091a1b800430')
assert.equal(hash(await readFile('supabase/migrations/20261005173648_sacado_rls_non_sacado_short_circuit.sql')), '1006e35b48f871c4f14a72f7a3f2045b1f40c13f4bb80d7efeda0e26be8df3ac')
const checkpoint = { at: new Date().toISOString(), head, status: gitBytes(['status', '--short']).toString(), files: [], reports: [], docker: await inventory(), forwards }
for (const path of [...new Set(gitBytes(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean))].sort()) checkpoint.files.push({ path, sha256: hash(await readFile(path)) })
async function scan(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = dir + '/' + e.name
    if (e.isDirectory()) await scan(path)
    else checkpoint.reports.push({ path, sha256: hash(await readFile(path)) })
  }
}
await scan('rehearsal/reports')
await create('R1_17_CHECKPOINT', checkpoint)
const start = Date.now(), info = JSON.parse(await docker(['info', '--format', '{{json .}}']))
const disk = await statfs('.')
const cli = await nativeSupabaseCli()
const preflight = {
  at: new Date().toISOString(), result: 'PASS', docker: checkpoint.docker,
  daemon: { responseMs: Date.now() - start, version: info.ServerVersion, cpus: info.NCPU, memoryBytes: info.MemTotal },
  host: { freeMemoryBytes: freemem(), totalMemoryBytes: totalmem(), diskFreeBytes: disk.bavail * disk.bsize },
  cliVersion: execFileSync(cli, ['--version'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
  ports: await docker(['ps', '-a', '--format', '{{.Names}} | {{.Ports}}']),
  images: (await docker(['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'])).split('\n').filter(s => /supabase\/(postgres|storage-api|gotrue|realtime|postgrest|kong):/.test(s)),
}
for (const image of ['postgres:17.6.1.156', 'storage-api:v1.67.20', 'gotrue:v2.194.0', 'realtime:v2.120.3', 'postgrest:v14.15', 'kong:2.8.1']) assert(preflight.images.includes('public.ecr.aws/supabase/' + image), 'MISSING_PINNED_IMAGE:' + image)
assert(preflight.host.diskFreeBytes > 10 * 1024 ** 3)
await assertFreePorts([58300, 58301, 58302, 58303, 58304, 58307])
preflight.candidatePorts = 'FREE'
await create('R1_17_DOCKER_PREFLIGHT', preflight)
console.log(JSON.stringify({ stage: 'PREFLIGHT', result: 'PASS', preservedFiles: checkpoint.files.length, preservedReports: checkpoint.reports.length }))
const minimal = await observeBootstrap()
for (const f of [...checkpoint.files, ...checkpoint.reports]) assert.equal(hash(await readFile(f.path)), f.sha256, 'ARTIFACT_CHANGED:' + f.path)
assert.deepEqual(await inventory(), checkpoint.docker)
const old = await read(reports + 'bw_email03_r110cnab_1791409314726-suite.json')
const diagnosis = {
  at: new Date().toISOString(), rootCause: 'UNKNOWN', result: 'STOP_REQUIRED',
  oldFailure: { projectId: old.projectId, stage: old.stage, applicationMigrations: old.applied.length, message: old.failure.message },
  missingHistoricalEvidence: ['Container inspect/healthcheck history', 'Storage/DB/REST/Kong/Auth detailed logs', 'Resource utilization timeline'],
  minimalReport: minimal.file, minimalResult: minimal.evidence.result,
  conclusion: 'Current observation must be reviewed; successful startup alone cannot establish the cause of the historical unhealthy container.',
  existingWorkPreserved: 'PASS', businessCodeUnchanged: 'PASS', cleanup: 'PASS', remoteCalls: 0,
  docs: ['https://supabase.com/changelog.md', 'https://supabase.com/docs/reference/cli/supabase-start'],
}
await create('R1_17_STORAGE_BOOTSTRAP_DIAGNOSIS', diagnosis)
console.log(JSON.stringify({ stage: 'MINIMAL_BOOTSTRAP', result: minimal.evidence.result, report: minimal.file, cleanup: minimal.evidence.cleanup, requiresEvidenceReview: true }))
