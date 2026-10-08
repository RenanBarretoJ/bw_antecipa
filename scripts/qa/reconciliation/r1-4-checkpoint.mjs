import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileSha256 } from '../../perf9e/clean-room-lib.mjs'
import { inventory } from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const git=args=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim()
const previous=JSON.parse(await readFile('rehearsal/reports/R1_3_WORKTREE_BEFORE.json','utf8'))
for(const key of ['baselineFiles','additions','historicalMigrations'])for(const m of previous[key])assert.equal(fileSha256(m.path),m.sha256,`EXISTING_DRIFT:${m.path}`)
assert.equal(git(['rev-parse','HEAD']),previous.head)
assert.equal(git(['branch','--show-current']),previous.branch)
const paths=[...new Set([...git(['diff','--name-only','HEAD']).split('\n'),...git(['ls-files','--others','--exclude-standard']).split('\n')])].filter(Boolean)
const report={at:new Date().toISOString(),head:previous.head,branch:previous.branch,status:git(['status','--short']),
  files:paths.map(path=>({path,sha256:fileSha256(path)})),docker:await inventory(),existingWorkPreserved:'PASS'}
await writeFile('rehearsal/reports/R1_4_CHECKPOINT.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'})
// Archive previous evidence, never overwrite it to make the recertification look clean.
for(const name of ['R1_FULL_UPGRADES','R1_RESTORE_DRIFT_DIAGNOSIS'])await writeFile(`rehearsal/reports/${name}_BEFORE_R14.json`,await readFile(`rehearsal/reports/${name}.json`),{flag:'wx'})
console.log(JSON.stringify({preserved:report.files.length,baseline:previous.baselineFiles.length,historical:previous.historicalMigrations.length,docker:report.docker.containers}))
