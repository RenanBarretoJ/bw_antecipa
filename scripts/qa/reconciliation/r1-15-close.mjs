import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {hash} from './r1-4-restorer.mjs'
import {gitBytes} from './r1-5-migration-source.mjs'
import {inventory} from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const dir='rehearsal/reports/',read=async n=>JSON.parse(await readFile(dir+n+'.json','utf8'))
const cp=await read('R1_15_CHECKPOINT'),pkg=await read('R1_15_DECISION_PACKAGE'),sql=await read('R1_15_DIRECTED_TESTS'),audit=await read('R1_15_SOURCE_AUDIT')
const exec=promisify(execFile),quality=[]
const files=(await readdir('scripts/qa/reconciliation')).filter(f=>/^r1-15-.*\.mjs$/.test(f)).map(f=>'scripts/qa/reconciliation/'+f)
for(const [id,bin,args] of [
 ['helpers',process.execPath,['--test','scripts/qa/reconciliation/r1-14-analysis.test.mjs']],
 ['lint',process.execPath,['node_modules/eslint/bin/eslint.js','--max-warnings','0',...files]],
 ['unstaged_diff_check','git',['diff','--check']],
 ['staged_diff_check','git',['diff','--cached','--check']],
]){
 const {stdout,stderr}=await exec(bin,args,{windowsHide:true,maxBuffer:4*1024*1024,timeout:120000})
 quality.push({id,command:[bin,...args],result:'PASS',stdout,stderr})
}
const branch=gitBytes(['branch','--show-current']).toString().trim(),head=gitBytes(['rev-parse','HEAD']).toString().trim()
assert.equal(head,cp.head);assert.equal(branch,cp.branch)
for(const f of [...cp.files,...cp.reports])assert.equal(hash(await readFile(f.path)),f.sha256,'EXISTING_FILE_CHANGED:'+f.path)
const after=await inventory()
assert.deepEqual(after,cp.docker,'PREEXISTING_DOCKER_INVENTORY_CHANGED')
assert.equal(sql.cleanup,'PASS')
assert.equal((await read('R1_15_DIRECTED_TESTS_ATTEMPT_01')).cleanup,'PASS')
assert.equal(sql.applicationDDL,false);assert.equal(sql.realBusinessRows,false);assert.equal(sql.actualRlsEnforcementTest,false)
assert.equal(audit.bootstrapCanonicalOccurrences.length,0)
assert(audit.grantsByRelation.every(r=>r.recentMaintenanceGrants.length===0))
assert.equal(audit.escrowRuntimeCatalogReferences.length,0)
assert.equal((await read('R1_15_SECURITY_COMPOSITION')).result,'PASS')
assert.equal(pkg.groups.reduce((n,g)=>n+g.MATERIAL_KEYS,0),71)
assert.equal(pkg.groups.filter(g=>g.USER_DECISION_REQUIRED).length,5)
assert.equal(pkg.summary.ready,false)
assert.equal(pkg.groups.find(g=>g.GROUP_ID==='DECISION-H').RECOMMENDED_TARGET,'MANUAL_DECISION_REQUIRED; HOLD, no broad removal recommendation.')
const artifactHashes=[]
for(const name of (await readdir(dir)).filter(n=>n.startsWith('R1_15_')).sort())artifactHashes.push({path:dir+name,sha256:hash(await readFile(dir+name))})
const status={
 at:new Date().toISOString(),branch,head,result:'STOPPED_AT_REAL_RLS_PROOF_GATE',
 R1_15_EXISTING_WORK_PRESERVED:'PASS',R1_15_ACL_CONSUMER_MAPPING:'PASS',R1_15_ACL_TARGET_PROPOSAL:'PASS',R1_15_SERVICE_ROLE_TARGET:'PASS',
 R1_15_POLICY_ANALYSIS:'MANUAL',R1_15_ESCROW_TARGET:'MANUAL',R1_15_NULLABILITY_TARGET:'MANUAL',R1_15_TAXAS_CHECK_TARGET:'PASS',R1_15_BOOTSTRAP_ORIGIN_TARGET:'MANUAL',R1_15_CORRIGIR_DUPLICATA_TARGET:'MANUAL',R1_15_INDEX_TARGET:'PASS',R1_15_SECURITY_COMPOSITION:'PASS',
 R1_15_USER_DECISIONS_REQUIRED:5,R1_15_DATA_PREFLIGHTS_REQUIRED:5,R1_15_DATA_PREFLIGHTS_CONDITIONAL_ADDITIONAL:1,R1_15_FORWARD_PACKAGES_PROPOSED:7,R1_15_DECISION_PACKAGE_READY:'NO',
 PRODUCTION_CHANGED:'NO',HOMOLOG_CHANGED:'NO',PRODUCTION_DB_CHANGED:'NO',HOMOLOG_DB_CHANGED:'NO',DOCKER_TEST_ENV_CLEANUP:'PASS',
 preserved:{sourceFiles:cp.files.length,priorReports:cp.reports.length,artifactHashes,beforeDocker:cp.docker,afterDocker:after},
 sourceAudit:'R1_15_SOURCE_AUDIT.json',quality,
 localDirected:{engine:sql.queries.find(q=>q.id==='engine').result,taxaCases:sql.queries.find(q=>q.id==='taxas_predicates').result.length,encodingCases:sql.queries.find(q=>q.id==='encoding_observed_and_candidates').result.length,policyModelCases:sql.queries.find(q=>q.id==='policy_boolean_model_not_rls').result.length,syntheticExplain:1,actualRlsEnforcement:false,applicationSchemaLoaded:false},
 limitations:['PASS for ACL mapping/target/security means evidence-backed static proposal and preserved composition, not future runtime certification.','RLS model is not the required fresh-stack A/B enforcement test.','No full SQL suite, build Linux, authenticated smoke or CI rerun.','Clean-room is prior captured evidence; remote catalog calls did not read business rows.','No permission to implement a forward, change data, commit/push or deploy.'],
 blockers:pkg.summary.blockers,
 nextAuthorization:'Permit application-schema/policy setup only inside a newly owned disposable local Docker stack to execute real RLS A/B tests, without remote writes, historical migration edits, or forward implementation.',
}
await writeFile(dir+'R1_15_STATUS.json',JSON.stringify(status,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({result:status.result,ready:status.R1_15_DECISION_PACKAGE_READY,preservedFiles:cp.files.length,preservedReports:cp.reports.length,docker:status.DOCKER_TEST_ENV_CLEANUP,quality:quality.map(q=>[q.id,q.result]),localDirected:status.localDirected}))
