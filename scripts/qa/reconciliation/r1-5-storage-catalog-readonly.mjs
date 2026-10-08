// Diagnostic only. Capture application-owned triggers omitted by the prior catalog scope.
import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { hash } from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--read-only'])
const sql=`BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path='';
SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,
'enabled',t.tgenabled,'function',pn.nspname||'.'||p.proname,'definition',pg_get_triggerdef(t.oid),
'functionRawSha256',encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex')) ORDER BY t.tgname),'[]'::jsonb) triggers
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
WHERE NOT t.tgisinternal AND n.nspname='storage' AND pn.nspname IN ('public','private');
COMMIT;`
const queryPath=resolve('rehearsal/tmp/reconciliation-r1-baselines/r15-storage-triggers-readonly.sql')
await writeFile(queryPath,sql)
const report={at:new Date().toISOString(),readOnly:true,scope:'APPLICATION_TRIGGERS_ON_STORAGE_CATALOG_ONLY',targets:[]}
for(const t of [{name:'prod',ref:'wwsndnuvnjuabpbjwlck',linked:'../bw_antecipa_guibor_prod_02'},{name:'homolog',ref:'fhgkmggthxikfpogrvaa',linked:'../bw_antecipa_guibor_a6_r2'}]){
  assert.equal((await readFile(resolve(t.linked,'supabase/.temp/project-ref'),'utf8')).trim(),t.ref)
  const r=spawnSync(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'db','query','--linked','--workdir',resolve(t.linked),'--file',queryPath,'-o','json'],{encoding:'utf8',windowsHide:true,maxBuffer:1000000,timeout:60000})
  assert.equal(r.status,0,'READ_ONLY_QUERY_FAILED_REDACTED')
  const triggers=JSON.parse(r.stdout).rows[0].triggers
  assert(Array.isArray(triggers))
  report.targets.push({name:t.name,ref:t.ref,triggers,sha256:hash(JSON.stringify(triggers))})
}
await writeFile('rehearsal/reports/R1_5_STORAGE_TRIGGER_DIAGNOSIS.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify(report))
