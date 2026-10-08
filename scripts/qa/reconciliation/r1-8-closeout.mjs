// R1.8 stop evidence. No remote access, privilege escalation, or further SQL execution.
import assert from 'node:assert/strict'
import { readFile,writeFile,readdir } from 'node:fs/promises'
import { execFileSync,spawnSync } from 'node:child_process'
import { inventory } from '../../email-intake/disposable-resources.mjs'
import { hash } from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const json=async p=>JSON.parse(await readFile(p,'utf8'))
const save=(name,data)=>writeFile(`rehearsal/reports/${name}.json`,JSON.stringify(data,null,2)+'\n',{flag:'wx'})
const checkpoint=await json('rehearsal/reports/R1_8_CHECKPOINT.json')
const a5=await json('rehearsal/reports/R1_8_A5_SQL.json')
const cleanroom=await json('rehearsal/reports/R1_8_CLEANROOM.json'),path=cleanroom.paths[0]
assert.equal(a5.result,'PASS');assert.equal(a5.paths[0].tests[0].checks,36)
assert.equal(cleanroom.result,'FAIL');assert.equal(path.failure.code,'42501')
assert.equal(path.failure.message,'permission denied to terminate process')
assert.match(path.failure.stack,/verifyExtraSql/)
assert.equal(path.applied.length,264);assert.equal(path.fixture.certification.result,'PASS')
assert(path.tests.every(t=>t.result==='PASS'));assert.equal(path.extraSql.tests.length,0)
assert.equal(path.tests.find(t=>t.file==='r1_8_fiscal_net_contract.test.sql').checks,14)
const allowed=new Set(['scripts/qa/reconciliation/r1-full-upgrades.mjs','scripts/qa/reconciliation/r1-2-storage.mjs','scripts/email-intake/operators-db.mjs','scripts/email-intake/automation-db.mjs'])
const changes=[]
for(const f of checkpoint.files){const after=hash(await readFile(f.path));if(after!==f.sha256){assert(allowed.has(f.path),`UNRELATED_WORK_CHANGED:${f.path}`);changes.push({path:f.path,before:f.sha256,after})}}
for(const f of checkpoint.reports)assert.equal(hash(await readFile(f.path)),f.sha256,`OLD_REPORT_CHANGED:${f.path}`)
const old=await json('rehearsal/reports/R1_3_WORKTREE_BEFORE.json')
for(const f of old.historicalMigrations)assert.equal(hash(await readFile(f.path)),f.sha256,`HISTORICAL_MIGRATION_CHANGED:${f.path}`)
const git=args=>execFileSync('git',args,{windowsHide:true,encoding:'utf8'}).trim()
assert.equal(git(['rev-parse','HEAD']),checkpoint.head);assert.equal(git(['branch','--show-current']),checkpoint.branch)
const after=await inventory()
assert.deepEqual(after,checkpoint.docker,'PREEXISTING_DOCKER_INVENTORY_CHANGED')
const reportNames=await readdir('rehearsal/reports')
const resources=reportNames.filter(f=>/^bw_email03_r18(?:prod|homolog|clean)_\d+-resources\.json$/.test(f))
assert.equal(resources.length,3)
for(const file of resources){const r=await json('rehearsal/reports/'+file);assert.equal(r.cleanupRuns.at(-1).result,'PASS');assert(r.resources.containers.includes('supabase_db_'+r.projectId))}
const unitFiles=['r1-8-contract.test.mjs','r1-7-fixture.test.mjs','r1-6-storage-trace.test.mjs','r1-5-migration-source.test.mjs','r1-4-restorer.test.mjs'].map(f=>'scripts/qa/reconciliation/'+f)
const helpers=(await readdir('scripts/qa/reconciliation')).filter(f=>/^r1-8-.*\.mjs$/.test(f)).map(f=>'scripts/qa/reconciliation/'+f)
const run=(name,args)=>{const r=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});return {name,result:r.status===0?'PASS':'FAIL',exitCode:r.status,output:(r.stdout??'')+(r.stderr??'')}}
const quality=[run('harness tests',['--test',...unitFiles]),run('targeted ESLint',['node_modules/eslint/bin/eslint.js',...helpers,...allowed])]
git(['diff','--check'])
await save('R1_8_FINAL_QUALITY',{at:new Date().toISOString(),result:'BLOCKED',reason:'Final application quality cannot be certified after SQL harness stop.',harnessChecks:quality,diffCheck:'PASS',globalTypeScript:'NOT_RUN',fullVitest:'NOT_RUN',globalLint:'NOT_RUN',linuxBuild:'NOT_RUN',databaseTypes:'NOT_RUN',packageSharpPdf:'NOT_RUN'})
assert(quality.every(q=>q.result==='PASS'),'HARNESS_QUALITY_FAILED')
const attempts=reportNames.filter(f=>/^R1_8_CLEANROOM_attempt_.*\.json$/.test(f))
assert.equal(attempts.length,1)
const core=(await json('rehearsal/reports/'+attempts[0])).paths[0]
assert.equal(core.result,'PASS');assert.equal(core.municipalChecks.length,34)
const failure={classification:'LOCAL_HARNESS_PERMISSION_BLOCK',actualStage:'PREPARE_EXTRA_SQL_DATABASE_CLONES',rawRecordedStage:path.stage,
  rawStageNote:'Last completed test label remained set when the clone helper failed; guibor_nfse_review_intents.assert.sql itself passed.',
  sqlstate:'42501',message:path.failure.message,source:'scripts/qa/reconciliation/r1-8-extra-sql.mjs:25',
  statement:"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres'",
  meaning:'The local postgres session cannot terminate at least one service-owned backend. Complementary integration/inbox/automation assertions did not execute.',
  notEstablished:['Business-rule regression','Integration functional failure','Three-way target equivalence'],
  nextStep:'Review a least-privilege way to provision dedicated local test databases without terminating privileged service sessions; preserve all failed attempts and SQL/database guards. Then rerun the full fresh clean-room and three-way certification.'}
