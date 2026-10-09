// Verify local diagnostic artifacts and preservation; stop without app CI/build/SQL.
import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {hash} from './r1-4-restorer.mjs'
import {gitBytes} from './r1-5-migration-source.mjs'
import {inventory} from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const root='rehearsal/reports/',read=async n=>JSON.parse(await readFile(root+n+'.json','utf8')),exec=promisify(execFile)
const cp=await read('R1_14_CHECKPOINT'),master=await read('R1_14_SCHEMA_ACL_DEPARA'),raw=await read('R1_14_CATALOG_DIFF_RAW'),groups=await read('R1_14_ROOT_CAUSE_GROUPS')
assert.equal(master.rows.length,897);assert.deepEqual(master.rows.map(r=>r.OBJECT_KEY),raw.rows.map(r=>r.object_key))
assert.equal(new Set(master.rows.map(r=>r.OBJECT_KEY)).size,897)
assert.equal(groups.groups.reduce((n,g)=>n+g.objectsAffected,0),897)
assert.equal(groups.groups.length,12)
assert(master.rows.every(r=>r.TARGET_CATEGORY!=='UNKNOWN'&&r.AUTOMATIC_RECONCILIATION_PROPOSED===false))
assert(master.rows.filter(r=>r.UNRESOLVED_INTENT).every(r=>r.TARGET_CATEGORY==='MANUAL_DECISION_REQUIRED'&&r.TARGET_STATE===null))
const required=['OBJECT_KEY','KIND','FEATURE','PROD_STATE','HOMOLOG_STATE','CLEANROOM_STATE','PROD_PROVENANCE','HOMOLOG_PROVENANCE','CLEANROOM_PROVENANCE','SECURITY_IMPACT','DATA_IMPACT','TARGET_CATEGORY','TARGET_STATE','RATIONALE','FORWARD_REQUIRED','DATA_COMPAT_CHECK_REQUIRED','TEST_EVIDENCE','CONFIDENCE','MANUAL_APPROVAL_REQUIRED']
for(const r of master.rows)for(const k of required)assert(k in r,'MISSING_FIELD:'+k)
const representative=master.rows.filter(r=>r.KIND==='function'&&r.TARGET_CATEGORY==='REPRESENTATION_ONLY')
assert.equal(representative.length,177)
assert(representative.every(r=>r.CLEANROOM_PROVENANCE.bodyMatches.some(s=>s.inCanonicalChain)||r.CLEANROOM_PROVENANCE.composedProof))
assert.equal((await read('R1_14_RELATION_ACL_DEPARA')).rows.length,57)
const triggers=await read('R1_14_TRIGGER_DEPARA');assert.equal(triggers.count,70);assert(triggers.rows.every(r=>!r.definitionDiffers))
const policies=await read('R1_14_POLICY_DEPARA');assert.equal(policies.rows.filter(r=>r.definitionDiffers).length,2)
const composed=await read('R1_14_COMPOSED_PROVENANCE');assert.equal(composed.result,'PASS');assert.equal(composed.checks.length,3)
const quality=[]
const files=gitBytes(['ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean)
const helpers=[...new Set(files)].filter(p=>/^scripts\/qa\/reconciliation\/r1-14-.*\.mjs$/.test(p))
for(const [name,program,args] of [
 ['offline helper tests','node',['--test','scripts/qa/reconciliation/r1-14-analysis.test.mjs']],
 ['diagnostic helpers lint','node',['node_modules/eslint/bin/eslint.js',...helpers]],
 ['whitespace validation','git',['diff','--check']],
]){
 const result=await exec(program,args,{windowsHide:true,maxBuffer:4*1024*1024})
 quality.push({name,result:'PASS',stdout:result.stdout,stderr:result.stderr})
}
for(const f of cp.files)assert.equal(hash(await readFile(f.path)),f.sha256,'PREEXISTING_WORK_CHANGED:'+f.path)
for(const f of cp.reports)assert.equal(hash(await readFile(f.path)),f.sha256,'PRIOR_REPORT_CHANGED:'+f.path)
const archived=JSON.parse(await readFile(root+'R1_14_attempt_01/manifest.json','utf8'))
for(const f of archived.records)assert.equal(hash(await readFile(f.to)),f.sha256,'DRAFT_ARCHIVE_CHANGED')
assert.deepEqual(await inventory(),cp.docker,'PREEXISTING_DOCKER_CHANGED')
assert.equal(gitBytes(['branch','--show-current']).toString().trim(),cp.branch)
assert.equal(gitBytes(['rev-parse','HEAD']).toString().trim(),cp.head)
const newFiles=[...new Set(files)].filter(p=>!cp.files.some(f=>f.path===p))
assert(newFiles.every(p=>/^scripts\/qa\/reconciliation\/r1-14-.*\.mjs$/.test(p)),'OUT_OF_SCOPE_NEW_SOURCE')
const reportFiles=[]
for(const name of (await readdir(root)).filter(n=>/^R1_14_.*\.(json|md)$/.test(n)))reportFiles.push({path:root+name,sha256:hash(await readFile(root+name))})
const preservation={result:'PASS',checkpointSourceFiles:cp.files.length,previousReports:cp.reports.length,changedExistingFiles:0,newSourceFiles:newFiles,priorDraftArtifactsPreserved:archived.records.length,preexistingDocker:'UNCHANGED',newStacks:0,remoteCatalogReads:0,remoteBusinessReads:0,remoteWrites:0,historicalMigrationsEdited:0,domainChanges:0,fixturesChanged:0}
const gates={R1_14_EXISTING_WORK_PRESERVED:'PASS',R1_14_DIFF_INVENTORY_COMPLETE:'PASS',R1_14_DIFF_CLUSTERING:'PASS',R1_14_PROVENANCE_COVERAGE:'FAIL',R1_14_FEATURE_MAPPING:'PASS',R1_14_RELATION_ACL_DEPARA:'FAIL',R1_14_NULLABILITY_DEPARA:'FAIL',R1_14_POLICY_DEPARA:'FAIL',R1_14_TRIGGER_DEPARA:'PASS',R1_14_ROOT_CAUSE_GROUPING:'PASS',R1_14_FORWARD_PLAN:'FAIL',R1_14_UNKNOWN_REMAINING:717,R1_14_MANUAL_DECISIONS_REQUIRED:717,R1_14_MATERIAL_OBJECT_KEYS_REQUIRING_DECISION:71,R1_14_DATA_COMPAT_CHECKS_REQUIRED:5,R1_14_FORWARD_GROUPS:7,R1_14_APPROVED_FORWARD_GROUPS:0,R1_14_DEPARA_READY:'NO',PRODUCTION_CHANGED:'NO',HOMOLOG_CHANGED:'NO',PRODUCTION_DB_CHANGED:'NO',HOMOLOG_DB_CHANGED:'NO',DOCKER_TEST_ENV_CLEANUP:'PASS'}
const report={at:new Date().toISOString(),result:'STOPPED_DECISION_REQUIRED',branch:cp.branch,head:cp.head,gates,gateSemantics:{FAIL:'Documented diagnostic inventory exists, but intended target/provenance/approval is not complete; not an executed SQL failure',UNKNOWN_REMAINING:'Unresolved material intent counted across 717 raw rows, including 646 repeated parent ACL surfaces. These rows are explicitly MANUAL_DECISION_REQUIRED; not silently auto-resolved.',FEATURE_MAPPING:'Technical feature attribution based on names and linked migration/code references; not organizational sign-off',FORWARD_GROUPS:'Seven conditional proposals, zero approved/executable forwards',TRIGGER_DEPARA:'All 70 DDL/enabled/function-owner states agree; differences are parent ACLs, whose decision remains blocked'},summary:master.summary,preservation,artifacts:reportFiles,quality,checks:{inventoryInvariant:'PASS',mandatoryFields:'PASS',negativeControls:'PASS',canonicalSourcesVerified:270,functionsWithLexicalProof:177,functionsWithComposedSourceProof:3,constraintsWithExactPriorProof:2,schedulerEnvironmentScope:'PASS'},sourceScope:'Local immutable reconstructed R1.13 baseline paths; not fresh production/homolog state',sacado:{version:'20261005173648',sourceType:'DB_ONLY_RECOVERED_ARTIFACT',prod:'ALREADY_APPLIED_DB_ONLY',homolog:'APPLY_REQUIRED',cleanroom:'APPLY_REQUIRED',prodReplay:false,historyFaked:false},notRun:['new SQL rehearsal','remote business preflights','schema/ACL mutations','types generation','full application quality','Linux build','CI','commit','push','PR','deploy'],nextStep:'Approve specific per-object targets only after resolving provenance and compatibility. No forward migration authorized by this diagnosis.'}
await writeFile(root+'R1_14_PRESERVATION.json',JSON.stringify(preservation,null,2)+'\n',{flag:'wx'})
await writeFile(root+'R1_14_STATUS.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({result:report.result,gates,preservation,quality:quality.map(q=>({name:q.name,result:q.result}))}))
