import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, cp, symlink, unlink, rm, readdir } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { gitBytes } from './r1-5-migration-source.mjs'
import { inventory } from '../../email-intake/disposable-resources.mjs'
import { sanitizedLocalEnvironment, redactCommandOutput } from '../../perf9e/clean-room-lib.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
assert.equal(JSON.parse(await readFile('rehearsal/reports/R1_18_LINUX_BUILD.json', 'utf8')).result, 'PASS')
const before = await inventory(), tempBase = resolve('rehearsal/tmp'), reports = resolve('rehearsal/reports')
const root = await mkdtemp(resolve(tempBase, 'r119-resume-ci-')), archive = resolve(reports, 'R1_19_RESUME_CI_REHEARSAL')
await mkdir(archive, { recursive: true })
const result = { at: new Date().toISOString(), result: 'IN_PROGRESS', tempRoot: root, githubCi: 'NOT_RUN', remoteCalls: 0 }
const env = sanitizedLocalEnvironment()
for (const k of Object.keys(env)) if (/SUPABASE|DATABASE|POSTGRES|SECRET|PASSWORD|TOKEN|CREDENTIAL|OPENAI/i.test(k)) delete env[k]
let linked = false
async function run(script) {
  return await new Promise((done, reject) => {
    const p = spawn(process.execPath, ['scripts/qa/reconciliation/' + script, '--local-only'], { cwd: root, env, windowsHide: true })
    let output = ''
    for (const s of [p.stdout, p.stderr]) s.on('data', b => { output += b; if (s === p.stdout) process.stdout.write(redactCommandOutput(b.toString())) })
    p.once('error', reject); p.once('close', code => done({ code, output }))
  })
}
try {
  execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', process.cwd(), root], { env, windowsHide: true })
  gitBytes(['config', 'core.autocrlf', 'true'], root); gitBytes(['read-tree', 'HEAD'], root)
  for (const f of [...new Set(gitBytes(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean))]) {
    assert(!f.split('/').includes('..') && !f.split('/').some(n => n.startsWith('.env')))
    const target = resolve(root, f); assert(target.startsWith(root + sep)); await mkdir(dirname(target), { recursive: true }); await cp(f, target)
  }
  await symlink(resolve('node_modules'), resolve(root, 'node_modules'), 'junction'); linked = true
  const r = await run('r1-18-ci.mjs')
  await writeFile(resolve(archive, 'runner.log'), redactCommandOutput(r.output), { flag: 'wx' })
  assert.equal(r.code, 0, 'CI_REHEARSAL_STOP')
  result.result = 'PASS'
} catch (error) { result.result = 'FAIL_STOPPED'; result.failure = { message: redactCommandOutput(error.message), code: error.code }; process.exitCode = 1 }
finally {
  const cleanup = await run('r1-19-ci-cleanup.mjs')
  await writeFile(resolve(archive, 'cleanup.log'), redactCommandOutput(cleanup.output), { flag: 'wx' })
  assert.equal(cleanup.code, 0, 'CI_REHEARSAL_CLEANUP_FAILED')
  for (const name of await readdir(resolve(root, 'rehearsal/reports')).catch(() => [])) {
    if (name === 'R1_18_CI_SQL.json' || /^R1_19_CI_(credential|inline|cnab)_PREFLIGHT\.json$/.test(name) || /^bw_email03_r110(pa|cred|inl|cnab)_\d+-(resources|suite)\.json$/.test(name)) await cp(resolve(root, 'rehearsal/reports', name), resolve(archive, name))
  }
  assert.deepEqual(await inventory(), before, 'DOCKER_INVENTORY_CHANGED')
  if (linked) await unlink(resolve(root, 'node_modules'))
  assert(root.startsWith(tempBase + sep + 'r119-resume-ci-') && dirname(root) === tempBase)
  await rm(root, { recursive: true, force: false }); result.cleanup = 'PASS'
  await writeFile(resolve(reports, 'R1_19_RESUME_CI_SQL_REHEARSAL.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
}
console.log(JSON.stringify(result))
