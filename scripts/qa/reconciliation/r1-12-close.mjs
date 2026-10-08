// Record the mandatory stop without repairing or hiding the next failure.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {hash} from './r1-4-restorer.mjs'
import {inventory} from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const exec=promisify(execFile),root='rehearsal/reports/'
const read=async n=>JSON.parse(await readFile(root+n+'.json','utf8'))
const save=async(n,r)=>writeFile(root+n+'.json',JSON.stringify(r,null,2)+'\n',{flag:'wx'})
const checkpoint=await read('R1_12_CHECKPOINT'),clean=await read('R1_12_CLEANROOM')
const trace=await read('R1_12_EXACT_CALL_TRACE'),controls=await read('R1_12_FISCAL_IDENTITY_CONTROLS')
const operational=await read('R1_12_OPERATIONAL_SUITE'),extra=await read('R1_12_EXTRA_SQL_SUITES')
const p=clean.paths[0]
assert.equal(clean.result,'FAIL');assert.equal(p.stage,'FINAL_APPLICATION_CATALOG_AFTER_SQL')
assert.equal(p.failure.code,'0A000');assert.equal(p.failure.message,'could not implement GROUP BY')
assert.equal(p.applied.length,264);assert(p.tests.every(t=>t.result==='PASS'));assert.equal(p.notifications.pass,true)
assert.equal(operational.result,'PASS');assert.equal(extra.result,'PASS')
const allowed=new Set(['scripts/email-intake/lifecycle-db.mjs','scripts/qa/reconciliation/r1-full-upgrades.mjs','scripts/qa/reconciliation/r1-2-storage.mjs'])
const changed=[]
for(const f of checkpoint.files){
 const after=hash(await readFile(f.path))
 if(after!==f.sha256){assert(allowed.has(f.path),'UNRELATED_CHANGE:'+f.path);changed.push({path:f.path,before:f.sha256,after})}
}
assert.equal(changed.length,3)
const lifecycle=await readFile('scripts/email-intake/lifecycle-db.mjs','utf8')
assert.equal(lifecycle,checkpoint.lifecycleSource.replace("'9'.repeat(50)","'1234567890'.repeat(5)"),'LIFECYCLE_ASSERTIONS_CHANGED')
for(const f of checkpoint.reports)assert.equal(hash(await readFile(f.path)),f.sha256,'OLD_REPORT_CHANGED:'+f.path)
const dockerAfter=await inventory();assert.deepEqual(dockerAfter,checkpoint.docker,'PREEXISTING_DOCKER_CHANGED')
const stacks=[...trace.stacks,...controls.stacks,...operational.stacks,{...p,suite:'principal-cleanroom'}]
assert.equal(stacks.length,4);assert(stacks.every(s=>s.cleanup==='PASS'))
const {stdout:branch}=await exec('git',['branch','--show-current'],{windowsHide:true})
const {stdout:head}=await exec('git',['rev-parse','HEAD'],{windowsHide:true})
assert.equal(branch.trim(),checkpoint.branch);assert.equal(head.trim(),checkpoint.head)
const preservation={result:'PASS',checkpointFiles:checkpoint.files.length,oldReports:checkpoint.reports.length,changedFiles:changed,historicalMigrationsChanged:0,businessRulesChanged:0,lifecycleAssertions:'BYTE_IDENTICAL_EXCEPT_ONE_SYNTHETIC_CONSTANT',guardDefinitions:'UNCHANGED',priorAuthFixtures:'UNCHANGED',dockerInventory:'UNCHANGED',featureCertification:'NOT_FINAL_CATALOG_BLOCKED'}
await save('R1_12_PRESERVATION_MANIFEST',preservation)
const captureFile='scripts/qa/reconciliation/r1-9-target-catalog.sql'
const captureSql=await readFile(captureFile,'utf8')
assert.equal(hash(captureSql),checkpoint.files.find(f=>f.path===captureFile).sha256)
const captureDiagnosis={at:new Date().toISOString(),result:'BLOCKED',stage:p.stage,failure:p.failure,query:{file:captureFile,sha256:hash(captureSql),groupByLines:captureSql.split(/\r?\n/).flatMap((line,i)=>line.includes('GROUP BY')?[{line:i+1,text:line}]:[])},confirmed:'Final catalog SELECT failed after the domain SQL and real Storage checks passed.',hypothesis:'The enum aggregation groups pg_type.typacl; planner support for that ACL array grouping needs an isolated read-only characterization.',hypothesisStatus:'NOT_PROVEN_DO_NOT_AUTO_FIX',queryModified:false,fixtureReclassified:false,continuation:'STOP_BEFORE_UPGRADES_3WAY_FINAL_QUALITY_CI',cleanup:p.cleanup}
await save('R1_12_CATALOG_CAPTURE_FAILURE',captureDiagnosis)
await save('R1_12_FULL_SQL',{at:new Date().toISOString(),result:'BLOCKED_FINAL_CATALOG',regressionResult:'PASS',principalPgTapChecks:p.tests.reduce((n,t)=>n+(t.checks??0),0),notificationPgTapChecks:p.notifications.checks,assertionBlocks:p.tests.filter(t=>t.kind==='ASSERTION_BLOCKS'),municipalAndCompanionScenarioGroups:p.municipalChecks.length,storageTraceEvents:p.storageTrace.length,extraSuites:{result:extra.result,groups:extra.tests.reduce((n,t)=>n+t.checkCount,0),previousFreshStackSuites:6,currentFreshStackSuites:1},tests:p.tests,failedStage:p.stage,failure:p.failure,allPathsCertified:false})
await save('R1_12_TARGET_CATALOG',{at:new Date().toISOString(),result:'BLOCKED',comparisonExecuted:false,reason:'Principal final catalog capture failed; no three-way equivalence claim.',failure:p.failure,oldCatalogDifferencesReused:false,prodUpgrade:'NOT_RUN_STOP_GATE',homologUpgrade:'NOT_RUN_STOP_GATE'})
const quality=[]
for(const [name,program,args] of [
 ['targeted harness tests','node',['--test','scripts/qa/reconciliation/r1-12-trace.test.mjs','scripts/qa/reconciliation/r1-10-stack-guard.test.mjs','scripts/qa/reconciliation/r1-4-restorer.test.mjs']],
 ['targeted ESLint','node',['node_modules/eslint/bin/eslint.js','scripts/qa/reconciliation/r1-12-trace.mjs','scripts/qa/reconciliation/r1-12-trace.test.mjs','scripts/qa/reconciliation/r1-12-controls.mjs','scripts/qa/reconciliation/r1-12-investigate.mjs','scripts/qa/reconciliation/r1-12-extra-evidence.mjs','scripts/qa/reconciliation/r1-12-close.mjs','scripts/qa/reconciliation/r1-full-upgrades.mjs','scripts/qa/reconciliation/r1-2-storage.mjs','scripts/email-intake/lifecycle-db.mjs']],
 ['git diff check','git',['diff','--check']],
]){
 try{const r=await exec(program,args,{windowsHide:true,maxBuffer:4*1024*1024});quality.push({name,result:'PASS',output:r.stdout+r.stderr})}
 catch(e){quality.push({name,result:'FAIL',code:e.code,output:(e.stdout??'')+(e.stderr??'')})}
}
await save('R1_12_FINAL_QUALITY',{at:new Date().toISOString(),result:'NOT_RUN_STOP_GATE',targetedChecks:quality,databaseTypes:'NOT_RUN',packageLock:'UNCHANGED_NOT_RECERTIFIED',sharp:'NOT_RUN',pdfRuntime:'NOT_RUN',typescript:'NOT_RUN',fullSuite:'NOT_RUN',lint:'TARGETED_ONLY',linuxBuild:'NOT_RUN',ci:'NOT_RUN',reason:'Mandatory stop on final catalog capture failure.'})
const passFail=b=>b?'PASS':'FAIL'
const flags={
 R1_12_EXISTING_WORK_PRESERVED:'PASS',R1_12_EXACT_CALL_TRACE:passFail(trace.result==='PASS_EXPECTED_FAILURE_REPRODUCED'),R1_12_SCENARIO_INTENT_CLASSIFIED:'PASS',R1_12_SCENARIO_CLASSIFICATION:'INCIDENTAL_VALID_DOCUMENT_FIXTURE',R1_12_FISCAL_IDENTITY_GUARD_CHARACTERIZED:'PASS',R1_12_ROOT_CAUSE:'TEST_FIXTURE_INVALID_FISCAL_IDENTITY',R1_12_FISCAL_GUARD_UNCHANGED:passFail(controls.guardBefore===controls.guardAfter),R1_12_INVALID_KEY_NEGATIVE_CONTROL:'PASS',R1_12_VALID_KEY_POSITIVE_CONTROL:'PASS',R1_12_OPERATIONAL_SUITE:'PASS',R1_12_EXTRA_SQL_SUITES:'PASS',RECON_CLEAN_ROOM:'FAIL',RECON_SQL:'FAIL',R1_12_TARGET_CATALOG_EQUIVALENT:'FAIL',R1_12_P16:'PASS',R1_12_SACADO:'PASS',R1_12_HEALTH_RLX:'PASS',R1_12_C5_A6:'PASS',R1_12_NOTIFICATIONS:'PASS',R1_12_INTEGRATIONS:'PASS',RECON_DATABASE_TYPES:'FAIL',RECON_PACKAGE_LOCK:'FAIL',RECON_SHARP:'FAIL',RECON_PDF_RUNTIME:'FAIL',RECON_TYPESCRIPT:'FAIL',RECON_FULL_SUITE:'FAIL',RECON_LINT:'FAIL',RECON_BUILD_LINUX:'FAIL',R1_12_FEATURE_PRESERVATION_MANIFEST:'FAIL',R1_12_FINAL_DIFF_REVIEW:'FAIL',RECON_CI_STANDARD:'FAIL',RECON_CI_LINUX:'FAIL',DOCKER_TEST_ENV_CLEANUP:'PASS',RECON_PRODUCTION_CHANGED:'NO',RECON_HOMOLOG_CHANGED:'NO',RECON_PRODUCTION_DB_CHANGED:'NO',RECON_HOMOLOG_DB_CHANGED:'NO',RECON_R1_READY_FOR_HOMOLOG_ROLLOUT:'NO',
}
const status={at:new Date().toISOString(),result:'STOPPED',branch:branch.trim(),head:head.trim(),flags,gateSemantics:'FAIL for unexecuted final gates means NOT_CERTIFIED_AFTER_STOP, not a demonstrated functional failure. Domain gates reflect local regression evidence only; integrations reuse verified prior fresh-stack evidence.',diagnosis:'Original fiscal identity failure proven incidental and fixed with one synthetic constant; invalid identity still rejected. New independent failure is the final catalog SELECT, not a failed fiscal assertion.',stopReason:captureDiagnosis,sqlPassed:{pgTap:418,municipalAndCompanionGroups:34,operationalGroups:45},preservation,cleanup:{result:'PASS',stacks:stacks.map(s=>({projectId:s.projectId,result:s.result,cleanup:s.cleanup})),preexistingInventory:'UNCHANGED',removed:'Only four disposable R1.12 QA stacks; local synthetic data reproducible from preserved scripts.'},quality,remaining:['Characterize catalog GROUP BY failure separately without changing business SQL','After authorized harness correction, rerun fresh principal clean-room','Local production/homolog upgrade paths and three-way catalog','Final quality, types, package/PDF/sharp/Linux, feature manifest','Commit/push, draft PR, CI only after all local gates PASS'],commit:false,push:false,deploy:false,remoteChanges:false,readyForRollout:false}
await save('R1_12_STATUS',status)
console.log(JSON.stringify({result:status.result,rootCause:flags.R1_12_ROOT_CAUSE,operational:flags.R1_12_OPERATIONAL_SUITE,sqlPassed:status.sqlPassed,blocker:p.failure,preservation:preservation.result,cleanup:status.cleanup.result,quality:quality.map(q=>({name:q.name,result:q.result})),readyForRollout:false}))
