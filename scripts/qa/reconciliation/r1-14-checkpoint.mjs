import assert from 'node:assert/strict'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { gitBytes } from './r1-5-migration-source.mjs'
import { hash } from './r1-4-restorer.mjs'
import { inventory } from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2), ['--local-only'])
const git = args => gitBytes(args).toString().trim()
assert.equal(git(['branch','--show-current']), 'reconcile/main-homolog-2026-10-06')
assert.equal(git(['rev-parse','HEAD']), '2e8146ebe7582c5bdc10ddee1f8862d806607ee2')
const files = []
for (const path of [...new Set(gitBytes(['ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean))].sort()) files.push({ path, sha256:hash(await readFile(path)) })
const reports = []
for (const n of (await readdir('rehearsal/reports')).sort()) {
  if (!n.startsWith('R1_14_') && /\.(json|md|txt)$/.test(n)) {
    const path = 'rehearsal/reports/' + n
    reports.push({ path, sha256:hash(await readFile(path)) })
  }
}
const report = { at:new Date().toISOString(), result:'PASS', branch:git(['branch','--show-current']), head:git(['rev-parse','HEAD']), status:git(['status','--short']), files, reports, docker:await inventory(), remoteCalls:0 }
await writeFile('rehearsal/reports/R1_14_CHECKPOINT.json', JSON.stringify(report,null,2)+'\n', {flag:'wx'})
console.log(JSON.stringify({result:'PASS',files:files.length,reports:reports.length}))
