import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, cp, symlink, unlink, rm, lstat, access } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { gitBytes } from './r1-5-migration-source.mjs'
import { hash } from './r1-4-restorer.mjs'
import { sanitizedLocalEnvironment, redactCommandOutput } from '../../perf9e/clean-room-lib.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const reports = resolve('rehearsal/reports')
for (const name of ['R1_18_FINAL_SQL_WORKFLOW', 'R1_18_TARGET_CATALOG']) {
  assert.equal(JSON.parse(await readFile(resolve(reports, name + '.json'), 'utf8')).result, 'PASS', name)
}
const record = { at: new Date().toISOString(), result: 'IN_PROGRESS', node: process.version, platform: process.platform, gates: [], remoteWrites: 0 }
const reportPath = resolve(reports, 'R1_18_FINAL_QUALITY.json')
await writeFile(reportPath, JSON.stringify(record, null, 2), { flag: 'wx' })
const save = () => writeFile(reportPath, JSON.stringify(record, null, 2) + '\n')
const tempBase = resolve('rehearsal/tmp')
await mkdir(tempBase, { recursive: true })
const source = await mkdtemp(resolve(tempBase, 'r118-quality-'))
let linked = false
const env = sanitizedLocalEnvironment()
for (const key of Object.keys(env)) if (/SUPABASE|DATABASE|POSTGRES|SECRET|PASSWORD|TOKEN|CREDENTIAL|OPENAI|CHROME/i.test(key)) delete env[key]
Object.assign(env, { NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ci-placeholder-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'ci-placeholder-service-role-key', PORTAL_FIDC_CREDENTIALS_JSON: '{}' })
async function command(name, executable, args, cwd = source) {
  console.log(JSON.stringify({ stage: name, result: 'STARTING' }))
  const start = Date.now()
  const result = await new Promise((done, reject) => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true })
    let output = ''
    for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { output += b })
    child.once('error', reject); child.once('close', code => done({ code, output }))
  })
  const log = resolve(reports, 'R1_18_QUALITY_' + name + '.log')
  await writeFile(log, redactCommandOutput(result.output), { flag: 'wx' })
  record.gates.push({ name, result: result.code === 0 ? 'PASS' : 'FAIL', exitCode: result.code, durationMs: Date.now() - start, log, command: [executable, ...args] })
  await save(); console.log(JSON.stringify(record.gates.at(-1)))
  assert.equal(result.code, 0, 'QUALITY_STOP:' + name)
}
try {
  assert.equal(process.versions.node.split('.')[0], '24')
  const pkgBytes = await readFile('package.json'), lockBytes = await readFile('package-lock.json')
  const pkg = JSON.parse(pkgBytes), lock = JSON.parse(lockBytes)
  for (const key of ['dependencies', 'devDependencies', 'engines']) assert.deepEqual(lock.packages[''][key], pkg[key], 'LOCK_ROOT_DRIFT:' + key)
  record.package = { result: 'PASS_ROOT_CONTRACT', packageHash: hash(pkgBytes), lockHash: hash(lockBytes), declaredEngine: pkg.engines.node, qaRuntime: process.version, engineChanged: false }
  const { default: sharp } = await import('sharp')
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#0055cc' } }).png().toBuffer()
  assert.equal((await sharp(png).metadata()).width, 2)
  record.sharp = { result: 'PASS', version: sharp.versions.sharp, bytes: png.length }
  // Fresh source projection prevents ignored historical rehearsal copies from entering
  // the global tsconfig/eslint globs. Every current Git-visible source is retained.
  const paths = [...new Set(gitBytes(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean))].sort()
  const files = []
  for (const path of paths) {
    assert(!path.split('/').includes('..') && !path.split('/').some(p => p.startsWith('.env')), 'UNSAFE_SOURCE_PATH')
    const origin = resolve(path), destination = resolve(source, path)
    assert(destination.startsWith(source + sep))
    assert((await lstat(origin)).isFile(), 'SOURCE_MUST_BE_REGULAR_FILE:' + path)
    await mkdir(dirname(destination), { recursive: true }); await cp(origin, destination)
    const sha256 = hash(await readFile(origin)); assert.equal(hash(await readFile(destination)), sha256)
    files.push({ path, sha256 })
  }
  record.sourceProjection = { path: source, count: files.length, sha256: hash(JSON.stringify(files)), files, secretsCopied: false, ignoredRuntimeCopied: false }
  await symlink(resolve('node_modules'), resolve(source, 'node_modules'), 'junction'); linked = true
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  await access(chrome); env.CHROME_PATH = chrome
  await save()
  await command('pdf-runtime', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/lib/pdf/gerarContrato.runtime.test.ts', '--pool=threads', '--maxWorkers=1', '--no-file-parallelism'])
  await command('typescript', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'])
  await command('full-suite', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--pool=threads', '--maxWorkers=1', '--no-file-parallelism'])
  await command('lint', process.execPath, ['node_modules/eslint/bin/eslint.js', '.'])
  await command('diff-check', 'git', ['diff', '--check'], process.cwd())
  await command('staged-diff-check', 'git', ['diff', '--cached', '--check'], process.cwd())
  for (const f of files) assert.equal(hash(await readFile(f.path)), f.sha256, 'SOURCE_CHANGED_DURING_QUALITY:' + f.path)
  record.result = 'PASS'
} catch (error) {
  record.result = 'FAIL_STOPPED'; record.failure = { message: redactCommandOutput(error.message), code: error.code }; process.exitCode = 1
} finally {
  // Remove the junction itself, never its shared dependency target.
  if (linked) { assert((await lstat(resolve(source, 'node_modules'))).isSymbolicLink()); await unlink(resolve(source, 'node_modules')) }
  assert(source.startsWith(tempBase + sep + 'r118-quality-') && dirname(source) === tempBase)
  await rm(source, { recursive: true, force: false })
  record.sourceCleanup = 'PASS'; await save()
}
console.log(JSON.stringify({ result: record.result, gates: record.gates, failure: record.failure, sourceCleanup: record.sourceCleanup }))
