// Consolidate separately dated fresh-stack proofs; never relabel old failures.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {hash} from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const read=async p=>JSON.parse(await readFile(p,'utf8'))
const root='rehearsal/reports/',checkpoint=await read(root+'R1_12_CHECKPOINT.json')
const oldPath=root+'R1_10_FIXTURE_RESUME.json',currentPath=root+'R1_12_OPERATIONAL_SUITE.json'
const old=await read(oldPath),current=await read(currentPath)
assert.equal(hash(await readFile(oldPath)),checkpoint.reports.find(f=>f.path===oldPath).sha256)
assert.equal(current.result,'PASS');assert.equal(current.stacks.length,1)
const dependencyFiles=checkpoint.files.filter(f=>/^(scripts\/email-intake\/|scripts\/qa\/reconciliation\/r1-10-|supabase\/tests\/|supabase\/migrations\/)/.test(f.path)&&f.path!=='scripts/email-intake/lifecycle-db.mjs')
for(const f of dependencyFiles)assert.equal(hash(await readFile(f.path)),f.sha256,'SIX_PRIOR_SUITES_DEPENDENCY_DRIFT:'+f.path)
const tests=[]
for(const suite of ['credential','inline','cnab','operators','automation','temporal']){
  const proof=old.tests.find(t=>t.suite===suite),stack=old.stacks.find(s=>s.suite===suite)
  assert.equal(proof.result,'PASS');assert.equal(stack.result,'PASS');assert.equal(stack.cleanup,'PASS')
  assert.deepEqual(stack.applied.map(m=>[m.version,m.sha256]),current.stacks[0].applied.map(m=>[m.version,m.sha256]))
  tests.push({...proof,sourceReport:oldPath,execution:'PREVIOUS_FRESH_STACK_SAME_IMMUTABLE_SQL_AND_DEPENDENCIES_NOT_RERUN'})
}
const s=current.stacks[0]
assert.equal(s.cleanup,'PASS');assert.equal(s.checks.length,45)
tests.push({suite:'operational',stackId:s.projectId,result:s.result,checks:s.checks,checkCount:s.checks.length,checkUnit:'named scenario groups',sourceReport:currentPath,execution:'R1_12_NEW_FRESH_STACK'})
const report={at:new Date().toISOString(),result:'PASS',method:'FRESH_STACK',tests,dependencyFileCount:dependencyFiles.length,sourceHashes:{[oldPath]:hash(await readFile(oldPath)),[currentPath]:hash(await readFile(currentPath))},priorFailure:'Preserved in original R1_10 report; only operational rerun in R1_12.',remoteChanges:false}
await writeFile(root+'R1_12_EXTRA_SQL_SUITES.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({result:report.result,suites:tests.length,groups:tests.reduce((n,t)=>n+t.checkCount,0),priorSuites:6,newSuites:1}))