await save('R1_8_FULL_SQL',{at:new Date().toISOString(),result:'FAIL',completion:'INCOMPLETE_HARNESS_BLOCK',tests:path.tests,pgTapChecks:path.tests.reduce((n,t)=>n+(t.checks??0),0),notifications:path.notifications,failure,
  extraSqlExecuted:false,extraSqlPlanned:['integration_credential_first.sql','integration_inline_credentials.sql','integration_activation_before_cnab.sql','RLX_OPERATORS_INBOX','RLX_AUTOMATION'],
  separateSameRoundCoreRun:{report:attempts[0],result:'PASS',municipalStorageChecks:core.municipalChecks,storageTrace:core.storageTrace,notFullSuite:true}})
await save('R1_8_TARGET_CATALOG',{at:new Date().toISOString(),result:'BLOCKED',comparisonExecuted:false,reason:'Full SQL not certified; no new PROD/HOMOLOG/CLEAN_ROOM comparison attempted.',previous40DifferencesReused:false,differences:[],diagnosticCleanroomCaptureAvailable:true,diagnosticCaptureIsCertification:false})
const blocked=['RECON_CLEAN_ROOM','RECON_SQL','R1_8_TARGET_CATALOG_EQUIVALENT','R1_8_P16','R1_8_SACADO','R1_8_HEALTH_RLX','R1_8_C5_A6','R1_8_NOTIFICATIONS','RECON_DATABASE_TYPES','RECON_PACKAGE_LOCK','RECON_SHARP','RECON_PDF_RUNTIME','RECON_TYPESCRIPT','RECON_FULL_SUITE','RECON_LINT','RECON_BUILD_LINUX','R1_8_FEATURE_PRESERVATION_MANIFEST','R1_8_FINAL_DIFF_REVIEW','RECON_CI_STANDARD','RECON_CI_LINUX']
const gates=Object.fromEntries(blocked.map(g=>[g,'FAIL']))
for(const g of ['R1_8_EXISTING_WORK_PRESERVED','R1_8_ERROR_CONTRACT_REVIEW','R1_8_TEST_EXPECTATIONS_UPDATED','R1_8_A5_SQL','DOCKER_TEST_ENV_CLEANUP'])gates[g]='PASS'
for(const g of ['RECON_PRODUCTION_CHANGED','RECON_HOMOLOG_CHANGED','RECON_PRODUCTION_DB_CHANGED','RECON_HOMOLOG_DB_CHANGED','RECON_R1_READY_FOR_HOMOLOG_ROLLOUT'])gates[g]='NO'
const manifest=await json('rehearsal/reports/R1_5_MANIFESTS.json')
const artifact=manifest.CLEAN_ROOM_CANONICAL.entries.find(m=>m.version==='20261005173648')
assert.equal(artifact.source_kind,'APPROVED_DB_ONLY_EXACT');assert.equal(hash(await readFile(artifact.path)),artifact.sha256)
const status={at:new Date().toISOString(),result:'STOPPED',classification:failure.classification,gates,failure,
  preservation:{checkpointFiles:checkpoint.files.length,previousReports:checkpoint.reports.length,historicalMigrations:old.historicalMigrations.length,changedCheckpointFiles:changes,head:checkpoint.head,branch:checkpoint.branch,historicalMigrationsChanged:false,businessRulesChanged:false,dockerAfter:after},
  contract:{source:'20261005204958_nfse_calculated_net_audited_correction.sql',sqlstate:'P0001',exactMessage:'Antecipacao pelo liquido exige valor fiscal explicito ou calculado com retencoes comprovadas',changedAssertions:[4,5],isolatedA5:36,nonRelaxationChecks:14},
  cleanroom:{freshDocker:true,applied:264,excluded:13,fixture:'PASS',canonicalSourceHashes:'PASS',completeSQL:false,attempts:[...attempts,'R1_8_CLEANROOM.json']},
  partialDomains:{P16:{helper:path.p16,a5SnapshotAndReuse:'PASS',notFinalThreeWayCertification:true},SACADO:{checks:38,result:'PASS_IN_CLEANROOM'},C5_A6:{result:'PASS_IN_CLEANROOM'},notifications:{checks:136,result:'PASS_IN_CLEANROOM'},healthRlx:{municipalChecks:36,reviewIntents:'PASS',separateCoreStorageAndCompanionChecks:34,operatorsAndAutomation:'NOT_RUN'}},
  blockedDetails:Object.fromEntries(blocked.map(g=>[g,['RECON_CLEAN_ROOM','RECON_SQL'].includes(g)?'INCOMPLETE_HARNESS_BLOCK':g.startsWith('R1_8_')&&['P16','SACADO','HEALTH_RLX','C5_A6','NOTIFICATIONS'].some(x=>g.endsWith(x))?'PARTIAL_CLEANROOM_EVIDENCE_NOT_FINAL_THREE_WAY_CERTIFICATION':'NOT_RUN_AFTER_SQL_STOP'])),
  dbOnlyArtifact:{version:artifact.version,sha256:artifact.sha256,SOURCE_TYPE:'DB_ONLY_RECOVERED_ARTIFACT',PROD:'ALREADY_APPLIED_DB_ONLY',HOMOLOG:'APPLY_REQUIRED',CLEAN_ROOM:'APPLY_REQUIRED',PROD_REPLAY:'NO',HISTORY_FAKE:'NO',committedThisTurn:false},
  finalFeatureManifest:'NOT_CREATED: full SQL and three-way gates incomplete; no final preservation claim.',
  safety:{remoteAccess:false,remoteWrites:false,remoteMigrations:false,roleEscalation:false,commit:false,push:false,draftPR:false,deploy:false},
  docker:{removedOwnedResourceManifests:resources,allPreexistingPreserved:true,cleanup:'PASS'}}
await save('R1_8_STATUS',status)
console.log(JSON.stringify({result:status.result,A5:'36/36 PASS',nonRelaxation:'14/14 PASS',pgTapChecks:path.tests.reduce((n,t)=>n+(t.checks??0),0),notificationChecks:111,failure,previousReportsPreserved:checkpoint.reports.length,dockerCleanup:'PASS',readyForHomolog:'NO'}))
