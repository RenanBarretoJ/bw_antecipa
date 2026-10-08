import assert from 'node:assert/strict'
import {test} from 'node:test'
import {cleanupPlan,assertCompletedAbsent} from './r1-19-cleanup-lifecycle.mjs'
const baseline={containers:['preserved-container'],volumes:['preserved-volume'],networks:['preserved-network']}
function root(n){
 const projectId='bw_email03_r110pa_'+n
 return {projectId,runnerId:'R2_2_EXPLICIT_MAPPING',before:structuredClone(baseline),
  portContract:{before:structuredClone(baseline),spec:{projectId}},
  resources:Object.fromEntries(Object.keys(baseline).map(k=>[k,[k+'_'+projectId]])),cleanupRuns:[{result:'PASS'}]}
}
test('Two independent completed runs are verified separately; combined roots remain rejected',()=>{
 const roots=[root('1791486202335'),root('1791486202336')]
 assert.throws(()=>cleanupPlan(roots,baseline),/EXACTLY_ONE_RUN_ROOT_REQUIRED/)
 for(const m of roots){
  const p=cleanupPlan([m],baseline)
  assert.deepEqual(p.steps,[{projectId:m.projectId,action:'VERIFY_COMPLETED_ABSENT'}])
  assertCompletedAbsent(m,baseline,{containers:[],volumes:[],networks:[]})
 }
})
test('Independent run cleanup never accepts missing preexisting or foreign resources',()=>{
 const m=root('1791486202335')
 for(const k of Object.keys(baseline)){
  const missing=structuredClone(baseline);missing[k]=[]
  assert.throws(()=>cleanupPlan([m],missing),/REAL_PREEXISTING_RESOURCE_REMOVED/)
  const foreign=structuredClone(baseline);foreign[k].push('foreign')
  assert.throws(()=>cleanupPlan([m],foreign),/UNMANIFESTED_RESOURCE/)
 }
})
