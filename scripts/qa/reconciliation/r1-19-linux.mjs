import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, cp, rm, lstat } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { gitBytes } from './r1-5-migration-source.mjs'
import { hash } from './r1-4-restorer.mjs'
import { docker, disposableResources } from '../../email-intake/disposable-resources.mjs'
import { redactCommandOutput } from '../../perf9e/clean-room-lib.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
assert.equal(JSON.parse(await readFile('rehearsal/reports/R1_18_FINAL_QUALITY.json', 'utf8')).result, 'PASS')
const nonce = Date.now(), projectId = 'bw_email05_r119linux_' + nonce
const runner = 'supabase_runner_' + projectId, volume = 'supabase_source_' + projectId
const reports = resolve('rehearsal/reports'), tempBase = resolve('rehearsal/tmp')
await mkdir(tempBase, { recursive: true })
const root = await mkdtemp(resolve(tempBase, 'r119-linux-'))
const owned = await disposableResources({ projectId, runnerId: runner, tempDirs: [root], file: resolve(reports, projectId + '-resources.json') })
const report = { at: new Date().toISOString(), result: 'IN_PROGRESS', projectId, gates: [], remoteEnvironmentCalls: 0 }
const file = resolve(reports, 'R1_19_LINUX_BUILD.json')
await writeFile(file, JSON.stringify(report), { flag: 'wx' })
const save = () => writeFile(file, JSON.stringify(report, null, 2) + '\n')
async function run(name, args) {
  console.log(JSON.stringify({ stage: name, result: 'STARTING' }))
  const start = Date.now()
  const result = await new Promise((done, reject) => {
    const child = spawn('docker', ['exec', runner, ...args], { windowsHide: true })
    let output = ''
    for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { output += b })
    child.once('error', reject); child.once('close', code => done({ code, output }))
  })
  const log = resolve(reports, 'R1_19_LINUX_' + name + '.log')
  await writeFile(log, redactCommandOutput(result.output), { flag: 'wx' })
  report.gates.push({ name, result: result.code === 0 ? 'PASS' : 'FAIL', exitCode: result.code, durationMs: Date.now() - start, args, log })
  await save(); console.log(JSON.stringify(report.gates.at(-1)))
  assert.equal(result.code, 0, 'LINUX_STOP:' + name)
}
try {
  const image = JSON.parse(await docker(['image', 'inspect', 'bw-email05-r3-linux-qa:latest']))[0]
  report.image = { id: image.Id, tags: image.RepoTags, preexisting: true }
  const files = []
  for (const path of [...new Set(gitBytes(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean))].sort()) {
    assert(!path.split('/').includes('..') && !path.split('/').some(p => p.startsWith('.env')))
    const target = resolve(root, path); assert(target.startsWith(root + sep)); assert((await lstat(path)).isFile())
    await mkdir(dirname(target), { recursive: true }); await cp(path, target)
    const sha256 = hash(await readFile(path)); assert.equal(hash(await readFile(target)), sha256)
    files.push({ path, sha256 })
  }
  report.source = { files, sha256: hash(JSON.stringify(files)), secretsCopied: false, ignoredRuntimeCopied: false }
  const label = 'com.supabase.cli.project=' + projectId
  await docker(['volume', 'create', '--label', label, volume]); await owned.capture()
  // No Docker socket, host networking, production env or published port.
  await docker(['run', '-d', '--init', '--name', runner, '--label', label, '--cap-add', 'SYS_ADMIN', '--shm-size', '512m',
    '-v', root + ':/input:ro', '-v', volume + ':/workspace', '-w', '/workspace',
    '-e', 'NEXT_TELEMETRY_DISABLED=1', '-e', 'NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co',
    '-e', 'NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-anon-key', '-e', 'SUPABASE_SERVICE_ROLE_KEY=ci-placeholder-service-role-key',
    '-e', 'PORTAL_FIDC_CREDENTIALS_JSON={}', '-e', 'CHROME_PATH=/usr/bin/google-chrome', image.Id, 'sleep', 'infinity'])
  await owned.capture()
  await docker(['exec', '-u', 'root', runner, 'chown', 'node:node', '/workspace'])
  await run('source-copy', ['node', '--input-type=module', '-e', "import {readdir,cp} from 'node:fs/promises'; for(const n of await readdir('/input'))await cp('/input/'+n,'/workspace/'+n,{recursive:true});"])
  await run('runtime', ['node', '--input-type=module', '-e', "import assert from 'node:assert/strict'; assert.equal(process.platform,'linux'); assert.equal(process.versions.node.split('.')[0],'22');console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch}));"])
  await run('npm-ci', ['npm', 'ci', '--no-audit', '--no-fund'])
  await run('sharp', ['node', '--input-type=module', '-e', "import assert from 'node:assert/strict';import sharp from 'sharp';const b=await sharp({create:{width:2,height:2,channels:4,background:'#0055cc'}}).png().toBuffer();assert.equal((await sharp(b).metadata()).width,2);console.log(JSON.stringify({result:'PASS',version:sharp.versions.sharp,bytes:b.length}));"])
  await run('pdf', ['node', 'node_modules/vitest/vitest.mjs', 'run', 'src/lib/pdf/gerarContrato.runtime.test.ts', '--pool=threads', '--maxWorkers=1', '--no-file-parallelism'])
  await run('typescript', ['node', 'node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'])
  await run('full-suite', ['node', 'node_modules/vitest/vitest.mjs', 'run', '--pool=threads', '--maxWorkers=1', '--no-file-parallelism'])
  await run('lint', ['node', 'node_modules/eslint/bin/eslint.js', '.'])
  await run('build', ['node', 'node_modules/next/dist/bin/next', 'build', '--webpack'])
  for (const f of files) assert.equal(hash(await readFile(f.path)), f.sha256, 'SOURCE_CHANGED_DURING_LINUX:' + f.path)
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL_STOPPED'; report.failure = { message: redactCommandOutput(error.message), code: error.code }; process.exitCode = 1 }
finally {
  await owned.cleanup(async () => {}); report.dockerCleanup = 'PASS'
  assert(root.startsWith(tempBase + sep + 'r119-linux-') && dirname(root) === tempBase)
  await rm(root, { recursive: true, force: false }); report.sourceCleanup = 'PASS'
  await save()
}
console.log(JSON.stringify({ result: report.result, failure: report.failure, dockerCleanup: report.dockerCleanup, sourceCleanup: report.sourceCleanup }))
