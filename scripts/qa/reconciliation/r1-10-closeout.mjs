// Read-only postflight plus durable local reports after the R1.10 SQL stop.
import assert from 'node:assert/strict'
import { readFile,writeFile,readdir } from 'node:fs/promises'
import { execFileSync,spawnSync } from 'node:child_process'
import { inventory } from '../../email-intake/disposable-resources.mjs'
import { hash } from './r1-4-restorer.mjs'
import { readMigrationSource } from './r1-5-migration-source.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const json=async p=>JSON.parse(await readFile(p,'utf8'))
const save=(name,data)=>writeFile(`rehearsal/reports/${name}.json`,JSON.stringify(data,null,2)+'\n',{flag:'wx'})
const checkpoint=await json('rehearsal/reports/R1_10_CHECKPOINT.json')
const harness=await json('rehearsal/reports/R1_10_STACK_HARNESS.json'),extra=await json('rehearsal/reports/R1_10_EXTRA_SQL_SUITES.json')
assert.equal(harness.result,'PASS');assert.equal(extra.result,'FAIL');assert.equal(extra.failure.code,'23505')
assert.match(extra.failure.message,/profiles_pkey/)
assert.deepEqual(extra.tests.map(t=>[t.suite,t.result,t.checkCount]),[['operators','PASS',19],['automation','PASS',22]])
const failed=extra.stacks.find(s=>s.result==='FAIL');assert.equal(failed.suite,'credential')
const changedNames=[
  ...['automation','companion','fencing','operators','temporal'].map(n=>`scripts/email-intake/${n}-db.mjs`),
  ...['integration_activation_before_cnab.sql','integration_credential_first.sql','integration_inline_credentials.sql'].map(n=>'supabase/tests/'+n),
  ...['r1-2-document-fixture.mjs','r1-2-storage.mjs','r1-full-upgrades.mjs'].map(n=>'scripts/qa/reconciliation/'+n),
]
const changes=[]
for(const f of checkpoint.files){const after=hash(await readFile(f.path));if(after!==f.sha256){assert(changedNames.includes(f.path),`UNRELATED_WORK_CHANGED:${f.path}`);changes.push({path:f.path,before:f.sha256,after})}}
for(const f of checkpoint.reports)assert.equal(hash(await readFile(f.path)),f.sha256,`OLD_REPORT_CHANGED:${f.path}`)
const old=await json('rehearsal/reports/R1_3_WORKTREE_BEFORE.json')
for(const f of old.historicalMigrations)assert.equal(hash(await readFile(f.path)),f.sha256,`HISTORICAL_MIGRATION_CHANGED:${f.path}`)
const git=args=>execFileSync('git',args,{windowsHide:true,encoding:'utf8'}).trim()
assert.equal(git(['rev-parse','HEAD']),checkpoint.head);assert.equal(git(['branch','--show-current']),checkpoint.branch)
const after=await inventory();assert.deepEqual(after,checkpoint.docker,'PREEXISTING_DOCKER_INVENTORY_CHANGED')
const names=await readdir('rehearsal/reports'),resources=[]
for(const file of names.filter(n=>/^bw_email03_r110[a-z]+_\d+-resources\.json$/.test(n))){
  const r=await json('rehearsal/reports/'+file)
  for(const kind of ['containers','volumes','networks'])assert(r.resources[kind].every(n=>!after[kind].includes(n)),'OWNED_RESOURCE_REMAINS')
  resources.push({file,projectId:r.projectId,resources:r.resources,recordedCleanup:r.cleanupRuns.at(-1).result,finalOwnedAbsence:'PASS'})
}
assert.equal(resources.length,7)
const attempts=names.filter(n=>/^R1_10_STACK_HARNESS_attempt_\d+\.json$/.test(n));assert.equal(attempts.length,1)
const attempt=await json('rehearsal/reports/'+attempts[0]);assert.equal(attempt.result,'FAIL');assert.equal(attempt.cleanupFailure,'PREEXISTING_CONTAINERS_REMOVED')
const allStacks=[...harness.stacks,...extra.stacks]
for(const s of allStacks){assert.equal(s.applied.length,264);assert.equal(s.excluded,13);assert.equal(s.fixture.certification.result,'PASS');assert.equal(s.method,'FRESH_STACK');assert.equal(s.cleanup,'PASS')}
const manifest=await json('rehearsal/reports/R1_5_MANIFESTS.json'),plan=manifest.CLEAN_ROOM_CANONICAL
for(const s of allStacks)assert.deepEqual(s.applied.map(m=>[m.version,m.sha256]),plan.applyOrder.map(v=>{const m=plan.entries.find(e=>e.version===v);return [v,m.sha256]}))
const triggerSources=[]
for(const version of ['20260812120000','20260827205000']){
  const entry=plan.entries.find(e=>e.version===version),source=await readMigrationSource(entry)
  assert.equal(hash(Buffer.from(source.sql)),entry.sha256)
  triggerSources.push({version,sha256:entry.sha256,path:entry.path,source:source.evidence})
}
const testSource=await readFile('supabase/tests/integration_credential_first.sql','utf8')
assert(testSource.indexOf('INSERT INTO auth.users')<testSource.indexOf('INSERT INTO public.profiles'))
assert(testSource.indexOf('INSERT INTO public.profiles')<testSource.indexOf('public.admin_cadastrar_credencial_integracao'))
const failure={classification:'TEST_FIXTURE_DUPLICATE_PROFILE',stage:failed.stage,sqlstate:'23505',constraint:'profiles_pkey',
  test:'supabase/tests/integration_credential_first.sql',lines:[7,9],
  explanation:'Auth INSERT invokes canonical on_auth_user_created / handle_new_user, which already inserts the profile. The fixture then inserts that same primary key explicitly. Credential domain assertions were not reached.',
  canonicalSources:triggerSources,stopRule:'R1.10 section 32: suite complementar falhar',
  nextStep:'Adapt only the credential fixtures to assert and reuse the profile created by the canonical Auth trigger. Preserve role/MFA assertions, do not disable triggers, and rerun fresh stacks after approval.',
  notEstablished:['Credential business-rule regression','Full SQL PASS','Final three-way equivalence']}
