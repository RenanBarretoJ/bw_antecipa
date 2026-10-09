import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { hash } from './r1-4-restorer.mjs'
import { redactCommandOutput } from '../../perf9e/clean-room-lib.mjs'
assert.deepEqual(process.argv.slice(2),['--read-only'])
const sql=await readFile('scripts/qa/reconciliation/r1-6-trigger-catalog.sql','utf8')
const queryPath=resolve('rehearsal/tmp/reconciliation-r1-baselines/r16-triggers-readonly.sql')
await writeFile(queryPath,`BEGIN READ ONLY;SET LOCAL statement_timeout='30s';SET LOCAL search_path='';\n${sql}\nCOMMIT;`)
const report={at:new Date().toISOString(),readOnly:true,querySha256:hash(sql),targets:[],result:'IN_PROGRESS'}
for(const t of [{name:'prod',ref:'wwsndnuvnjuabpbjwlck',linked:'../bw_antecipa_guibor_prod_02'},{name:'homolog',ref:'fhgkmggthxikfpogrvaa',linked:'../bw_antecipa_guibor_a6_r2'}]){
  assert.equal((await readFile(resolve(t.linked,'supabase/.temp/project-ref'),'utf8')).trim(),t.ref)
  const r=spawnSync(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'db','query','--linked','--workdir',resolve(t.linked),'--file',queryPath,'-o','json'],{encoding:'utf8',windowsHide:true,maxBuffer:12000000,timeout:60000})
  assert.equal(r.status,0,redactCommandOutput(r.stderr).slice(-1500))
  const triggers=JSON.parse(r.stdout).rows[0].triggers
  assert(!triggers.some(t=>t.classification==='UNKNOWN'),'UNKNOWN_TRIGGER_STOP')
  const application=triggers.filter(t=>t.classification==='APPLICATION_MANAGED')
  report.targets.push({name:t.name,ref:t.ref,triggers,applicationSha256:hash(JSON.stringify(application))})
  console.log(JSON.stringify({target:t.name,application:application.length,platform:triggers.length-application.length,external:application.filter(t=>!['public','private'].includes(t.schema)).map(t=>({schema:t.schema,table:t.table,name:t.name}))}))
}
const storage=report.targets.find(t=>t.name==='homolog').triggers.find(t=>t.schema==='storage'&&t.name==='fiscal_guard_storage_insert')
assert.equal(storage.function_signature,'private.fiscal_guard_storage_insert()')
assert.equal(storage.enabled,'O');assert.deepEqual(storage.events,['INSERT','UPDATE'])
assert.deepEqual(storage.update_columns,['bucket_id','name','metadata'])
report.result='PASS'
await writeFile('rehearsal/reports/R1_6_TRIGGER_INVENTORY.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'})
