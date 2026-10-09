// Preserve the failed fidelity attempt. This closeout performs no SQL or remote operations.
import assert from 'node:assert/strict'
import { readFile,writeFile,readdir } from 'node:fs/promises'
import { execFileSync,spawnSync } from 'node:child_process'
import { inventory } from '../../email-intake/disposable-resources.mjs'
import { hash } from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const json=async p=>JSON.parse(await readFile(p,'utf8'))
const save=(name,data)=>writeFile(`rehearsal/reports/${name}.json`,JSON.stringify(data,null,2)+'\n',{flag:'wx'})
const checkpoint=await json('rehearsal/reports/R1_9_CHECKPOINT.json')
const cleanroom=await json('rehearsal/reports/R1_9_CLEANROOM.json'),path=cleanroom.paths[0]
assert.equal(cleanroom.result,'FAIL')
assert.equal(path.stage,'PREPARE_EXTRA_SQL_DATABASES:PREPARER_TESTS')
assert.match(path.failure.message,/DUMP_RESTORE_APPLICATION_CATALOG_NOT_FAITHFUL/)
assert.equal(path.applied.length,264);assert.equal(path.fixture.certification.result,'PASS')
assert(path.tests.every(t=>t.result==='PASS'));assert.equal(path.extraSql.tests.length,0)
assert.equal(path.cleanup,'PASS');assert(path.dbPreparation.databases.every(d=>d.cleanup==='PASS'))
const allowed=new Set([
  'scripts/qa/reconciliation/r1-full-upgrades.mjs','scripts/qa/reconciliation/r1-8-extra-sql.mjs',
  'scripts/qa/reconciliation/r1-2-storage.mjs',
  'scripts/email-intake/operators-db.mjs','scripts/email-intake/automation-db.mjs',
  ...['integration_credential_first.sql','integration_inline_credentials.sql','integration_activation_before_cnab.sql'].map(f=>'supabase/tests/'+f),
])
const changes=[]
for(const f of checkpoint.files){const after=hash(await readFile(f.path));if(after!==f.sha256){assert(allowed.has(f.path),`UNRELATED_WORK_CHANGED:${f.path}`);changes.push({path:f.path,before:f.sha256,after})}}
for(const f of checkpoint.reports)assert.equal(hash(await readFile(f.path)),f.sha256,`OLD_REPORT_CHANGED:${f.path}`)
const old=await json('rehearsal/reports/R1_3_WORKTREE_BEFORE.json')
for(const f of old.historicalMigrations)assert.equal(hash(await readFile(f.path)),f.sha256,`HISTORICAL_MIGRATION_CHANGED:${f.path}`)
const git=args=>execFileSync('git',args,{windowsHide:true,encoding:'utf8'}).trim()
assert.equal(git(['rev-parse','HEAD']),checkpoint.head);assert.equal(git(['branch','--show-current']),checkpoint.branch)
const after=await inventory();assert.deepEqual(after,checkpoint.docker,'PREEXISTING_DOCKER_INVENTORY_CHANGED')
const reportNames=await readdir('rehearsal/reports')
const resources=reportNames.filter(f=>/^bw_email03_r19(?:prod|homolog|clean)_\d+-resources\.json$/.test(f))
assert.equal(resources.length,1)
for(const file of resources){const r=await json('rehearsal/reports/'+file);assert.equal(r.cleanupRuns.at(-1).result,'PASS')}
const unitFiles=['r1-9-db-prep.test.mjs','r1-8-contract.test.mjs','r1-7-fixture.test.mjs','r1-6-storage-trace.test.mjs','r1-5-migration-source.test.mjs','r1-4-restorer.test.mjs'].map(f=>'scripts/qa/reconciliation/'+f)
const helpers=(await readdir('scripts/qa/reconciliation')).filter(f=>/^r1-9-.*\.mjs$/.test(f)).map(f=>'scripts/qa/reconciliation/'+f)
const run=(name,args)=>{const r=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});return {name,result:r.status===0?'PASS':'FAIL',exitCode:r.status,output:(r.stdout??'')+(r.stderr??'')}}
const quality=[run('harness tests',['--test',...unitFiles]),run('targeted ESLint',['node_modules/eslint/bin/eslint.js',...helpers,...[...allowed].filter(f=>f.endsWith('.mjs'))])]
git(['diff','--check'])
await save('R1_9_FINAL_QUALITY',{at:new Date().toISOString(),result:'BLOCKED',reason:'Clone fidelity stop; final application quality not executed.',harnessChecks:quality,diffCheck:'PASS',globalTypeScript:'NOT_RUN',fullVitest:'NOT_RUN',globalLint:'NOT_RUN',linuxBuild:'NOT_RUN',databaseTypes:'NOT_RUN',packageSharpPdf:'NOT_RUN'})
const failure={classification:'LOCAL_DUMP_RESTORE_FIDELITY_BLOCK',actualStage:path.stage,message:path.failure.message,
  differences:path.dbPreparation.databases[0].catalogDifferences.map(d=>({...d,classification:'UNKNOWN',reason:'Hash differs; no paired definition/ACL evidence captured. No semantic-equivalence claim.'})),
  stopRule:'R1.9 section 33: clone nao for fiel',
  notEstablished:['Application regression','Constraint semantic drift','Schema privilege drift','Three-way equivalence'],
  nextStep:'Resume with explicit fidelity diagnosis or the separate fresh-stack-per-suite alternative from section 5. Preserve this FAIL; do not normalize or ignore these differences without proof.'}
