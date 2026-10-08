// Local evidence only. No database writes, Git publication or remote actions.
import assert from 'node:assert/strict'
import { readFile,writeFile,readdir } from 'node:fs/promises'
import { execFileSync,spawnSync } from 'node:child_process'
import { hash } from './r1-4-restorer.mjs'
import { inventory } from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const json=async p=>JSON.parse(await readFile(p,'utf8'))
const save=async (name,value)=>writeFile(`rehearsal/reports/${name}.json`,JSON.stringify(value,null,2)+'\n',{flag:'wx'})
const checkpoint=await json('rehearsal/reports/R1_6_CHECKPOINT.json')
const upgrades=await json('rehearsal/reports/R1_6_FULL_UPGRADES.json')
const cleanroom=await json('rehearsal/reports/R1_6_CLEANROOM.json')
const c=cleanroom.paths[0]
assert.equal(upgrades.result,'PASS')
assert.equal(cleanroom.result,'FAIL')
assert.equal(c.applied.length,264)
assert.match(c.failure.message,/FIXTURE_CATALOG_DRIFT/)
assert.match(c.failure.stack,/seedDocumentFixture/)
const intentional=new Set([
  'scripts/qa/reconciliation/r1-full-upgrades.mjs',
  'scripts/qa/reconciliation/r1-1-municipal-db.mjs',
  'scripts/qa/reconciliation/r1-2-storage.mjs',
  'scripts/qa/reconciliation/r1-6-capture-triggers.mjs',
  'scripts/qa/reconciliation/r1-6-trigger-catalog.sql',
])
const changes=[]
for(const f of checkpoint.files){
  const after=hash(await readFile(f.path))
  if(after!==f.sha256){assert(intentional.has(f.path),`UNRELATED_CHECKPOINT_CHANGED:${f.path}`);changes.push({path:f.path,before:f.sha256,after})}
}
for(const f of checkpoint.reports)assert.equal(hash(await readFile(f.path)),f.sha256,`PRIOR_REPORT_CHANGED:${f.path}`)
const git=args=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim()
assert.equal(git(['rev-parse','HEAD']),checkpoint.head)
assert.equal(git(['branch','--show-current']),checkpoint.branch)
const after=await inventory()
for(const kind of Object.keys(after)){
  assert(checkpoint.docker[kind].every(n=>after[kind].includes(n)),`PREEXISTING_DOCKER_RESOURCE_REMOVED:${kind}`)
  for(const p of [...upgrades.paths,c])assert(!after[kind].some(n=>n.endsWith('_'+p.projectId)),`OWNED_RESOURCE_REMAINS:${p.projectId}`)
}
assert([...upgrades.paths,c].every(p=>p.cleanup==='PASS'))
const run=(name,args)=>{
  const r=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024})
  const output=(r.stdout??'')+(r.stderr??'')
  return {name,exitCode:r.status,result:r.status===0?'PASS':'FAIL',output,outputSha256:hash(output)}
}
const helpers=(await readdir('scripts/qa/reconciliation')).filter(n=>/^r1-6-.*\.mjs$/.test(n)).map(n=>'scripts/qa/reconciliation/'+n)
const quality=[
  run('harness-tests',['--test','scripts/qa/reconciliation/r1-6-storage-trace.test.mjs','scripts/qa/reconciliation/r1-5-migration-source.test.mjs','scripts/qa/reconciliation/r1-4-restorer.test.mjs']),
  run('targeted-eslint',['node_modules/eslint/bin/eslint.js',...helpers,'scripts/qa/reconciliation/r1-full-upgrades.mjs','scripts/qa/reconciliation/r1-1-municipal-db.mjs','scripts/qa/reconciliation/r1-2-storage.mjs']),
]
let diffCheck='PASS'
try{git(['diff','--check'])}catch{diffCheck='FAIL'}
await save('R1_6_HARNESS_QUALITY',{at:new Date().toISOString(),quality,diffCheck})
const triggerInventory=await json('rehearsal/reports/R1_6_TRIGGER_INVENTORY.json')
const traceRequired=['STORAGE_PREPARE','STORAGE_UPLOAD','FISCAL_COMMIT','COMPENSATION_REQUEST','COMPENSATION_DB_STATE','COMPENSATION_PHYSICAL_STATE','LATE_REUPLOAD_ATTEMPT','LATE_DB_INSERT_ATTEMPT','FINAL_ASSERTIONS']
for(const p of upgrades.paths){
  assert.equal(p.triggerFidelity.result,'PASS')
  for(const stage of traceRequired)assert(p.storageTrace.some(t=>t.stage===stage&&t.result==='PASS'))
  assert(p.storageTrace.every(t=>t.result==='PASS'&&t.completed_at))
  assert(p.storageTrace.some(t=>t.stage==='STORAGE_AUTHORIZED_UPDATE'&&t.actual_outcome==='ALLOWED'))
  assert(p.storageTrace.some(t=>t.stage==='LATE_DB_INSERT_ATTEMPT'&&t.sqlstate==='42501'))
}
const target={at:new Date().toISOString(),result:'BLOCKED',gate:'FAIL',reason:'Clean-room stopped at fixture preparation, before final catalog capture; three-way classification was not executed.',rawProdHomologDifferences:upgrades.targetCatalogDifferences.length,
  differences:upgrades.targetCatalogDifferences.map(d=>({key:d.key,prodUpgradedHash:d.before,homologUpgradedHash:d.after,cleanroomHash:null,classification:null,classificationStatus:'NOT_RUN_CLEANROOM_BLOCKED'})),allowlistCreated:false}
