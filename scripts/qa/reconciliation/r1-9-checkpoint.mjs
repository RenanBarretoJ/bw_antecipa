import assert from 'node:assert/strict'
import { readFile,readdir,writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { hash } from './r1-4-restorer.mjs'
import { inventory } from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const json=async p=>JSON.parse(await readFile(p,'utf8'))
const previous=await json('rehearsal/reports/R1_8_CHECKPOINT.json'),status=await json('rehearsal/reports/R1_8_STATUS.json')
const changed=new Map(status.preservation.changedCheckpointFiles.map(f=>[f.path,f.after]))
for(const f of previous.files)assert.equal(hash(await readFile(f.path)),changed.get(f.path)??f.sha256,`PREVIOUS_WORK_CHANGED:${f.path}`)
for(const f of previous.reports)assert.equal(hash(await readFile(f.path)),f.sha256,`PREVIOUS_REPORT_CHANGED:${f.path}`)
const git=a=>execFileSync('git',a,{encoding:'utf8',windowsHide:true}).trim()
assert.equal(git(['rev-parse','HEAD']),previous.head);assert.equal(git(['branch','--show-current']),previous.branch)
const paths=[...new Set([...git(['diff','--name-only','HEAD']).split('\n'),...git(['ls-files','--others','--exclude-standard']).split('\n')])].filter(Boolean)
const reports=(await readdir('rehearsal/reports')).filter(f=>/^R1/.test(f)).map(f=>'rehearsal/reports/'+f)
const fingerprint=async path=>({path,sha256:hash(await readFile(path))})
const result={at:new Date().toISOString(),head:previous.head,branch:previous.branch,status:git(['status','--short']),files:await Promise.all(paths.map(fingerprint)),reports:await Promise.all(reports.map(fingerprint)),docker:await inventory(),result:'PASS'}
await writeFile('rehearsal/reports/R1_9_CHECKPOINT.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({result:'PASS',files:paths.length,reports:reports.length}))