await save('R1_9_DB_PREP_TESTS',{at:new Date().toISOString(),result:'FAIL',method:'DUMP_RESTORE',unitTests:quality[0],runtimeResult:'FAIL_FIDELITY_FIRST_PROBE',
  runtimeChecks:{openServiceConnection:'INCOMPLETE_FIRST_PROBE_FAILED',twoDatabases:'NOT_RUN',sourceAccessible:'CHECKED_DURING_OWNED_CLEANUP_NO_ERROR',expectedObjects:'FAIL',ownedCleanup:'PASS',remoteRejected:'PASS_UNIT'},
  sourcePreservedFlagNote:'Raw sourcePreserved=false is the initialization value; finish() did not execute. remove() checked original source catalog and source/watcher PIDs without throwing during abort. No full preparer PASS is claimed.',
  manifest:path.dbPreparation,failure})
const planned=['integration_credential_first.sql','integration_inline_credentials.sql','integration_activation_before_cnab.sql','RLX_OPERATORS_INBOX','RLX_AUTOMATION']
await save('R1_9_EXTRA_SQL',{at:new Date().toISOString(),result:'FAIL',execution:'NOT_RUN_PREPARATION_FAILED',method:'DUMP_RESTORE',tests:[],planned,failure,
  exclusions:[{file:'integration_credential_upgrade.sql',reason:'Pre-hotfix migration upgrade test; not applicable to already-final canonical target. No historical hotfix replay on final schema.'}]})