await save('R1_6_TARGET_CATALOG',target)
const gates={}
for(const g of ['R1_6_EXISTING_WORK_PRESERVED','R1_6_APPLICATION_TRIGGER_INVENTORY','R1_6_STORAGE_TRIGGER_CONTRACT','R1_6_TRIGGER_FIDELITY_PROD','R1_6_TRIGGER_FIDELITY_HOMOLOG','R1_6_STORAGE_TRACE','R1_6_STORAGE_TRIGGER_POSITIVE','R1_6_STORAGE_TRIGGER_NEGATIVE','R1_6_STORAGE_COMPENSATION','R1_6_RESTORE_PROD','R1_6_RESTORE_HOMOLOG','RECON_UPGRADE_FROM_PROD','RECON_UPGRADE_FROM_HOMOLOG','R1_6_MANIFEST_C','DOCKER_TEST_ENV_CLEANUP'])gates[g]='PASS'
// FAIL is the requested binary gate format; details distinguish NOT_RUN from an executed failure.
const blocked=['RECON_CLEAN_ROOM','R1_6_TARGET_CATALOG_EQUIVALENT','R1_6_P16','R1_6_SACADO','R1_6_HEALTH_RLX','R1_6_C5_A6','R1_6_NOTIFICATIONS','RECON_DATABASE_TYPES','RECON_PACKAGE_LOCK','RECON_SHARP','RECON_PDF_RUNTIME','RECON_SQL','RECON_TYPESCRIPT','RECON_FULL_SUITE','RECON_LINT','RECON_BUILD_LINUX','RECON_CI_STANDARD','RECON_CI_LINUX']
for(const g of blocked)gates[g]='FAIL'
for(const g of ['RECON_PRODUCTION_CHANGED','RECON_HOMOLOG_CHANGED','RECON_PRODUCTION_DB_CHANGED','RECON_HOMOLOG_DB_CHANGED'])gates[g]='NO'
gates.RECON_R1_READY_FOR_HOMOLOG_ROLLOUT='NO'
assert.equal(triggerInventory.result,'PASS')
const status={at:new Date().toISOString(),result:'STOPPED',classification:'HARNESS_FIXTURE_CLEANROOM_CATALOG_COLLISION',gates,
  blocker:{stage:'SEED_DOCUMENT_FIXTURE',reportedStage:c.stage,explanation:'All 264 migrations completed. The next call seedDocumentFixture compared an existing canonical nf_xml row against a fixed QA UUID. Migration 20260721132903 creates documento_tipos.id DEFAULT gen_random_uuid() and seeds nf_xml without a fixed ID. ON CONFLICT(codigo) DO NOTHING preserves that ID, so deepEqual fails.',failure:c.failure,
    sourcePointers:['scripts/qa/reconciliation/r1-2-document-fixture.mjs:10','scripts/qa/reconciliation/r1-2-document-fixture.mjs:30','supabase/migrations/20260721132903_fase3_repositorio_documental_nf.sql:5','supabase/migrations/20260721132903_fase3_repositorio_documental_nf.sql:26'],
    latentRestriction:'The same helper also asserts exactly two document types, appropriate only to the empty schema-only fixture. That assertion was not reached in this attempt.',
    noBusinessRegressionEstablished:true,fixtureAssertionRelaxed:false,historicalMigrationsEdited:false,
    nextProposedStep:'Design a separate strict clean-room fixture contract: resolve canonical catalog by codigo, validate official attributes and existing IDs/references without overwriting them; retain the strict minimal fixture for schema-only upgrades. Then rerun clean-room and three-way catalog certification.'},
  preserved:{checkpointFiles:checkpoint.files.length,priorReports:checkpoint.reports.length,changedCheckpointFiles:changes,head:checkpoint.head,branch:checkpoint.branch,dockerPreexistingPreserved:true,dockerAfter:after},
  upgrades:upgrades.paths.map(p=>({name:p.name,migrations:p.applied.length,triggerFidelity:p.triggerFidelity.result,applicationTriggers:p.triggerFidelity.count,pgTapChecks:p.tests.reduce((s,t)=>s+t.checks,0),notificationChecks:p.notifications.checks,municipalChecks:p.municipalChecks.length,storageSteps:p.storageTrace.length,cleanup:p.cleanup,result:p.result})),
  cleanroom:{migrationsApplied:c.applied.length,migrationsPlanned:264,excluded:13,fixture:'FAIL',sqlRegressionSuite:'NOT_RUN',finalCatalog:'NOT_CAPTURED',cleanup:c.cleanup},
  blockedGateDetails:Object.fromEntries(blocked.map(g=>[g,g==='RECON_CLEAN_ROOM'?'EXECUTED_FAIL_AT_FIXTURE':/^R1_6_(P16|SACADO|HEALTH_RLX|C5_A6|NOTIFICATIONS)$/.test(g)?'PASS_IN_BOTH_UPGRADES; CLEANROOM_NOT_RUN':'NOT_RUN_AFTER_CLEANROOM_STOP'])),
  harnessQuality:{report:'R1_6_HARNESS_QUALITY.json',result:quality.every(q=>q.result==='PASS')&&diffCheck==='PASS'?'PASS':'FAIL',tests:11,notFullAppCertification:true},
  safety:{remoteAccess:'READ_ONLY_CATALOG',commit:false,push:false,pullRequest:false,deploy:false,remoteMigrations:false,mainHomologWrites:false},
  runnerFollowup:'Added explicit SEED_DOCUMENT_FIXTURE stage after the recorded failure; failed attempt preserved without rerun or rewritten result.'}
await save('R1_6_STATUS',status)
console.log(JSON.stringify({result:status.result,blocker:status.classification,upgrades:status.upgrades,cleanroom:status.cleanroom,harnessQuality:status.harnessQuality,preservedReports:checkpoint.reports.length}))
