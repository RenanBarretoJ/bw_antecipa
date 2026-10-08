// SELECT/catalog only. The existing snapshots remain immutable.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileSha256 } from '../../perf9e/clean-room-lib.mjs'
assert.deepEqual(process.argv.slice(2),['--read-only'])
const capture=JSON.parse(await readFile('rehearsal/reports/R1_SCHEMA_ONLY_BASELINES.json','utf8'))
const catalog=await readFile('scripts/qa/health/schema-catalog.sql','utf8')
const fidelity=await readFile('scripts/qa/reconciliation/r1-4-fidelity-catalog.sql','utf8')
const query=`BEGIN READ ONLY;SET LOCAL statement_timeout='30s';SET LOCAL search_path='';\nWITH f AS (${fidelity.trim().replace(/;$/,'')}) SELECT jsonb_build_object('catalog',(${catalog}),'fidelity',f.evidence) evidence FROM f;\nCOMMIT;`
const queryPath=resolve('rehearsal/tmp/reconciliation-r1-baselines/r14-fidelity-readonly.sql')
await writeFile(queryPath,query)
for(const target of capture.targets){
  const linked=resolve(target.name==='prod'?'../bw_antecipa_guibor_prod_02':'../bw_antecipa_guibor_a6_r2')
  assert.equal((await readFile(resolve(linked,'supabase/.temp/project-ref'),'utf8')).trim(),target.ref)
  assert.equal(fileSha256(target.schemaPath),target.schemaSha256);assert.equal(fileSha256(target.metadataPath),target.metadataSha256)
  const r=spawnSync(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'db','query','--linked','--workdir',linked,'--file',queryPath,'-o','json'],{encoding:'utf8',windowsHide:true,maxBuffer:12000000,timeout:60000})
  assert.equal(r.status,0,'READ_ONLY_QUERY_FAILED_REDACTED')
  const result=JSON.parse(r.stdout).rows[0].evidence
  const old=JSON.parse(await readFile(target.metadataPath,'utf8'))
  assert(result.catalog,'CATALOG_RESULT_MISSING')
  assert.deepEqual(result.catalog,old.catalog,'REMOTE_CATALOG_CHANGED_REBASELINE_REQUIRED')
  const evidence=result.fidelity;assert(evidence)
  const output=`rehearsal/reports/R1_4_${target.name.toUpperCase()}_REMOTE_FIDELITY.json`
  await writeFile(output,JSON.stringify({at:new Date().toISOString(),ref:target.ref,schemaSha256:target.schemaSha256,readOnly:true,evidence},null,2)+'\n')
  console.log(JSON.stringify({name:target.name,functions:evidence.functions.length,crlf:evidence.functions.filter(f=>f.crlf).length,constraints:evidence.constraints,settings:evidence.settings,sha256:fileSha256(output)}))
}
