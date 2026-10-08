import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {hash} from './r1-4-restorer.mjs'
import {inventory} from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const exec=promisify(execFile),git=async args=>(await exec('git',args,{windowsHide:true,maxBuffer:8*1024*1024})).stdout
const branch=(await git(['branch','--show-current'])).trim(),head=(await git(['rev-parse','HEAD'])).trim()
assert.equal(branch,'reconcile/main-homolog-2026-10-06');assert.equal(head,'2e8146ebe7582c5bdc10ddee1f8862d806607ee2')
const old=JSON.parse(await readFile('rehearsal/reports/R1_12_STATUS.json','utf8'));assert.equal(old.result,'STOPPED')
assert.equal(old.flags.R1_12_OPERATIONAL_SUITE,'PASS');assert.equal(old.flags.RECON_R1_READY_FOR_HOMOLOG_ROLLOUT,'NO')
const files=[]
for(const path of [...new Set((await git(['ls-files','--cached','--others','--exclude-standard','-z'])).split('\0').filter(Boolean))].sort())files.push({path,sha256:hash(await readFile(path))})
const reports=[]
for(const n of (await readdir('rehearsal/reports')).sort())if(n.endsWith('.json')&&!n.startsWith('R1_13_')){const path='rehearsal/reports/'+n;reports.push({path,sha256:hash(await readFile(path))})}
const report={at:new Date().toISOString(),result:'PASS',branch,head,status:await git(['status','--short']),files,reports,docker:await inventory(),catalogSource:await readFile('scripts/qa/reconciliation/r1-9-target-catalog.sql','utf8')}
await writeFile('rehearsal/reports/R1_13_CHECKPOINT.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({result:report.result,files:files.length,reports:reports.length,branch,head}))
