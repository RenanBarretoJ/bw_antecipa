import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile,writeFile } from 'node:fs/promises'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const reportPath='rehearsal/reports/R1_5_MIGRATION_SOURCE_PIPELINE.json'
try{await writeFile(reportPath.replace('.json',`_attempt_${Date.now()}.json`),await readFile(reportPath),{flag:'wx'})}catch(e){if(e.code!=='ENOENT')throw e}
const result=spawnSync(process.execPath,['--test','scripts/qa/reconciliation/r1-5-migration-source.test.mjs','scripts/qa/reconciliation/r1-4-restorer.test.mjs'],{encoding:'utf8',windowsHide:true})
const report={at:new Date().toISOString(),result:result.status===0?'PASS':'FAIL',exitCode:result.status,
  contracts:['SNAPSHOT_RAW','HISTORICAL_GIT_BLOB','NEW_FORWARD_EXACT_LF','APPROVED_SACADO_DB_ONLY_EXACT'],
  stdout:result.stdout,stderr:result.stderr,
  provenanceShaSource:'R1_5_MIGRATION_PROVENANCE.json'}
const manifests=JSON.parse(await readFile('rehearsal/reports/R1_5_MANIFESTS.json','utf8'))
report.unresolved=Object.values(manifests).filter(v=>v?.unresolved).flatMap(v=>v.unresolved)
if(report.unresolved.length)report.result='FAIL'
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))
assert.equal(report.result,'PASS')
