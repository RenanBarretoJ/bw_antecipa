// Evidence closeout after the explicit R1.7 SQL stop rule. No remote access.
import assert from 'node:assert/strict'
import { readFile,writeFile,readdir } from 'node:fs/promises'
import { execFileSync,spawnSync } from 'node:child_process'
import { inventory } from '../../email-intake/disposable-resources.mjs'
import { hash } from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const json=async p=>JSON.parse(await readFile(p,'utf8'))
const save=(name,data)=>writeFile(`rehearsal/reports/${name}.json`,JSON.stringify(data,null,2)+'\n',{flag:'wx'})
const checkpoint=await json('rehearsal/reports/R1_7_CHECKPOINT.json')
const cleanroom=await json('rehearsal/reports/R1_7_CLEANROOM.json'),path=cleanroom.paths[0]
assert.equal(cleanroom.result,'FAIL')
assert.equal(path.stage,'SQL_REGRESSION:guibor_a5_base.test.sql')
assert.equal(path.fixture.certification.result,'PASS')
assert.equal(path.applied.length,264)
assert.match(path.failure.message,/# Looks like you failed 2 tests of 36/)
const allowed=new Set(['r1-2-document-fixture.mjs','r1-1-focused.mjs','r1-3-focused.mjs','r1-full-upgrades.mjs','r1-1-municipal-db.mjs','r1-2-storage.mjs','r1-3-notifications.mjs'].map(f=>'scripts/qa/reconciliation/'+f))
allowed.add('scripts/email-intake/companion-db.mjs')
const changes=[]
for(const f of checkpoint.files){
  const after=hash(await readFile(f.path))
  if(after!==f.sha256){assert(allowed.has(f.path),`UNRELATED_WORK_CHANGED:${f.path}`);changes.push({path:f.path,before:f.sha256,after})}
}
for(const f of checkpoint.reports)assert.equal(hash(await readFile(f.path)),f.sha256,`OLD_REPORT_CHANGED:${f.path}`)
const git=args=>execFileSync('git',args,{windowsHide:true,encoding:'utf8'}).trim()
assert.equal(git(['rev-parse','HEAD']),checkpoint.head)
assert.equal(git(['branch','--show-current']),checkpoint.branch)
const after=await inventory()
for(const kind of Object.keys(after))assert.deepEqual(after[kind],checkpoint.docker[kind],`DOCKER_INVENTORY_NOT_PRESERVED:${kind}`)
const resource=await json(`rehearsal/reports/${path.projectId}-resources.json`)
assert(resource.resources.containers.includes('supabase_db_'+path.projectId))
assert.equal(resource.cleanupRuns.at(-1).result,'PASS')
const unitFiles=['r1-7-fixture.test.mjs','r1-6-storage-trace.test.mjs','r1-5-migration-source.test.mjs','r1-4-restorer.test.mjs'].map(f=>'scripts/qa/reconciliation/'+f)
const newHelpers=(await readdir('scripts/qa/reconciliation')).filter(f=>/^r1-7-.*\.mjs$/.test(f)).map(f=>'scripts/qa/reconciliation/'+f)
const run=(name,args)=>{
  const result=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024})
  return {name,exitCode:result.status,result:result.status===0?'PASS':'FAIL',output:(result.stdout??'')+(result.stderr??'')}
}
const quality=[run('26 harness tests',['--test',...unitFiles]),run('targeted ESLint',['node_modules/eslint/bin/eslint.js',...newHelpers,...allowed])]
git(['diff','--check'])
await save('R1_7_HARNESS_QUALITY',{at:new Date().toISOString(),checks:quality,diffCheck:'PASS',fullApplicationQuality:'NOT_RUN_AFTER_SQL_STOP'})
assert(quality.every(q=>q.result==='PASS'),'HARNESS_QUALITY_FAILED')
const target={at:new Date().toISOString(),result:'BLOCKED',reason:'SQL regression failed before three-way recertification. Previous 40 differences were not imported or classified automatically.',differences:[],comparisonExecuted:false,
  cleanroomDiagnosticSnapshotAvailable:!!path.finalCatalog,cleanroomCatalogCertified:false,prodAndHomologNewCaptures:'NOT_RUN_AFTER_SQL_STOP'}
await save('R1_7_TARGET_CATALOG',target)
await save('R1_7_FIXTURE_CERTIFICATION',{at:new Date().toISOString(),...path.fixture,historicalMigrationsModified:false,uuidOverwritten:false,officialCatalogUpdated:false,tests:15,
  fkResolution:{byCode:path.fixture.byCode,oldQaIdsReferencedOutsideMinimalHelper:false,downstreamCompanionAndUploadSuite:'NOT_RUN_AFTER_SQL_STOP'}})
