// Offline stop-gate report. No repairs to domain SQL, grants, RLS or historical files.
import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {hash} from './r1-4-restorer.mjs'
import {inventory} from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const root='rehearsal/reports/',read=async n=>JSON.parse(await readFile(root+n+'.json','utf8'))
const save=async(n,r)=>writeFile(root+n+'.json',JSON.stringify(r,null,2)+'\n',{flag:'wx'})
const exec=promisify(execFile),checkpoint=await read('R1_13_CHECKPOINT'),raw=await read('R1_13_RAW_THREE_WAY')
const diagnosis=await read('R1_13_GROUP_BY_DIAGNOSIS'),query=await read('R1_13_CATALOG_QUERY_TESTS'),nameDiagnosis=await read('R1_13_NAME_TYPE_DIAGNOSIS')
assert.equal(diagnosis.result,'PASS');assert.equal(query.result,'PASS');assert.equal(nameDiagnosis.result,'PASS')
const differences=raw.differences.map(d=>{
 const values=Object.values(d.objects),present=values.filter(Boolean),kind=present[0].kind
 const changedFields=['definition','owner','acl'].filter(k=>new Set(values.map(v=>JSON.stringify(v?.[k]))).size>1)
 const aclOnly=values.every(Boolean)&&changedFields.length===1&&changedFields[0]==='acl'
 const classification=aclOnly||kind==='column'?'REAL_FUNCTIONAL_DRIFT':'UNKNOWN'
 const reason=aclOnly?'Captured privilege entries differ; not accepted as platform noise. ACL attached to constraint/policy/trigger repeats the owning relation ACL.':kind==='column'?'Column presence or nullability differs across reconstructed application schemas.':'No semantic equivalence proof; stop gate forbids ignoring or repairing this difference.'
 const lineEndingOnlyCandidate=values.every(v=>v?.kind==='function')&&new Set(values.map(v=>v.definition.replaceAll('\r\n','\n'))).size===1
 return {...d,classification,changedFields,reason,lineEndingOnlyCandidate,rawHashes:Object.fromEntries(Object.entries(d.objects).map(([k,v])=>[k,v?.hash??null]))}
})
const counts=differences.reduce((a,d)=>(a[d.classification]=(a[d.classification]??0)+1,a),{})
assert(counts.REAL_FUNCTIONAL_DRIFT>0)
const target={at:new Date().toISOString(),result:'FAIL',comparisonExecuted:true,source:'R1_13_RAW_THREE_WAY.json',sourceSha256:hash(await readFile(root+'R1_13_RAW_THREE_WAY.json')),paths:raw.paths,totalKeys:raw.totalKeys,equalKeys:raw.equalKeys,differingKeys:differences.length,classifications:counts,differences,limitation:'Conservative classification after a mandatory stop. Line-ending-only function candidates remain UNKNOWN, not silently normalized. Repeated relation ACL surfaces are not independent privilege changes.',directRelationAclDifferences:differences.filter(d=>JSON.parse(d.key)[0]==='relation'&&d.changedFields.join(',')==='acl').length,lineEndingOnlyCandidates:differences.filter(d=>d.lineEndingOnlyCandidate).length,action:'STOP_NO_SCHEMA_OR_GRANT_FIX',readyForRollout:false}
await save('R1_13_TARGET_CATALOG',target)
const changed=[]
for(const f of checkpoint.files){const after=hash(await readFile(f.path));if(after!==f.sha256)changed.push({path:f.path,before:f.sha256,after})}
assert.deepEqual(changed.map(f=>f.path).sort(),['scripts/qa/reconciliation/r1-9-target-catalog.sql','scripts/qa/reconciliation/r1-full-upgrades.mjs'])
for(const f of checkpoint.reports)assert.equal(hash(await readFile(f.path)),f.sha256,'OLD_REPORT_CHANGED:'+f.path)
assert.deepEqual(await inventory(),checkpoint.docker,'PREEXISTING_RESOURCES_CHANGED')
const git=async args=>(await exec('git',args,{windowsHide:true})).stdout.trim()
assert.equal(await git(['branch','--show-current']),checkpoint.branch);assert.equal(await git(['rev-parse','HEAD']),checkpoint.head)
const stacks=new Map()
for(const name of await readdir(root))if(/^R1_13_.*\.json$/.test(name)){
 const r=JSON.parse(await readFile(root+name,'utf8'))
 for(const s of [...r.stacks??[],...r.paths??[]])if(s.projectId&&s.cleanup)stacks.set(s.projectId,s)
}
assert.equal(stacks.size,9);assert([...stacks.values()].every(s=>s.cleanup==='PASS'))
const preservation={result:'PASS',checkpointFiles:checkpoint.files.length,priorReports:checkpoint.reports.length,changedFiles:changed,historicalMigrationsChanged:0,businessSqlChanged:0,approvedFixturesChanged:0,fiscalGuardChanged:0,preexistingDocker:'UNCHANGED',scope:'Only catalog SELECT plus local report revision/hash gate in existing runner. Synthetic role/enum/grant controls were rolled back; no application grants were edited.',finalFeatureManifest:'NOT_CERTIFIED_TARGET_CATALOG_FAILED'}
await save('R1_13_PRESERVATION',preservation)
const clean=await read('R1_13_CLEANROOM'),upgrades=await read('R1_13_FULL_UPGRADES'),paths=[...upgrades.paths,...clean.paths]
assert(paths.every(p=>p.result==='PASS'&&p.tests.every(t=>t.result==='PASS')&&p.notifications.pass&&p.cleanup==='PASS'))
const pgTap=paths.reduce((n,p)=>n+p.tests.reduce((a,t)=>a+(t.checks??0),0)+p.notifications.checks,0)
const extra=await read('R1_12_EXTRA_SQL_SUITES')
assert.equal(extra.result,'PASS')
await save('R1_13_FULL_SQL',{at:new Date().toISOString(),result:'PASS',TOTAL_SQL_CHECKS:pgTap,FAILED_SQL_CHECKS:0,checkUnit:'pgTAP executions; 418 checks on each of three fresh paths',paths:raw.paths,municipalAndCompanionGroups:paths.reduce((n,p)=>n+p.municipalChecks.length,0),previousComplementaryEvidence:{report:'R1_12_EXTRA_SQL_SUITES.json',sha256:hash(await readFile(root+'R1_12_EXTRA_SQL_SUITES.json')),result:extra.result,groups:111,note:'Verified unchanged business code and fixtures; no claim of an R1.13 rerun of the seven complementary suites.'}})
const quality=[]
for(const [name,program,args] of [
 ['catalog harness lint','node',['node_modules/eslint/bin/eslint.js','scripts/qa/reconciliation/r1-13-checkpoint.mjs','scripts/qa/reconciliation/r1-13-probe.mjs','scripts/qa/reconciliation/r1-13-query-tests.mjs','scripts/qa/reconciliation/r1-13-duplicate-probe.mjs','scripts/qa/reconciliation/r1-13-name-probe.mjs','scripts/qa/reconciliation/r1-13-compare.mjs','scripts/qa/reconciliation/r1-13-close.mjs','scripts/qa/reconciliation/r1-full-upgrades.mjs']],
 ['provenance and restorer tests','node',['--test','scripts/qa/reconciliation/r1-4-restorer.test.mjs','scripts/qa/reconciliation/r1-5-migration-source.test.mjs']],
 ['git diff check','git',['diff','--check']],
]){
 try{const r=await exec(program,args,{windowsHide:true,maxBuffer:4*1024*1024});quality.push({name,result:'PASS',output:r.stdout+r.stderr})}
 catch(e){quality.push({name,result:'FAIL',code:e.code,output:(e.stdout??'')+(e.stderr??'')})}
}
const finalQuality={at:new Date().toISOString(),result:'NOT_RUN_STOP_GATE',reason:'Three-way target catalog has REAL_FUNCTIONAL_DRIFT and UNKNOWN differences.',targetedChecks:quality,databaseTypes:'NOT_REGENERATED',packageLock:'UNCHANGED_NOT_RECERTIFIED',sharp:'NOT_RUN',pdfRuntime:'NOT_RUN',typescript:'NOT_RUN',fullVitest:'NOT_RUN',fullLint:'NOT_RUN',linuxBuild:'NOT_RUN',featurePreservationManifest:'NOT_RUN',ciStandard:'NOT_RUN',ciLinux:'NOT_RUN'}
await save('R1_13_FINAL_QUALITY',finalQuality)
const manifest=await read('R1_5_MANIFESTS'),sacadoVersion='20261005173648'
const artifact=manifest.CLEAN_ROOM_CANONICAL.entries.find(e=>e.version===sacadoVersion)
assert.equal(artifact.sha256,'1006e35b48f871c4f14a72f7a3f2045b1f40c13f4bb80d7efeda0e26be8df3ac')
assert.equal(hash(await readFile(artifact.path)),artifact.sha256)
assert(!upgrades.paths.find(p=>p.name==='prod').applied.some(a=>a.version===sacadoVersion))
assert(paths.filter(p=>p.name!=='prod').every(p=>p.applied.some(a=>a.version===sacadoVersion)))
const flags={R1_13_EXISTING_WORK_PRESERVED:'PASS',R1_13_GROUP_BY_ROOT_CAUSE:'PASS',R1_13_TYPACL_GROUP_BY_SUPPORT:'PASS',R1_13_ENUM_ORDER_DETERMINISTIC:'PASS',R1_13_ACL_CAPTURE_PRESERVED:'PASS',R1_13_OWNER_CAPTURE_PRESERVED:'PASS',R1_13_QUERY_SEMANTIC_EQUIVALENCE:'PASS',R1_13_CATALOG_QUERY_NEGATIVE_CONTROLS:'PASS',R1_13_BUSINESS_SQL_UNCHANGED:'PASS',R1_13_FINAL_CATALOG_QUERY:'PASS',RECON_CLEAN_ROOM:'PASS',RECON_SQL:'PASS',R1_13_PROD_FINAL_CATALOG:'PASS',R1_13_HOMOLOG_FINAL_CATALOG:'PASS',R1_13_TARGET_CATALOG_EQUIVALENT:'FAIL',R1_13_P16:'PASS',R1_13_SACADO:'PASS',R1_13_HEALTH_RLX:'PASS',R1_13_C5_A6:'PASS',R1_13_NOTIFICATIONS:'PASS',R1_13_INTEGRATIONS:'PASS',RECON_DATABASE_TYPES:'FAIL',RECON_PACKAGE_LOCK:'FAIL',RECON_SHARP:'FAIL',RECON_PDF_RUNTIME:'FAIL',RECON_TYPESCRIPT:'FAIL',RECON_FULL_SUITE:'FAIL',RECON_LINT:'FAIL',RECON_BUILD_LINUX:'FAIL',R1_13_FEATURE_PRESERVATION_MANIFEST:'FAIL',R1_13_FINAL_DIFF_REVIEW:'FAIL',RECON_CI_STANDARD:'FAIL',RECON_CI_LINUX:'FAIL',DOCKER_TEST_ENV_CLEANUP:'PASS',RECON_PRODUCTION_CHANGED:'NO',RECON_HOMOLOG_CHANGED:'NO',RECON_PRODUCTION_DB_CHANGED:'NO',RECON_HOMOLOG_DB_CHANGED:'NO',RECON_R1_READY_FOR_HOMOLOG_ROLLOUT:'NO'}
const status={at:new Date().toISOString(),result:'STOPPED',branch:checkpoint.branch,head:checkpoint.head,flags,gateSemantics:'Post-catalog FAIL gates are NOT_CERTIFIED_AFTER_STOP, not test execution failures. Domain PASS gates are regression evidence, not whole-schema equivalence. TYPACL_GROUP_BY_SUPPORT PASS means characterization passed; ordered aggregation with ACL grouping is unsupported.',rootCause:diagnosis.rootCause,additionalObservationDefect:nameDiagnosis.rootCause,queryChecks:query.checks,catalog:{objects:raw.paths.map(p=>({path:p.name,count:p.objects})),equal:raw.equalKeys,different:differences.length,classifications:counts,relationAclDifferences:target.directRelationAclDifferences},sql:{pgTapExecutions:pgTap,perPath:418,failed:0,municipalAndCompanionGroups:102},preservation,cleanup:{result:'PASS',stackCount:stacks.size,stacks:[...stacks.values()].map(s=>({projectId:s.projectId,result:s.result,cleanup:s.cleanup})),preexistingInventory:'UNCHANGED',removed:'Only nine newly-created QA stacks; their synthetic data is reproducible from preserved scripts.'},sacado:{version:sacadoVersion,sourceType:'DB_ONLY_RECOVERED_ARTIFACT',sha256:artifact.sha256,prod:'ALREADY_APPLIED_DB_ONLY',homolog:'APPLY_REQUIRED',cleanroom:'APPLY_REQUIRED',prodReplay:false,historyFaked:false,versionedInGit:!!await git(['ls-files','--',artifact.path]),note:'Versioning remains gated on all local checks; no commit/push performed.'},quality:finalQuality,stopReason:'REAL_FUNCTIONAL_DRIFT_AND_UNKNOWN_IN_THREE_WAY_CATALOG',nextStep:'Separate authorized reconciliation diagnosis/decision for schema and ACL differences. Do not patch business SQL in this catalog-only task.',commit:false,push:false,pr:false,deploy:false,remoteChanges:false,readyForRollout:false}
await save('R1_13_STATUS',status)
console.log(JSON.stringify({result:status.result,catalog:status.catalog,sql:status.sql,preservation:preservation.result,cleanup:status.cleanup.result,quality:quality.map(q=>({name:q.name,result:q.result})),readyForRollout:false}))