const unitFiles=['r1-10-stack.test.mjs','r1-9-db-prep.test.mjs','r1-8-contract.test.mjs','r1-7-fixture.test.mjs','r1-6-storage-trace.test.mjs','r1-5-migration-source.test.mjs','r1-4-restorer.test.mjs'].map(n=>'scripts/qa/reconciliation/'+n)
const helpers=(await readdir('scripts/qa/reconciliation')).filter(n=>/^r1-10-.*\.mjs$/.test(n)).map(n=>'scripts/qa/reconciliation/'+n)
const run=(name,args)=>{const r=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});return {name,result:r.status===0?'PASS':'FAIL',exitCode:r.status,output:(r.stdout??'')+(r.stderr??'')}}
const quality=[run('harness tests',['--test',...unitFiles]),run('targeted ESLint',['node_modules/eslint/bin/eslint.js',...helpers,...changedNames.filter(n=>n.endsWith('.mjs'))])]
git(['diff','--check'])
await save('R1_10_FINAL_QUALITY',{at:new Date().toISOString(),result:'BLOCKED',reason:'Complementary SQL failed; no global application gates executed after stop.',harnessChecks:quality,diffCheck:'PASS',globalTypeScript:'NOT_RUN',fullVitest:'NOT_RUN',globalLint:'NOT_RUN',linuxBuild:'NOT_RUN',databaseTypes:'NOT_RUN',packageSharpPdf:'NOT_RUN'})
await save('R1_10_CLEANROOM',{at:new Date().toISOString(),result:'BLOCKED',execution:'NOT_RUN_AFTER_EXTRA_SQL_STOP',reason:'Fresh complementary stacks are not a substitute for the required final principal clean-room.',historicalBaseSqlReused:false})
await save('R1_10_FULL_SQL',{at:new Date().toISOString(),result:'FAIL',completion:'INCOMPLETE',TOTAL_SQL_CHECKS:41,checkUnit:'Named scenario groups completed in operators/inbox and automation, not a count of individual assertions.',FAILED_SQL_CHECKS:1,failureUnit:'Suite setup SQL statement',tests:extra.tests,failure,
  baseSqlThisRound:'NOT_RUN',municipalStorageThisRound:'NOT_RUN',remaining:extra.planned.filter(s=>!extra.tests.some(t=>t.suite===s)),
  previous307And111:'PRESERVED_HISTORICAL_ONLY_NOT_ADDED_TO_CURRENT_TOTAL',
  sqlInventory:{base:'r1-full-upgrades.mjs --local-only --r110 --cleanroom',extra:extra.planned,uiNotifications:'notificacoes_ui_scope.sql via verifyNotificationRegression',fiscalNetAndFrozen:'via verifyMunicipalCompatibility',historicalUpgradeFixture:'integration_credential_upgrade.sql applies to pre-hotfix schema only; never replay against final target'}})
