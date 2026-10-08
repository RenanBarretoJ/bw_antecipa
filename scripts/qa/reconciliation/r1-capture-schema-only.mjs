// Read-only remote schema checkpoint. No business rows, jobs, env changes, or DDL.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
assert.deepEqual(process.argv.slice(2),['--read-only'])
const sql=await readFile('rehearsal/reports/R1_3_FOCUSED_SQL.json','utf8')
assert.equal(JSON.parse(sql).result,'PASS','R1_3_REQUIRED')
const catalog=await readFile('scripts/qa/health/schema-catalog.sql','utf8')
const targets=[
  {name:'prod',ref:'wwsndnuvnjuabpbjwlck',linked:'../bw_antecipa_guibor_prod_02',originalA6:0},
  {name:'homolog',ref:'fhgkmggthxikfpogrvaa',linked:'../bw_antecipa_guibor_a6_r2',originalA6:1},
]
const root=resolve('rehearsal/tmp/reconciliation-r1-baselines')
await mkdir(root,{recursive:true})
const hash=s=>createHash('sha256').update(s).digest('hex')
const cli=resolve('node_modules/supabase/dist/supabase.js')
const run=args=>new Promise((done,reject)=>{
  const child=spawn(process.execPath,[cli,...args],{windowsHide:true});let output=''
  child.stdout.on('data',b=>{output+=b});child.stderr.resume()
  child.on('error',()=>reject(new Error('CLI_SPAWN_FAILED')))
  child.on('exit',code=>code===0?done(output):reject(new Error(`READ_ONLY_CLI_FAILED:${code}:REDACTED`)))
})
const query=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s'; SET LOCAL search_path='';
SELECT jsonb_build_object(
 'catalog',(${catalog}),
 'history',(SELECT jsonb_agg(x ORDER BY version) FROM (SELECT version,name,encode(extensions.digest(array_to_string(statements,E'\\n'),'sha256'),'hex') sha256 FROM supabase_migrations.schema_migrations) x),
 'a6',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20260929193129'),
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
 'storagePolicies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='storage'),
 'authTriggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal AND n.nspname IN('public','private')),
 'buckets',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) ORDER BY id) FROM storage.buckets),
 'realtimeTables',(SELECT jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename) ORDER BY schemaname,tablename) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname IN('public','private'))
) evidence;
COMMIT;`
const queryPath=resolve(root,'schema-metadata-readonly.sql')
await writeFile(queryPath,query)
const report={at:new Date().toISOString(),mode:'READ_ONLY_SCHEMA_ONLY',productionChanged:false,homologChanged:false,targets:[],result:'IN_PROGRESS'}
try{
  for(const t of targets){
    assert.equal((await readFile(resolve(t.linked,'supabase/.temp/project-ref'),'utf8')).trim(),t.ref)
    const metadata=async()=>JSON.parse(await run(['db','query','--linked','--workdir',resolve(t.linked),'--file',queryPath,'-o','json'])).rows[0].evidence
    console.log(JSON.stringify({stage:'READ_ONLY_SCHEMA_CAPTURE',target:t.name,ref:t.ref}))
    const before=await metadata();assert.equal(before.a6,t.originalA6)
    const schemaPath=resolve(root,t.name+'-schema.sql')
    await run(['db','dump','--linked','--workdir',resolve(t.linked),'--schema','public,private','--file',schemaPath])
    const schema=await readFile(schemaPath,'utf8')
    assert(!/^COPY\s|^INSERT INTO\s|^SELECT pg_catalog.setval/m.test(schema),'DATA_DUMP_REFUSED')
    assert(!/CREATE TABLE[^\n]*"supabase_migrations"|INSERT INTO[^\n]*schema_migrations/i.test(schema),'HISTORY_DUMP_REFUSED')
    assert(!/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.|sk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(schema),'POSSIBLE_SECRET_STOP')
    assert.deepEqual(await metadata(),before,'REMOTE_METADATA_CHANGED_DURING_READ')
    const metadataText=JSON.stringify(before,null,2)+'\n'
    const metadataPath=resolve(root,t.name+'-metadata.json');await writeFile(metadataPath,metadataText)
    report.targets.push({name:t.name,ref:t.ref,schemaPath,metadataPath,schemaSha256:hash(schema),metadataSha256:hash(metadataText),catalogObjects:before.catalog.length,historyRows:before.history.length,originalA6:before.a6})
  }
  report.result='PASS'
}catch(e){report.result='FAIL';report.error={message:e.message,code:e.code};process.exitCode=1}
await writeFile('rehearsal/reports/R1_SCHEMA_ONLY_BASELINES.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))
