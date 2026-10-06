// R4 read-only production checkpoint. No business rows, secrets or credentials exported.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {webhookAnchorSql} from './concurrent-webhooks.mjs'

assert.equal(process.argv.length,2)
const ref='wwsndnuvnjuabpbjwlck', certified='c93f88196614c41299b03175851cc2be3feda030'
const linked=resolve('../bw_antecipa_guibor_prod_02'),out='rehearsal/reports/NOTIFICACOES_R4'
mkdirSync(out,{recursive:true});mkdirSync('rehearsal/tmp',{recursive:true})
assert.equal(readFileSync(resolve(linked,'supabase/.temp/project-ref'),'utf8').trim(),ref)
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:20*1024*1024});assert.equal(r.status,0,'COMMAND_FAILED_NO_RAW_OUTPUT');return r.stdout.trim()}
function read(sql){const path=resolve('rehearsal/tmp/notificacoes-r4-readonly.sql');writeFileSync(path,`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s'; SET LOCAL search_path=''; ${sql}; COMMIT;`);return JSON.parse(run(process.execPath,['node_modules/supabase/dist/supabase.js','db','query','--workdir',linked,'--linked','--file',path,'-o','json'])).rows}
const exact=[
  ['20261005213812_notificacoes_fund_scope.sql','6a82c232659985cd9be4e73d80c26f6ec8a431d84c505b18856982008b578010'],
  ['20261006114841_notificacoes_shared_cedente_producers.sql','e8a259a8c5a1df6d14ece3c887ee12b008c8cbcc4a1c510f1634ef7016931748'],
  ['20261006124134_notificacoes_entity_producers.sql','c0fda0f0893b7a8cd51d48a713ffdfd832f46f951a3f2ac8c32bcd5974ddf8f0'],
  ['20261006130657_notificacoes_scoped_ui.sql','6acafc295bfcf998bdae0058cd3f59c0822a4d78ac5ed7928c487893f1e71ea0'],
]
const migrations=exact.map(([file,hash])=>{const source=readFileSync('supabase/migrations/'+file,'utf8').replaceAll('\r\n','\n');assert.equal(createHash('sha256').update(source).digest('hex'),hash);return{file,hash,version:file.slice(0,14),name:file.slice(15,-4)}})
assert.equal(run('git',['diff',certified,'HEAD','--','src','supabase/migrations','package.json','package-lock.json','next.config.ts']),'','FUNCTIONAL_DRIFT')
assert.equal(run('git',['ls-remote','origin','refs/heads/main']).split(/\s/)[0],'7dd1d3a39b98859aa5f9f5bfe7d34385dc66045c','MAIN_DRIFT')
const tableNames=read("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','private') ORDER BY 1,2")
const ident=v=>'"'+v.replaceAll('"','""')+'"'
// All public/private tables plus fiscal Storage: fingerprints only, not row payloads.
const hashes=[...tableNames,{schemaname:'storage',tablename:'objects'}].map(t=>`SELECT '${t.schemaname}.${t.tablename}' AS name,count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${ident(t.schemaname)}.${ident(t.tablename)} t`).join(' UNION ALL ')
const catalog=readFileSync('scripts/qa/health/schema-catalog.sql','utf8')
const history="SELECT version,name,md5(array_to_string(statements,E'\\n')) AS hash FROM supabase_migrations.schema_migrations ORDER BY version"
const report={at:new Date().toISOString(),ref,certified,migrations,readOnly:true,success:false}
try{
  report.baseline=read(`SELECT jsonb_build_object('fingerprints',(SELECT jsonb_agg(x ORDER BY name) FROM (${hashes}) x),'concurrency',(${webhookAnchorSql}),'history',(SELECT jsonb_agg(x) FROM (${history}) x),'catalog',(${catalog}),'version',version(),
    'notificationColumns',(SELECT jsonb_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='notificacoes'),
    'notificationsPerUser',(SELECT jsonb_agg(x) FROM (SELECT md5(usuario_id::text) AS user_hash,count(*)::int AS total,count(*) FILTER(WHERE NOT lida)::int AS unread FROM public.notificacoes GROUP BY usuario_id ORDER BY usuario_id) x),
    'notificationEntityTypes',(SELECT jsonb_agg(x) FROM (SELECT entidade_tipo,count(*)::int total FROM public.notificacoes GROUP BY entidade_tipo) x),
    'notificationWriters',(SELECT jsonb_agg(x) FROM (SELECT n.nspname AS schema,p.proname,md5(p.prosrc) AS hash FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f' AND p.prosrc ~* 'INSERT\\s+INTO\\s+public.notificacoes') x)) AS evidence`)[0].evidence
  assert(!report.baseline.history.some(m=>m.version==='20260929193129'),'ORIGINAL_A6_PRESENT')
  assert(!report.baseline.history.some(m=>migrations.some(x=>x.version===m.version)),'NOTIFICATION_HISTORY_ALREADY_PRESENT')
  assert(!report.baseline.notificationColumns.includes('scope_type'),'PARTIAL_SCOPE_ALREADY_PRESENT')
  const expected=JSON.parse(readFileSync('rehearsal/tmp/notificacoes-reference-metadata.json','utf8')).catalog
  const a=new Map(expected.map(o=>[o.kind+':'+o.name,o.hash])),b=new Map(report.baseline.catalog.map(o=>[o.kind+':'+o.name,o.hash]))
  report.catalogDifferences=[...new Set([...a.keys(),...b.keys()])].filter(k=>a.get(k)!==b.get(k))
  assert.deepEqual(report.catalogDifferences,[],'PRODUCTION_SCHEMA_DRIFT_FROM_REHEARSED_BASELINE')
  report.success=true
}catch(e){report.error={code:e.code??'ASSERTION',message:String(e.message).split('\n')[0].slice(0,160)};process.exitCode=1}
finally{
  const file=out+'/preflight-'+report.at.replaceAll(':','-')+'.json';writeFileSync(file,JSON.stringify(report,null,2))
  writeFileSync(out+'/preflight-latest.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify({ref,success:report.success,at:report.at,file,migrations,catalogDifferenceCount:report.catalogDifferences?.length,catalogDifferenceSample:report.catalogDifferences?.slice(0,5),error:report.error,counts:report.baseline?.fingerprints.filter(t=>['public.notas_fiscais','public.operacoes','public.notificacoes','storage.objects'].includes(t.name))}))
}
