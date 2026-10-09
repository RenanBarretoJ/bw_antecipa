import {mappingCheckHook} from './r2-2-mapping-checks.mjs'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {freshMappingStack} from './r2-2-fresh-stack.mjs'
import {verifyMappingRls} from './r2-2-fixture.mjs'
import {render,migrationPath} from './r2-2-render.mjs'
import {hash} from './r1-4-restorer.mjs'
import {redactCommandOutput} from '../../perf9e/clean-room-lib.mjs'

assert.deepEqual(process.argv.slice(2),['--local-only'])
const contract=JSON.parse(await readFile('scripts/qa/reconciliation/ci/contracts.json','utf8'))
const sql=await readFile(migrationPath,'utf8')
assert.equal(sql,await render(),'BOOTSTRAP_COMPOSITION_DRIFT')
const version='20261008183349',sha256=hash(sql)
const result={at:new Date().toISOString(),result:'IN_PROGRESS',scope:'DOCKER_ONLY',remoteCalls:0,stacks:[],negatives:[],bootstrap:{version,path:migrationPath,sha256,supersedesOnlyInExplicitHomologPlan:'20261005154435'},historyFaked:false}
await mkdir('rehearsal/reports',{recursive:true})
const report=`rehearsal/reports/R2_2_MAPPING_REHEARSAL_${Date.now()}.json`
const save=()=>writeFile(report,JSON.stringify(result,null,2)+'\n')
const checks=mappingCheckHook(result,save)
let stack,baseline
async function finish(s){
 for(const e of [...contract.forwards.entries,contract.auth.entry]){
  const bytes=await readFile(e.path);assert.equal(hash(bytes),e.sha256);await s.db.query(bytes.toString('utf8'))
 }
 return s.capture()
}

try{
 stack=await freshMappingStack(result.stacks)
 baseline=await finish(stack);result.baselineCatalog={count:baseline.length,sha256:hash(JSON.stringify(baseline))}
 stack.evidence.result='PASS';await stack.close();stack=null;await save()
 stack=await freshMappingStack(result.stacks,checks.callback)
 const candidate=await finish(stack)
 assert.deepEqual(candidate,baseline,'BOOTSTRAP_CANONICAL_CATALOG_DIFF')
 result.catalog={count:candidate.length,sha256:hash(JSON.stringify(candidate)),result:'PASS'}
 result.rls=await verifyMappingRls(stack.db,checks.fixture)
 assert.equal(stack.evidence.applied.filter(e=>e.version===version).length,1)
 assert.equal(stack.evidence.applied.filter(e=>e.version==='20261005154435').length,0)
 result.result='PASS';stack.evidence.result='PASS'
}catch(e){result.result='FAIL_STOPPED';result.failure={code:e.code??'ASSERTION',message:redactCommandOutput(e.message)};process.exitCode=1}
finally{await stack?.close();await save()}
console.log(JSON.stringify({report,result:result.result,negatives:result.negatives.length,rls:result.rls?.length,failure:result.failure}))
