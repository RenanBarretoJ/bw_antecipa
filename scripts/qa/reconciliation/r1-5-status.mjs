// Final read-only/offline audit after the SQL stop. Never resumes a migration.
import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { inventory } from '../../email-intake/disposable-resources.mjs'
import { hash,catalogDiff } from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const json=async p=>JSON.parse(await readFile(p,'utf8'))
const checkpoint=await json('rehearsal/reports/R1_5_CHECKPOINT.json')
const changed=[]
for(const f of checkpoint.files){const after=hash(await readFile(f.path));if(after!==f.sha256)changed.push({path:f.path,before:f.sha256,after})}
assert.deepEqual(changed.map(f=>f.path),['scripts/qa/reconciliation/r1-full-upgrades.mjs'])
for(const f of checkpoint.reports)assert.equal(hash(await readFile(f.path)),f.sha256,`PRIOR_REPORT_CHANGED:${f.path}`)
const git=a=>execFileSync('git',a,{encoding:'utf8',windowsHide:true}).trim()
assert.equal(git(['rev-parse','HEAD']),checkpoint.head)
assert.equal(git(['branch','--show-current']),checkpoint.branch)
const docker=await inventory()
for(const kind of Object.keys(docker)){
  assert(checkpoint.docker[kind].every(x=>docker[kind].includes(x)),`PREEXISTING_${kind}_REMOVED`)
  assert(!docker[kind].some(x=>/bw_email03_r1full_(prod|homolog)_\d+/.test(x)),`OWNED_${kind}_REMAINS`)
}
const prod=await json('rehearsal/reports/R1_5_PROD_UPGRADE.json'),homolog=await json('rehearsal/reports/R1_5_HOMOLOG_UPGRADE.json')
const provenance=await json('rehearsal/reports/R1_5_MIGRATION_PROVENANCE.json')
const pipeline=await json('rehearsal/reports/R1_5_MIGRATION_SOURCE_PIPELINE.json')
const vitest=await json('rehearsal/reports/R1_5_FULL_VITEST.json')
const storage=await json('rehearsal/reports/R1_5_STORAGE_TRIGGER_DIAGNOSIS.json')
assert.equal(prod.result,'PASS');assert.equal(homolog.result,'FAIL')
assert.equal(homolog.notificationGuard.result,'PASS_FULL_MIGRATION')
assert.equal(storage.targets.find(x=>x.name==='homolog').triggers[0].name,'fiscal_guard_storage_insert')
const diff=catalogDiff(prod.finalCatalog,homolog.finalCatalog)
const target={at:new Date().toISOString(),result:'NOT_CERTIFIED',scope:'TWO_TARGET_RAW_CATALOG_DIAGNOSTIC_NOT_THREE_WAY_SEMANTIC_CERTIFICATION',
  rawDifferences:diff,rawDifferencesCount:diff.length,
  knownCoverageGap:'Original catalog query excludes application-owned triggers on storage tables',
  cleanroom:'NOT_RUN',stop:'HOMOLOG_SQL_FAILURE_AND_INCOMPLETE_RESTORE_SCOPE'}