const pgTapChecks=path.tests.reduce((n,t)=>n+(t.checks??0),0)
await save('R1_9_FULL_SQL',{at:new Date().toISOString(),result:'FAIL',completion:'INCOMPLETE_PREPARER_FIDELITY_BLOCK',tests:path.tests,pgTapChecks,notifications:path.notifications,extraSqlExecuted:false,municipalStorage:'NOT_RUN_AFTER_STOP',failure})
await save('R1_9_TARGET_CATALOG',{at:new Date().toISOString(),result:'BLOCKED',comparisonExecuted:false,reason:'Full SQL failed at preparer; no fresh three-way capture authorized beyond stop.',previous40DifferencesReused:false,cloneDifferences:failure.differences,diagnosticCleanroomCaptureAvailable:true,diagnosticCaptureIsCertification:false})
const blocked=['R1_9_DB_PREP_TESTS','RECON_CLEAN_ROOM','R1_9_EXTRA_SQL_SUITES','RECON_SQL','R1_9_TARGET_CATALOG_EQUIVALENT','R1_9_P16','R1_9_SACADO','R1_9_HEALTH_RLX','R1_9_C5_A6','R1_9_NOTIFICATIONS','RECON_DATABASE_TYPES','RECON_PACKAGE_LOCK','RECON_SHARP','RECON_PDF_RUNTIME','RECON_TYPESCRIPT','RECON_FULL_SUITE','RECON_LINT','RECON_BUILD_LINUX','R1_9_FEATURE_PRESERVATION_MANIFEST','R1_9_FINAL_DIFF_REVIEW','RECON_CI_STANDARD','RECON_CI_LINUX']
const gates=Object.fromEntries(blocked.map(g=>[g,'FAIL']))
for(const g of ['R1_9_EXISTING_WORK_PRESERVED','R1_9_NO_SERVICE_SESSION_TERMINATION','R1_9_DB_PREP_LOCAL_ONLY','R1_9_STAGE_TELEMETRY','DOCKER_TEST_ENV_CLEANUP'])gates[g]='PASS'
gates.R1_9_DB_PREP_STRATEGY='DUMP_RESTORE';gates.LOCAL_INFRA_ADMIN_ONLY='YES'
for(const g of ['RECON_PRODUCTION_CHANGED','RECON_HOMOLOG_CHANGED','RECON_PRODUCTION_DB_CHANGED','RECON_HOMOLOG_DB_CHANGED','RECON_R1_READY_FOR_HOMOLOG_ROLLOUT'])gates[g]='NO'
const manifest=await json('rehearsal/reports/R1_5_MANIFESTS.json'),artifact=manifest.CLEAN_ROOM_CANONICAL.entries.find(m=>m.version==='20261005173648')
assert.equal(artifact.source_kind,'APPROVED_DB_ONLY_EXACT');assert.equal(hash(await readFile(artifact.path)),artifact.sha256)
const status={at:new Date().toISOString(),result:'STOPPED',classification:failure.classification,gates,failure,
  preservation:{checkpointFiles:checkpoint.files.length,previousReports:checkpoint.reports.length,historicalMigrations:old.historicalMigrations.length,changedCheckpointFiles:changes,head:checkpoint.head,branch:checkpoint.branch,historicalMigrationsChanged:false,businessRulesChanged:false,dockerAfter:after},
  cleanroom:{freshDocker:true,applied:264,excluded:13,fixture:'PASS',canonicalSourceHashes:'PASS',pgTapChecks,notificationChecks:path.notifications.checks,completeSQL:false},
  blockedDetails:Object.fromEntries(blocked.map(g=>[g,['R1_9_DB_PREP_TESTS','RECON_CLEAN_ROOM','R1_9_EXTRA_SQL_SUITES','RECON_SQL'].includes(g)?'INCOMPLETE_PREPARER_FIDELITY_BLOCK':'NOT_CERTIFIED_AFTER_STOP'])),
  dbOnlyArtifact:{version:artifact.version,sha256:artifact.sha256,SOURCE_TYPE:'DB_ONLY_RECOVERED_ARTIFACT',PROD:'ALREADY_APPLIED_DB_ONLY',HOMOLOG:'APPLY_REQUIRED',CLEAN_ROOM:'APPLY_REQUIRED',PROD_REPLAY:'NO',HISTORY_FAKE:'NO',committedThisTurn:false},
  finalFeatureManifest:'NOT_CREATED: full SQL and three-way gates incomplete; no final preservation claim.',
  harnessQuality:quality.map(q=>({name:q.name,result:q.result})),
  safety:{remoteAccess:false,remoteWrites:false,remoteMigrations:false,roleEscalation:false,commit:false,push:false,draftPR:false,deploy:false},
  docker:{removedOwnedResourceManifests:resources,allPreexistingPreserved:true,cleanup:'PASS'}}
await save('R1_9_STATUS',status)
console.log(JSON.stringify({result:status.result,pgTapChecks,notificationChecks:path.notifications.checks,differences:failure.differences,quality:status.harnessQuality,previousReportsPreserved:checkpoint.reports.length,dockerCleanup:'PASS',readyForHomolog:'NO'}))
assert(quality.every(q=>q.result==='PASS'),'HARNESS_QUALITY_FAILED')