await save('R1_10_TARGET_CATALOG',{at:new Date().toISOString(),result:'BLOCKED',comparisonExecuted:false,reason:'Full SQL incomplete.',rejectedR19CloneDifferencesReused:false,previous40DifferencesReused:false})
const blocked=['R1_10_EXTRA_SQL_SUITES','RECON_CLEAN_ROOM','RECON_SQL','R1_10_TARGET_CATALOG_EQUIVALENT','R1_10_P16','R1_10_SACADO','R1_10_HEALTH_RLX','R1_10_C5_A6','R1_10_NOTIFICATIONS','RECON_DATABASE_TYPES','RECON_PACKAGE_LOCK','RECON_SHARP','RECON_PDF_RUNTIME','RECON_TYPESCRIPT','RECON_FULL_SUITE','RECON_LINT','RECON_BUILD_LINUX','R1_10_FEATURE_PRESERVATION_MANIFEST','R1_10_FINAL_DIFF_REVIEW','RECON_CI_STANDARD','RECON_CI_LINUX']
const gates=Object.fromEntries(blocked.map(g=>[g,'FAIL']))
for(const g of ['R1_10_EXISTING_WORK_PRESERVED','R1_10_DUMP_RESTORE_REJECTED','R1_10_FRESH_STACK_CONTRACT','R1_10_MANIFEST_C_REUSED_EXACTLY','R1_10_CANONICAL_FIXTURE','R1_10_LOCAL_ONLY_GUARD','R1_10_STACK_HARNESS_TESTS','DOCKER_TEST_ENV_CLEANUP'])gates[g]='PASS'
for(const g of ['RECON_PRODUCTION_CHANGED','RECON_HOMOLOG_CHANGED','RECON_PRODUCTION_DB_CHANGED','RECON_HOMOLOG_DB_CHANGED','RECON_R1_READY_FOR_HOMOLOG_ROLLOUT'])gates[g]='NO'
const artifact=plan.entries.find(e=>e.version==='20261005173648');assert.equal(hash(await readFile(artifact.path)),artifact.sha256)
assert.equal(artifact.sha256,'1006e35b48f871c4f14a72f7a3f2045b1f40c13f4bb80d7efeda0e26be8df3ac')
const status={at:new Date().toISOString(),result:'STOPPED',classification:failure.classification,gates,failure,
  R1_9_DB_PREP_STRATEGY:'DUMP_RESTORE_REJECTED_FOR_CERTIFICATION',rejectionReason:'APPLICATION_CATALOG_NOT_FAITHFUL',
  preservation:{checkpointFiles:checkpoint.files.length,previousReports:checkpoint.reports.length,historicalMigrations:old.historicalMigrations.length,changedCheckpointFiles:changes,head:checkpoint.head,branch:checkpoint.branch,historicalMigrationsChanged:false,businessRulesChanged:false,dockerAfter:after},
  partialEvidence:{operatorsInbox:19,automation:22,principalCleanroom:'NOT_RUN',fullSQL:false,unitTestCount:50},
  blockedDetails:Object.fromEntries(blocked.map(g=>[g,g==='R1_10_EXTRA_SQL_SUITES'?'FAIL_CREDENTIAL_FIXTURE':g==='RECON_SQL'?'INCOMPLETE':'NOT_CERTIFIED_AFTER_SQL_STOP'])),
  dbOnlyArtifact:{version:artifact.version,sha256:artifact.sha256,SOURCE_TYPE:'DB_ONLY_RECOVERED_ARTIFACT',PROD:'ALREADY_APPLIED_DB_ONLY',HOMOLOG:'APPLY_REQUIRED',CLEAN_ROOM:'APPLY_REQUIRED',PROD_REPLAY:'NO',HISTORY_FAKE:'NO',committedThisTurn:false},
  finalFeatureManifest:'NOT_CREATED: final certification gates incomplete.',harnessQuality:quality.map(q=>({name:q.name,result:q.result})),
  safety:{remoteAccess:false,remoteWrites:false,remoteMigrations:false,roleEscalation:false,commit:false,push:false,draftPR:false,deploy:false},
  docker:{resources,allPreexistingPreserved:true,cleanup:'PASS',priorAttempt:attempts[0],priorAttemptNote:'First probe run removed its own A before B, while B postflight treated A as preexisting. Physical cleanup completed; false missing-peer alarm preserved. Retry used B-then-A creation and A-then-B cleanup without changing ownership checks.'}}
await save('R1_10_STATUS',status)
console.log(JSON.stringify({result:status.result,failure,quality:status.harnessQuality,previousReports:checkpoint.reports.length,cleanup:'PASS',readyForHomolog:'NO'}))
assert(quality.every(q=>q.result==='PASS'),'HARNESS_QUALITY_FAILED')
