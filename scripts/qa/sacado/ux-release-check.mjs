// Read-only DB gate for the UI-only release; never execute/replay migrations.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const stage=process.argv[2]
assert(['before','after'].includes(stage));assert.equal(process.argv.length,3)
const ref='wwsndnuvnjuabpbjwlck',linked=resolve('../bw_antecipa_guibor_prod_02')
assert.equal(readFileSync(resolve(linked,'supabase/.temp/project-ref'),'utf8').trim(),ref)
const sql=`BEGIN READ ONLY; SET LOCAL statement_timeout='15s'; SET LOCAL search_path='';
SELECT jsonb_build_object('historyCount',(select count(*) from supabase_migrations.schema_migrations),
'historyHash',(select md5(string_agg(to_jsonb(h)::text,'' order by version)) from supabase_migrations.schema_migrations h),
'hotfixSource',(select statements[1] from supabase_migrations.schema_migrations where version='20261005173648'),
'originalA6Absent',NOT EXISTS(select 1 from supabase_migrations.schema_migrations where version='20260929193129'),
'helpers',(select jsonb_object_agg(p.proname,md5(pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' AND p.proname in ('sacado_tem_acesso_cnpj_fundo','sacado_tem_acesso_operacao','sacado_tem_acesso_operacao_nf')),
'rlsEnabled',(select relrowsecurity from pg_class where oid='public.sacado_acessos'::regclass)) result;
ROLLBACK;`
const run=spawnSync(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'db','query','--linked','--workdir',linked,sql,'-o','json'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1000000})
assert.equal(run.status,0,'READ_ONLY_GATE_FAILED')
const {hotfixSource,...state}=JSON.parse(run.stdout).rows.find(r=>r.result).result
const hash=createHash('sha256').update(hotfixSource.replaceAll('\r\n','\n')).digest('hex')
assert.equal(hash,'1006e35b48f871c4f14a72f7a3f2045b1f40c13f4bb80d7efeda0e26be8df3ac')
assert(state.originalA6Absent && state.rlsEnabled && Object.keys(state.helpers).length===3)
if(stage==='after')assert.deepEqual(state,JSON.parse(readFileSync('rehearsal/reports/SACADO_UX_DB_before.json','utf8')).state,'DATABASE_METADATA_CHANGED')
writeFileSync(`rehearsal/reports/SACADO_UX_DB_${stage}.json`,JSON.stringify({at:new Date().toISOString(),ref,hash,state},null,2))
console.log(JSON.stringify({stage,readOnly:true,historyCount:state.historyCount,hotfixHashMatches:true,rlsEnabled:state.rlsEnabled,originalA6Absent:state.originalA6Absent,metadataUnchanged:stage==='after'?true:undefined}))
