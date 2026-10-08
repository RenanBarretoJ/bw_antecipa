import assert from 'node:assert/strict'
import { readFile,writeFile,readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileSha256 } from '../../perf9e/clean-room-lib.mjs'
import { inventory } from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const git=a=>execFileSync('git',a,{encoding:'utf8',windowsHide:true}).trim()
const last=JSON.parse(await readFile('rehearsal/reports/R1_4_POSTFLIGHT.json','utf8'))
assert.equal(last.result,'PASS')
assert.equal(git(['rev-parse','HEAD']),last.head)
assert.equal(git(['branch','--show-current']),last.branch)
const paths=[...new Set([...git(['diff','--name-only','HEAD']).split('\n'),...git(['ls-files','--others','--exclude-standard']).split('\n')])].filter(Boolean)
const reports=(await readdir('rehearsal/reports')).filter(p=>/^R1/.test(p)).map(p=>'rehearsal/reports/'+p)
const evidence={at:new Date().toISOString(),head:last.head,branch:last.branch,status:git(['status','--short']),
  files:paths.map(path=>({path,sha256:fileSha256(path)})),reports:reports.map(path=>({path,sha256:fileSha256(path)})),docker:await inventory()}
await writeFile('rehearsal/reports/R1_5_CHECKPOINT.json',JSON.stringify(evidence,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({files:evidence.files.length,reports:evidence.reports.length,result:'PASS'}))
