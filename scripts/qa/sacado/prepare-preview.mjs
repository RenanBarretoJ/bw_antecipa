// Explicit schema-only bootstrap for SACADO. Source is READ ONLY.
// Never copies data/history, never resets a populated target, never replays A6.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const mode = process.argv[2]
assert(['--precheck', '--apply', '--verify'].includes(mode) && process.argv.length === 3)
const manifest = JSON.parse(readFileSync('scripts/qa/sacado/preview-manifest.json', 'utf8'))
assert.equal(manifest.mode, 'MANUAL_EXPLICIT_LIST')
assert.equal(manifest.projectRef, 'yynlrtonrqxoatmuclrt')
assert.equal(manifest.branchId, 'c31a3f44-0c5a-413d-8a39-b5d2eeda010e')
assert.deepEqual(manifest.migrations, [])
assert.deepEqual(manifest.excludedVersions, ['20260929193129'])
const sourceDir = resolve('../bw_antecipa_guibor_prod_02')
assert.equal(readFileSync(resolve(sourceDir, 'supabase/.temp/project-ref'), 'utf8').trim(), manifest.parentProjectRef)
assert.equal(manifest.parentProjectRef, 'wwsndnuvnjuabpbjwlck')
const schemaFile = 'rehearsal/tmp/sacado-production-schema-only.sql'
const checkpointFile = 'rehearsal/reports/SACADO_PREVIEW_SCHEMA_CHECKPOINT.json'
mkdirSync('rehearsal/reports', { recursive: true })
const hash = value => createHash('sha256').update(value).digest('hex')
const ident = value => '"' + value.replaceAll('"', '""') + '"'
const schema = readFileSync(schemaFile, 'utf8')
assert(schema.length > 100000, 'EMPTY_SCHEMA')
assert(!/^COPY\s|^INSERT INTO\s|^SELECT pg_catalog.setval/m.test(schema), 'DATA_DUMP_REFUSED')
assert(!/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.|sk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(schema), 'POSSIBLE_SECRET_STOP')
const catalogSql = readFileSync('scripts/qa/health/schema-catalog.sql', 'utf8')
function cli(args) {
  const r = spawnSync(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 30 * 1024 * 1024,
  })
  assert.equal(r.status, 0, 'CLI_FAILED_NO_SECRET_OUTPUT')
  return JSON.parse(r.stdout)
}
const metadataSql = `select jsonb_build_object('catalog',(${catalogSql}),
 'history',(select jsonb_build_object('count',count(*),'hash',md5(string_agg(to_jsonb(m)::text,'' order by version))) from supabase_migrations.schema_migrations m),
 'a6',(select count(*) from supabase_migrations.schema_migrations where version='20260929193129'),
 'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname)) from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
 'storage_policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='storage'),
 'auth_triggers',(select jsonb_agg(pg_get_triggerdef(t.oid)) from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where t.tgrelid='auth.users'::regclass and not t.tgisinternal and n.nspname in ('public','private')),
 'buckets',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)) from storage.buckets),
 'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'def',pg_get_constraintdef(oid))) from pg_constraint where conname in ('comunicacoes_remetente_nome_check','documento_upload_intents_storage_path_check'))) evidence`