await writeFile('rehearsal/reports/R1_5_TARGET_CATALOG.json',JSON.stringify(target,null,2)+'\n')
await writeFile('rehearsal/reports/R1_5_CLEANROOM.json',JSON.stringify({at:target.at,result:'NOT_RUN',reason:target.stop,applyCountCandidate:264,excludedCandidate:13,createdResources:[]},null,2)+'\n')
const counts=p=>({migrations:p.applied.length,pgTap:p.tests.reduce((n,t)=>n+t.checks,0),notifications:p.notifications,municipalCompleted:p.municipalChecks.length})
const status={at:target.at,result:'STOPPED',classification:'HARNESS_SERIALIZATION',subtype:'SCHEMA_CAPTURE_RESTORE_OMITS_APPLICATION_STORAGE_TRIGGER',
  failure:homolog.failure,limitation:'Failure report does not contain the exact assert.rejects stack location. Missing Storage trigger is independently confirmed; do not claim complete root-cause reproduction or a passed compensation test.',
  preserved:{checkpointFiles:checkpoint.files.length,priorReports:checkpoint.reports.length,changedCheckpointFiles:changed,dockerPreexistingPreserved:true},
  sourceCounts:Object.fromEntries(['GIT_BLOB','NEW_FORWARD_EXACT_LF','APPROVED_DB_ONLY_EXACT'].map(k=>[k,provenance.entries.filter(e=>e.source_kind===k).length])),
  productionLike:counts(prod),homologLike:counts(homolog),
  app:{vitest:{passed:vitest.numPassedTests,failed:vitest.numFailedTests,pending:vitest.numPendingTests},typescript:'PASS',lint:'PASS'},
  gates:{
    R1_5_EXISTING_WORK_PRESERVED:'PASS',R1_5_SNAPSHOT_RAW_PIPELINE:'PASS',R1_5_HISTORICAL_MIGRATION_CANONICAL_PIPELINE:'PASS',
    R1_5_NEW_FORWARD_CANONICAL:'PASS',R1_5_EXECUTED_BYTES_MATCH_MANIFEST:'PASS',R1_5_PIPELINE_TESTS:pipeline.result,
    R1_5_NOTIF_GUARD_CANONICAL_SOURCE:'PASS',R1_5_RESTORE_PROD:'PASS_EXISTING_SCOPE_ONLY',R1_5_RESTORE_HOMOLOG:'FAIL_STORAGE_TRIGGER_OMITTED',
    RECON_UPGRADE_FROM_PROD:'PASS_EXISTING_CHECKS_ONLY',RECON_UPGRADE_FROM_HOMOLOG:'FAIL',R1_5_MANIFEST_C:'NOT_CERTIFIED',
    RECON_CLEAN_ROOM:'NOT_RUN',R1_5_TARGET_CATALOG_EQUIVALENT:'NOT_CERTIFIED',R1_5_P16:'PASS_BOTH_LOCAL_UPGRADES',
    R1_5_SACADO_SHORT_CIRCUIT:'PASS_BOTH_LOCAL_UPGRADES',R1_5_HEALTH_RLX:'FAIL_HOMOLOG_STORAGE_CHECK',
    R1_5_C5_A6:'PASS_FOCUSED_BOTH_UPGRADES',R1_5_NOTIFICATIONS:'PASS_FOCUSED_BOTH_UPGRADES',
    RECON_DATABASE_TYPES:'NOT_CERTIFIED',RECON_PACKAGE_LOCK:'NOT_CERTIFIED',RECON_SHARP:'NOT_CERTIFIED',RECON_PDF_RUNTIME:'NOT_CERTIFIED',
    RECON_SQL:'FAIL',RECON_TYPESCRIPT:'PASS',RECON_FULL_SUITE:'PASS',RECON_LINT:'PASS',RECON_BUILD_LINUX:'NOT_RUN',RECON_CI_STANDARD:'NOT_RUN',RECON_CI_LINUX:'NOT_RUN',
    DOCKER_TEST_ENV_CLEANUP:'PASS',RECON_PRODUCTION_CHANGED:'NO',RECON_HOMOLOG_CHANGED:'NO',RECON_PRODUCTION_DB_CHANGED:'NO',RECON_HOMOLOG_DB_CHANGED:'NO',
    RECON_R1_READY_FOR_HOMOLOG_ROLLOUT:'NO'},
  commit:false,push:false,deploy:false}
assert.equal(vitest.numFailedTests,0)
await writeFile('rehearsal/reports/R1_5_STATUS.json',JSON.stringify(status,null,2)+'\n')
console.log(JSON.stringify({result:status.result,sourceCounts:status.sourceCounts,rawCatalogDifferences:diff.length,productionLike:status.productionLike,homologLike:status.homologLike,preservedReports:checkpoint.reports.length}))
