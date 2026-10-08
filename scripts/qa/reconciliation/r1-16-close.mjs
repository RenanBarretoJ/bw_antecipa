import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {hash} from './r1-4-restorer.mjs'
import {inventory} from '../../email-intake/disposable-resources.mjs'
import {gitBytes} from './r1-5-migration-source.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const dir='rehearsal/reports/',read=async n=>JSON.parse(await readFile(dir+n+'.json','utf8'))
const cp=await read('R1_16_CHECKPOINT'),up=await read('R1_16_FULL_UPGRADES'),clean=await read('R1_16_CLEANROOM')
const proofName='R1_16_RLS_1791408039833',proof=await read(proofName)
assert.equal(proof.result,'FAIL_STOPPED');assert.equal(proof.cleanup,'PASS')
assert.equal(up.result,'PASS');assert.equal(clean.result,'PASS')
const paths=[...up.paths,...clean.paths]
const changed=[]
for(const f of cp.files){const after=hash(await readFile(f.path));if(after!==f.sha256)changed.push({path:f.path,before:f.sha256,after})}
assert.deepEqual(changed.map(f=>f.path),['scripts/qa/reconciliation/r1-full-upgrades.mjs'])
for(const f of [...cp.reports,...cp.migrations])assert.equal(hash(await readFile(f.path)),f.sha256,'PRIOR_ARTIFACT_CHANGED:'+f.path)
assert.equal(gitBytes(['rev-parse','HEAD']).toString().trim(),cp.head)
assert.equal(gitBytes(['branch','--show-current']).toString().trim(),cp.branch)
assert.deepEqual(await inventory(),cp.docker,'DOCKER_INVENTORY_CHANGED')
const manifest=await read('R1_16_FORWARD_MANIFEST')
for(const e of manifest.entries)assert.equal(hash(await readFile(e.path)),e.sha256)
const queries=proof.runs.reduce((s,r)=>s+r.variants.reduce((n,v)=>n+v.results.length,0),0)
assert.equal(queries,1120);assert.equal(proof.comparisons.length,840)
const candidate=proof.comparisons.filter(c=>c.candidateVariant==='WITHOUT_BOTH')
for(const c of candidate){assert.deepEqual(c.added,[]);assert.deepEqual(c.legitimateLost,[]);assert.deepEqual(c.candidateUnexpected,[])}
const deniedGuard=ddl=>ddl.replaceAll('\r\n','\n').match(/  IF NOT \(\n    \(v_role = 'cedente'[\s\S]*?END IF;/)?.[0]
const baselineFunctions=await read('R1_15_PROD_FUNCTIONS')
const priorGuard=deniedGuard(baselineFunctions.rows.find(r=>r.name==='corrigir_duplicata').definition)
const forward=await readFile(manifest.entries[4].path,'utf8')
assert(priorGuard);assert.equal(deniedGuard(forward),priorGuard,'AUTHORIZATION_WAS_CHANGED')
const diagnosis={result:'FUNCTIONAL_AUTHORIZATION_FAILURE_STOP',runtimeEvidence:proofName+'.json',failure:proof.failure,
  executedAgainst:'One newly-created disposable canonical Supabase stack with the seven forwards; synthetic data only',
  assertion:'Unauthorized RPC scenarios expect P0001, but one call returned successfully (actual error code null).',
  runtimeActorCaptured:false,
  evidenceLimitation:'The helper returned its check list only on completion, so the raw failure does not identify which negative actor failed. Do not assert an exact actor from this runtime trace.',
  staticFinding:'The unchanged IF NOT (authorization expression) can evaluate to NULL when get_user_cedente_id() returns NULL for a Cedente without a link. PL/pgSQL IF does not execute its rejection branch for NULL. The SECURITY DEFINER RPC then continues.',
  inferredCandidate:'cedente_sem_vinculo (actor 6 in the negative-case order); inferred from code and fixture, not captured per-actor runtime evidence.',
  provenance:'The identical authorization block exists in the read-only R1.15 PROD/HOMOLOG captures; current baseline catalog was revalidated in R1.16. No exploit or business data query was run remotely.',
  scope:'FWD-05 changed only text recognition; authorization was deliberately preserved as required by R1.16.',
  nextDecision:'Authorize an isolated local investigation with durable per-case actor/result capture and, after confirming the exact case, an additional forward making authorization reject FALSE and NULL (IS NOT TRUE), preserving legitimate access, MFA, auditing and role/fund/ownership contracts. Then restart fresh-stack certification.',
  fixesAppliedAfterFailure:false,certificationContinuedAfterFailure:false}
const sql={result:'FAIL_STOPPED',principalPaths:paths.map(p=>({name:p.name,result:p.result,pgTap:p.tests.reduce((n,t)=>n+(t.checks??0),0)+p.notifications.checks,municipalGroups:p.municipalChecks.length})),passedPgTap:1254,failedPgTap:0,municipalGroups:102,rls:{queries,comparisons:proof.comparisons.length,completedStacks:1,requiredStacks:2,candidateRowsAdded:0,legitimateRowsLost:0},failedDirectedAssertions:1,extraSuites:'NOT_RUN_AFTER_AUTHORIZATION_FAILURE',TOTAL_SQL_CHECKS:'PARTIAL_ONLY; heterogeneous pgTAP, scenario and row-set checks are reported separately',FAILED_SQL_CHECKS:1}
const finalAcl={result:'PASS_LOCAL_THREE_PATHS',relations:57,authenticated:56,serviceRole:1,exactMatrices:true,idempotent:true,paths:paths.map(p=>({name:p.name,result:p.r116.securityComposition})),releaseCertified:false}
const finalRls={result:'FAIL_NOT_FULLY_CERTIFIED',proof:proofName+'.json',queries,comparisons:840,completedStacks:1,requiredStacks:2,firstStackCandidate:'No widening or legitimate loss; expected legacy extras removed',stop:diagnosis}
const quality={result:'NOT_RUN_AFTER_STOP',targetedLint:'PASS (new R1.16 helpers and reused runner)',diffCheck:'PASS',fullTypescript:'NOT_RUN',fullVitest:'NOT_RUN',fullLint:'NOT_RUN',linuxBuild:'NOT_RUN',databaseTypes:'NOT_RECERTIFIED',packageSharpPdf:'NOT_RECERTIFIED',CI:'NOT_RUN'}
const status={at:new Date().toISOString(),result:'STOPPED_FUNCTIONAL_AUTHORIZATION_FAILURE',branch:cp.branch,head:cp.head,diagnosis,gateSemantics:'FAIL on unexecuted gates means NOT_CERTIFIED_AFTER_STOP, not a test that was run and failed. DDL/idempotence success is not rollout readiness.',
  R1_16_EXISTING_WORK_PRESERVED:'PASS',R1_16_DATA_PREFLIGHT_PROD:'PASS',R1_16_DATA_PREFLIGHT_HOMOLOG:'PASS',R1_16_REMOTE_BASELINE_STILL_VALID:'PASS',
  R1_16_FWD01_ACL:'PASS',R1_16_ESCROW_COLUMNS:'PASS',R1_16_TIMESTAMP_NOT_NULL:'PASS',R1_16_TAXAS_CHECKS:'PASS',R1_16_BOOTSTRAP_ORIGIN:'PASS',R1_16_CORRIGIR_DUPLICATA:'FAIL',R1_16_RLS_CLEANUP:'FAIL',R1_16_TAXAS_INDEX:'PASS',R1_16_FORWARD_SECURITY_REVIEW:'PASS',R1_16_FORWARD_MANIFEST:'PASS',
  RECON_UPGRADE_FROM_PROD:'PASS',RECON_UPGRADE_FROM_HOMOLOG:'PASS',RECON_CLEAN_ROOM:'PASS',RECON_SQL:'FAIL',R1_16_TARGET_CATALOG_EQUIVALENT:'FAIL',R1_16_FINAL_ACL:'PASS',R1_16_FINAL_RLS:'FAIL',R1_16_FINAL_STRUCTURE:'FAIL',
  R1_16_P16:'PASS',R1_16_SACADO:'PASS',R1_16_HEALTH_RLX:'PASS',R1_16_C5_A6:'PASS',R1_16_NOTIFICATIONS:'PASS',R1_16_INTEGRATIONS:'FAIL',R1_16_GUIBOR:'PASS',R1_16_TAXAS:'FAIL',
  RECON_DATABASE_TYPES:'FAIL',RECON_PACKAGE_LOCK:'FAIL',RECON_SHARP:'FAIL',RECON_PDF_RUNTIME:'FAIL',RECON_TYPESCRIPT:'FAIL',RECON_FULL_SUITE:'FAIL',RECON_LINT:'FAIL',RECON_BUILD_LINUX:'FAIL',R1_16_FEATURE_PRESERVATION_MANIFEST:'FAIL',R1_16_FINAL_DIFF_REVIEW:'FAIL',RECON_CI_STANDARD:'FAIL',RECON_CI_LINUX:'FAIL',DOCKER_TEST_ENV_CLEANUP:'PASS',
  RECON_PRODUCTION_CHANGED:'NO',RECON_HOMOLOG_CHANGED:'NO',RECON_PRODUCTION_DB_CHANGED:'NO',RECON_HOMOLOG_DB_CHANGED:'NO',RECON_R1_READY_FOR_HOMOLOG_ROLLOUT:'NO',
  preservation:{priorSourceFiles:cp.files.length,priorReports:cp.reports.length,originalMigrations:270,historical:267,changedQaHelpers:changed,newForwards:7,existingDocker:'UNCHANGED'},sql,quality,commit:false,push:false,pr:false,deploy:false,remoteBusinessReads:'Only the eight authorized aggregate counts; no detailed rows',remoteCatalogReads:4}
const outputs={R1_16_FULL_SQL:sql,R1_16_FINAL_ACL:finalAcl,R1_16_FINAL_RLS:finalRls,R1_16_FINAL_QUALITY:quality,R1_16_TARGET_CATALOG:{result:'NOT_RUN_AFTER_SQL_STOP',reason:diagnosis.result},R1_16_AUTHORIZATION_STOP:diagnosis,R1_16_STATUS:status}
for(const [name,data] of Object.entries(outputs))await writeFile(dir+name+'.json',JSON.stringify(data,null,2)+'\n',{flag:'wx'})
const artifacts=(await readdir(dir)).filter(n=>n.startsWith('R1_16_')).sort()
console.log(JSON.stringify({result:status.result,ready:status.RECON_R1_READY_FOR_HOMOLOG_ROLLOUT,preserved:status.preservation,cleanup:status.DOCKER_TEST_ENV_CLEANUP,artifacts:artifacts.length}))
