import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileSha256 } from '../../perf9e/clean-room-lib.mjs'
import { inventory } from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const json=async p=>JSON.parse(await readFile(p,'utf8'))
const before=await json('rehearsal/reports/R1_4_CHECKPOINT.json')
const prior=await json('rehearsal/reports/R1_3_WORKTREE_BEFORE.json')
const changed=before.files.filter(f=>fileSha256(f.path)!==f.sha256).map(f=>({path:f.path,before:f.sha256,after:fileSha256(f.path)}))
const permitted=new Set([
  'scripts/qa/reconciliation/r1-full-upgrades.mjs',
  'scripts/qa/reconciliation/r1-2-storage.mjs',
  'scripts/qa/reconciliation/r1-4-capture-fidelity.mjs',
])
assert(changed.every(f=>permitted.has(f.path)),'UNEXPECTED_PREEXISTING_EDIT')
for(const key of ['baselineFiles','historicalMigrations'])for(const f of prior[key])assert.equal(fileSha256(f.path),f.sha256,f.path)
for(const f of prior.additions)if(f.path!=='scripts/qa/reconciliation/r1-2-storage.mjs')assert.equal(fileSha256(f.path),f.sha256,f.path)
const git=args=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim()
assert.equal(git(['rev-parse','HEAD']),before.head)
assert.equal(git(['branch','--show-current']),before.branch)
const docker=await inventory()
for(const kind of Object.keys(docker)){
  assert(before.docker[kind].every(n=>docker[kind].includes(n)),`PREEXISTING_${kind}_REMOVED`)
  assert(!docker[kind].some(n=>/bw_email03_r1(?:4probe|full_(?:prod|homolog))_\d+/.test(n)),`OWNED_${kind}_REMAIN`)
}
const report={at:new Date().toISOString(),result:'PASS',head:before.head,branch:before.branch,
  baselineFilesUnchanged:prior.baselineFiles.length,historicalMigrationsUnchanged:prior.historicalMigrations.length,
  changedCheckpointFiles:changed,priorAdditionsException:'r1-2-storage.mjs: extend only owned Docker project namespace; loopback origin unchanged',
  dockerPreexistingPreserved:true,dockerTestCleanup:'PASS',docker,
  commit:false,push:false,deploy:false}
await writeFile('rehearsal/reports/R1_4_POSTFLIGHT.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({...report,docker:undefined}))
