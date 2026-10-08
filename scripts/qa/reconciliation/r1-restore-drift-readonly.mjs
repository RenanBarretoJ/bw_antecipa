// Diagnostic only: do not rerun or change a stopped upgrade rehearsal.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
assert.deepEqual(process.argv.slice(2),['--read-only'])
const root=resolve('rehearsal/tmp/reconciliation-r1-baselines')
const linked=resolve('../bw_antecipa_guibor_prod_02')
assert.equal((await readFile(resolve(linked,'supabase/.temp/project-ref'),'utf8')).trim(),'wwsndnuvnjuabpbjwlck')
const rehearsal=JSON.parse(await readFile('rehearsal/reports/R1_FULL_UPGRADES.json','utf8'))
assert.equal(rehearsal.paths[0].applied.length,0)
const query=`BEGIN READ ONLY;SET LOCAL statement_timeout='30s';SET LOCAL search_path='';
SELECT jsonb_build_object('version',current_setting('server_version'),'functions',(
 SELECT jsonb_agg(jsonb_build_object('key','function:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 'normalizedHash',md5(row(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)),ARRAY(SELECT a::text FROM unnest(coalesce(p.proacl,acldefault('f',p.proowner))) a ORDER BY a::text),p.proowner::regrole)::text)))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.prokind='f' AND position(chr(13)||chr(10) IN p.prosrc)>0),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'hash',md5(pg_get_constraintdef(oid)))) FROM pg_constraint
 WHERE conname IN('comunicacoes_remetente_nome_check','documento_upload_intents_storage_path_check'))) evidence;COMMIT;`
const sqlPath=resolve(root,'restore-drift-readonly.sql');await writeFile(sqlPath,query)
const r=spawnSync(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'db','query','--linked','--workdir',linked,'--file',sqlPath,'-o','json'],{encoding:'utf8',windowsHide:true,maxBuffer:4000000,timeout:60000})
assert.equal(r.status,0,'READ_ONLY_QUERY_FAILED_REDACTED')
const evidence=JSON.parse(r.stdout).rows[0].evidence
const differences=rehearsal.paths[0].baselineCatalogDifferences
const functionDifferences=differences.filter(x=>x.key.startsWith('function:'))
const mappings=functionDifferences.map(d=>({...d,normalizedRemote:evidence.functions.find(x=>x.key===d.key)?.normalizedHash}))
assert(mappings.every(m=>m.after===m.normalizedRemote),'UNEXPLAINED_FUNCTION_DRIFT')
const report={at:new Date().toISOString(),remoteMode:'READ_ONLY_CATALOG',serverVersion:evidence.version,
  appliedUpgradeMigrations:0,normalizedFunctionMatches:mappings.length,functionMappings:mappings,
  functionCause:'The new full-upgrade harness normalizes CRLF inside stored function bodies; exact raw catalog hashes therefore differ. Preserve raw schema bytes before recertification.',
  constraints:evidence.constraints,constraintDifferences:differences.filter(x=>x.key.startsWith('constraint:')),
  constraintsCertifiedEquivalent:false,upgradeResumed:false,productionChanged:false,homologChanged:false}
await writeFile('rehearsal/reports/R1_RESTORE_DRIFT_DIAGNOSIS.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({...report,functionMappings:undefined}))