const failed=['RECON_CLEAN_ROOM','RECON_SQL','R1_7_TARGET_CATALOG_EQUIVALENT','R1_7_FK_RESOLUTION','R1_7_P16','R1_7_SACADO','R1_7_HEALTH_RLX','R1_7_C5_A6','R1_7_NOTIFICATIONS','RECON_DATABASE_TYPES','RECON_PACKAGE_LOCK','RECON_SHARP','RECON_PDF_RUNTIME','RECON_TYPESCRIPT','RECON_FULL_SUITE','RECON_LINT','RECON_BUILD_LINUX','R1_7_FEATURE_PRESERVATION_MANIFEST','RECON_CI_STANDARD','RECON_CI_LINUX']
const gates=Object.fromEntries(failed.map(g=>[g,'FAIL']))
for(const g of ['R1_7_EXISTING_WORK_PRESERVED','R1_7_FIXTURE_MODES_SEPARATED','R1_7_CANONICAL_CATALOG_BY_CODE','R1_7_NF_XML_CATALOG','R1_7_DANFE_CATALOG','R1_7_CATALOG_ATTRIBUTE_NEGATIVE','R1_7_CATALOG_DUPLICATE_GUARD','DOCKER_TEST_ENV_CLEANUP'])gates[g]='PASS'
for(const g of ['RECON_PRODUCTION_CHANGED','RECON_HOMOLOG_CHANGED','RECON_PRODUCTION_DB_CHANGED','RECON_HOMOLOG_DB_CHANGED','RECON_R1_READY_FOR_HOMOLOG_ROLLOUT'])gates[g]='NO'
const status={at:new Date().toISOString(),result:'STOPPED',classification:'SQL_TEST_EXPECTATION_OUTDATED_ERROR_MESSAGE',gates,
  failure:{stage:path.stage,test:'supabase/tests/guibor_a5_base.test.sql',assertions:[4,5],totalChecks:36,passed:34,failed:2,sqlstateExpected:'P0001',sqlstateActual:'P0001',
    expectedMessage:'Antecipacao pelo liquido exige valor positivo explicitamente informado no documento',
    actualMessage:'Antecipacao pelo liquido exige valor fiscal explicito ou calculado com retencoes comprovadas',
    source:'supabase/migrations/20261005204958_nfse_calculated_net_audited_correction.sql:185',
    diagnosis:'Both invalid inputs were rejected; exact error-message expectations are stale relative to the canonical calculated-net migration. No business regression was established by these two failures. Assertions and historical migrations were not changed.',
    nextStep:'Review the two SQL expectations against the current fiscal-net contract, preserving exact SQLSTATE/message and rejection behavior. Then rebuild and rerun the complete SQL plan and three-way target certification.'},
  preservation:{checkpointFiles:checkpoint.files.length,previousReports:checkpoint.reports.length,changedCheckpointFiles:changes,head:checkpoint.head,branch:checkpoint.branch,historicalMigrationsChanged:false,dockerAfter:after},
  cleanroom:{projectId:path.projectId,freshDocker:true,canonicalMigrationsApplied:264,exclusions:13,fixture:'PASS',catalogTypes:path.fixture.catalogCount,SQL:'FAIL',fullSQLCompleted:false,p16Helper:path.p16,cleanup:'PASS'},
  fixture:{mode:path.fixture.mode,readOnlyTransaction:true,resolvedByCode:path.fixture.byCode,idsAndAttributesPreserved:true,negativeAttributeChecks:path.fixture.certification.negativeAttributes.length,missingAndDuplicatesRejected:true,uniqueCodeConstraintProved:true},
  quality:{harnessTests:26,harnessTestsResult:'PASS',targetedLint:'PASS',diffCheck:'PASS',globalTypeScript:'NOT_RUN',fullVitest:'NOT_RUN',fullLint:'NOT_RUN',linux:'NOT_RUN'},
  blockedDetails:Object.fromEntries(failed.map(g=>[g,['RECON_SQL','RECON_CLEAN_ROOM'].includes(g)?'EXECUTED_FAIL':g==='R1_7_FK_RESOLUTION'?'RESOLVED_IDS_PASS; DEPENDENT_DOMAIN_SQL_NOT_COMPLETED':g==='R1_7_P16'?'ENUM_HELPER_PASS; COMPLETE_DOMAIN_CERTIFICATION_BLOCKED':'NOT_CERTIFIED_AFTER_SQL_STOP'])),
  dockerCorrection:{priorR16CleanupClaimSuperseded:true,reason:'Supabase CLI truncated the old project ID; R1.6 exact-name tracking missed existing resources. These are preexisting for R1.7, recorded in its checkpoint and preserved.',
    preservedOldProject:'bw_email03_r1full_cleanroom_179137940498',r17UsesShortProjectIds:true,r17Ports:[57941,57942],exactOwnedContainerVerified:true,allR17CreatedResourcesRemoved:true},
  attempts:(await readdir('rehearsal/reports')).filter(f=>/^R1_7_CLEANROOM(?:_attempt_.*)?\.json$/.test(f)),
  safety:{remoteAccessThisTurn:false,commit:false,push:false,pullRequest:false,deploy:false,remoteMigrations:false},
  fullFeatureManifest:'NOT_CREATED: final preservation cannot be claimed before SQL/catalog gates pass.'}
await save('R1_7_STATUS',status)
console.log(JSON.stringify({result:status.result,classification:status.classification,fixture:status.cleanroom.fixture,migrations:264,sql:status.failure,harnessTests:26,previousReportsPreserved:checkpoint.reports.length,dockerCleanup:'PASS'}))