function sourceRead() {
  const path = resolve('rehearsal/tmp/sacado-source-readonly.sql')
  writeFileSync(path, `BEGIN READ ONLY; SET LOCAL statement_timeout='60s'; SET LOCAL search_path=''; ${metadataSql}; COMMIT;`)
  return cli(['db','query','--linked','--workdir',sourceDir,'--file',path,'-o','json']).rows[0].evidence
}
const source = sourceRead()
assert.equal(source.a6, 0, 'ORIGINAL_A6_SOURCE_PRESENT')
const details = cli(['branches','get',manifest.branchId,'--project-ref',manifest.parentProjectRef,'-o','json'])
assert.equal(new URL(details.SUPABASE_URL).hostname, `${manifest.projectRef}.supabase.co`)
const targetUrl = new URL(details.POSTGRES_URL)
assert(targetUrl.hostname === `db.${manifest.projectRef}.supabase.co` || decodeURIComponent(targetUrl.username).endsWith(`.${manifest.projectRef}`), 'WRONG_DB_TARGET')
const client = new pg.Client({ connectionString: details.POSTGRES_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 })
const report = { at: new Date().toISOString(), mode, target: manifest.projectRef, source: manifest.parentProjectRef, schemaSha256: hash(schema), success: false }
function differences(a,b) {
  const left = new Map(a.map(o=>[`${o.kind}:${o.name}`,o.hash]))
  const right = new Map(b.map(o=>[`${o.kind}:${o.name}`,o.hash]))
  return [...new Set([...left.keys(),...right.keys()])].filter(k=>left.get(k)!==right.get(k)).sort()
}
async function empty() {
  const result = (await client.query(`select jsonb_build_object('tables',(select count(*) from pg_tables where schemaname in ('public','private')),
    'users',(select count(*) from auth.users),'objects',(select count(*) from storage.objects),'history',(select count(*) from supabase_migrations.schema_migrations)) state`)).rows[0].state
  return result
}
async function verify() {
  await client.query("SET search_path=''")
  const actual = (await client.query(catalogSql)).rows[0].objects
  let delta = differences(source.catalog, actual)
  const definitions = (await client.query("select conname name,pg_get_constraintdef(oid) def from pg_constraint where conname in ('comunicacoes_remetente_nome_check','documento_upload_intents_storage_path_check')")).rows
  // Only these two known pg_dump AND-parenthesis representations are equivalent.
  const pairs = [
    ['comunicacoes_remetente_nome_check', String.raw`CHECK ((((char_length(btrim(remetente_nome)) >= 1) AND (char_length(btrim(remetente_nome)) <= 120)) AND (remetente_nome !~ '[\r\n]'::text)))`, String.raw`CHECK (((char_length(btrim(remetente_nome)) >= 1) AND (char_length(btrim(remetente_nome)) <= 120) AND (remetente_nome !~ '[\r\n]'::text)))`],
    ['documento_upload_intents_storage_path_check', String.raw`CHECK ((((length(storage_path) >= 1) AND (length(storage_path) <= 1024)) AND (storage_path !~ '(^|/)\.\.(/|$)'::text) AND (storage_path !~ '[\\]'::text)))`, String.raw`CHECK (((length(storage_path) >= 1) AND (length(storage_path) <= 1024) AND (storage_path !~ '(^|/)\.\.(/|$)'::text) AND (storage_path !~ '[\\]'::text)))`],
  ]
  report.equivalentParentheses = []
  for (const [name,before,after] of pairs) {
    if(source.constraints.find(c=>c.name===name)?.def===before && definitions.find(c=>c.name===name)?.def===after) {
      report.equivalentParentheses.push(name)
      delta=delta.filter(k=>!(k.startsWith('constraint:') && k.endsWith(`.${name}`)))
    }
  }
  report.catalogDifferences=delta
  assert.deepEqual(delta,[], 'SCHEMA_PARITY_FAILED')
  const tables=(await client.query("select schemaname,tablename from pg_tables where schemaname in ('public','private') order by 1,2")).rows
  for(const t of tables) assert.equal((await client.query(`select count(*)::int n from ${ident(t.schemaname)}.${ident(t.tablename)}`)).rows[0].n,0,'UNEXPECTED_APPLICATION_DATA')
  report.emptyTables=tables.length
  const state=await empty()
  assert.equal(state.users,0)
  assert.equal(state.objects,0)
  assert.equal(state.history,0,'HISTORY_MUST_NOT_BE_FAKED')
  report.state=state
  assert.deepEqual(sourceRead(),source,'SOURCE_METADATA_CHANGED')
}
try {
  await client.connect()
  await client.query("SET search_path=''; SET statement_timeout='120s'; SET lock_timeout='5s'")
  report.before=await empty()
  if(mode==='--precheck') {
    assert.deepEqual(report.before,{tables:0,users:0,objects:0,history:0},'TARGET_NOT_EMPTY')
    writeFileSync(checkpointFile,JSON.stringify({target:manifest.projectRef,sha256:hash(schema),source},null,2),{flag:'wx'})
  } else if(mode==='--apply') {
    const checkpoint=JSON.parse(readFileSync(checkpointFile,'utf8'))
    assert.equal(checkpoint.target,manifest.projectRef)
    assert.equal(checkpoint.sha256,hash(schema),'SCHEMA_HASH_CHANGED')
    assert.deepEqual(checkpoint.source,source,'SOURCE_CHANGED_SINCE_CHECKPOINT')
    assert.deepEqual(report.before,{tables:0,users:0,objects:0,history:0},'TARGET_NOT_EMPTY')
    await client.query('BEGIN')
    for(const kind of ['TABLES','SEQUENCES','FUNCTIONS']) await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${kind} FROM anon,authenticated,service_role`)
    const installed=new Set((await client.query('select extname from pg_extension')).rows.map(r=>r.extname))
    for(const e of source.extensions) if(!installed.has(e.name)) {
      assert(['unaccent','pgcrypto','uuid-ossp'].includes(e.name),'UNREVIEWED_EXTENSION')
      await client.query(`CREATE EXTENSION ${ident(e.name)} WITH SCHEMA ${ident(e.schema)}`)
    }
    await client.query(schema.replace('SET statement_timeout = 0;',"SET LOCAL statement_timeout='120s';").replace('SET lock_timeout = 0;',"SET LOCAL lock_timeout='5s';").replace('SET row_security = off;',''))
    for(const p of source.storage_policies || []) await client.query(`CREATE POLICY ${ident(p.policyname)} ON storage.${ident(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(r=>r==='public'?'PUBLIC':ident(r)).join(',')}${p.qual?` USING (${p.qual})`:''}${p.with_check?` WITH CHECK (${p.with_check})`:''}`)
    for(const t of source.auth_triggers || []) await client.query(t)
    for(const b of source.buckets || []) {
      assert.equal(b.public,false,'PUBLIC_BUCKET_REFUSED')
      await client.query('insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values($1,$2,$3,$4,$5)',[b.id,b.name,b.public,b.file_size_limit,b.allowed_mime_types])
    }
    await verify()
    await client.query('COMMIT')
    report.committed=true
  } else await verify()
  report.success=true
} catch(e) {
  await client.query('ROLLBACK').catch(()=>{})
  report.error={code:e.code || 'ASSERTION',message:String(e.message).split('\n')[0].slice(0,150)}
  process.exitCode=1
} finally {
  await client.end().catch(()=>{})
  writeFileSync(`rehearsal/reports/SACADO_PREVIEW_${mode.slice(2).toUpperCase()}.json`,JSON.stringify(report,null,2))
  console.log(JSON.stringify({success:report.success,mode,target:report.target,schemaSha256:report.schemaSha256,state:report.state,error:report.error?.code,catalogDifferences:report.catalogDifferences}))
}
