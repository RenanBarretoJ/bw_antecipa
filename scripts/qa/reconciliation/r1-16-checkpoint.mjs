import assert from 'node:assert/strict'
import {readFile, writeFile, readdir} from 'node:fs/promises'
import {gitBytes} from './r1-5-migration-source.mjs'
import {hash} from './r1-4-restorer.mjs'
import {inventory} from '../../email-intake/disposable-resources.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const dir = 'rehearsal/reports/'
const read = async name => JSON.parse(await readFile(dir + name + '.json', 'utf8'))
const prior = await read('R1_15_RLS_1791405503672_CHECKPOINT')
const git = args => gitBytes(args).toString().trim()
assert.equal(git(['branch', '--show-current']), prior.branch)
assert.equal(git(['rev-parse', 'HEAD']), prior.head)
for (const f of [...prior.files, ...prior.reports]) {
  assert.equal(hash(await readFile(f.path)), f.sha256, 'PRIOR_EVIDENCE_CHANGED:' + f.path)
}
const files = [], reports = []
for (const path of [...new Set(gitBytes(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean))].sort()) {
  files.push({path, sha256: hash(await readFile(path))})
}
async function scan(dir) {
  for (const e of await readdir(dir, {withFileTypes: true})) {
    const path = dir + '/' + e.name
    if (e.isDirectory()) await scan(path)
    else reports.push({path, sha256: hash(await readFile(path))})
  }
}
await scan('rehearsal/reports')
const migrations = files.filter(f => f.path.startsWith('supabase/migrations/'))
assert.equal(migrations.length, 270)
const forwards = ['20261006201914_', '20261006210815_']
const recovered = '20261005173648_'
assert.equal(migrations.filter(f => ![...forwards, recovered].some(p => f.path.split('/').at(-1).startsWith(p))).length, 267)
assert.equal(migrations.find(f => f.path.includes(recovered)).sha256, '1006e35b48f871c4f14a72f7a3f2045b1f40c13f4bb80d7efeda0e26be8df3ac')
const cp = {at: new Date().toISOString(), branch: prior.branch, head: prior.head, status: git(['status', '--short']), result: 'PASS', priorCheckpoint: 'R1_15_RLS_1791405503672_CHECKPOINT.json', files, reports, migrations, docker: await inventory()}
await writeFile(dir + 'R1_16_CHECKPOINT.json', JSON.stringify(cp, null, 2) + '\n', {flag: 'wx'})
console.log(JSON.stringify({result: cp.result, files: files.length, reports: reports.length, migrations: migrations.length, historical: 267}))
