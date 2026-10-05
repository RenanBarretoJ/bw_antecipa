// Local-only HEALTH migration rehearsal. Remote access is schema metadata READ ONLY.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { loadHealthMigration } from './migration-manifest.mjs'

assert.equal(process.argv.length, 2, 'NO_ARGUMENTS_ALLOWED')
const project = 'health-import-prod-20261005'
const linked = resolve('../bw_antecipa_guibor_prod_02')
assert.equal(readFileSync(resolve(linked, 'supabase/.temp/project-ref'), 'utf8').trim(), 'wwsndnuvnjuabpbjwlck')
const cli = resolve('node_modules/supabase/dist/supabase.js')
const { file, source: migration } = loadHealthMigration()
const body = migration.replace(/^begin;\s*$/mi, '').replace(/^commit;\s*$/mi, '')
const hash = s => createHash('sha256').update(s).digest('hex')
const catalog = readFileSync('scripts/qa/health/schema-catalog.sql', 'utf8')
const ident = s => '"' + s.replaceAll('"', '""') + '"'
const report = { at: new Date().toISOString(), project, migration: file, migrationSha256: hash(migration), success: false, checks: {} }
function remote(sql) {
  const r = spawnSync(process.execPath, [cli, 'db', 'query', '--linked', '--workdir', linked,
    `BEGIN READ ONLY; SET LOCAL search_path=''; ${sql}; COMMIT;`, '-o', 'json'],
  { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 20 * 1024 * 1024 })
  assert.equal(r.status, 0, 'REMOTE_READONLY_QUERY_FAILED')
  return JSON.parse(r.stdout).rows
}
const metadataSql = `select jsonb_build_object('catalog',(${catalog}),
 'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname)) from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
 'storage_policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='storage'),
 'auth_triggers',(select jsonb_agg(pg_get_triggerdef(t.oid)) from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where t.tgrelid='auth.users'::regclass and not t.tgisinternal and n.nspname in ('public','private')),
 'buckets',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)) from storage.buckets)) evidence`
const source = remote(metadataSql)[0].evidence
const schema = readFileSync('rehearsal/tmp/health-preview-schema-only.sql', 'utf8')
assert(schema.length > 100000 && !/^COPY\s|^INSERT INTO\s|^SELECT pg_catalog.setval/m.test(schema), 'SCHEMA_ONLY_REQUIRED')
const inspect = spawnSync('docker', ['inspect', `supabase_db_${project}`, '--format', '{{index .Config.Labels "com.supabase.cli.project"}}'], { encoding: 'utf8', windowsHide: true })
assert.equal(inspect.status, 0, 'LOCAL_CONTAINER_MISSING')
assert.equal(inspect.stdout.trim(), project, 'WRONG_CONTAINER')
const client = new pg.Client({ host: '127.0.0.1', port: 56322, user: 'postgres', password: 'postgres', database: 'postgres', ssl: false })
const diff = (a,b) => {
  const left = new Map(a.map(o => [`${o.kind}:${o.name}`,o.hash])); const right = new Map(b.map(o => [`${o.kind}:${o.name}`,o.hash]))
  return [...new Set([...left.keys(),...right.keys()])].filter(k => left.get(k)!==right.get(k)).sort()
}
async function getCatalog() { await client.query("set search_path=''"); return (await client.query(catalog)).rows[0].objects }
function tapResults(results) {
  const lines = (Array.isArray(results)?results:[results]).flatMap(r => r.rows || []).flatMap(r => Object.values(r)).filter(v => typeof v === 'string' && /^(ok |not ok |1\.\.|#)/.test(v))
  assert(lines.some(l=>l.startsWith('1..')), 'MISSING_TAP_PLAN')
  assert(!lines.some(l=>/^not ok |# Looks like/.test(l)), 'SQL_ASSERTION_FAILED')
  return lines
}
try {
  await client.connect()
  assert.equal((await client.query("select count(*)::int n from pg_tables where schemaname in ('public','private')")).rows[0].n, 0, 'EMPTY_LOCAL_SCHEMA_REQUIRED')
  await client.query('BEGIN')
  for(const kind of ['TABLES','SEQUENCES','FUNCTIONS']) await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${kind} FROM anon,authenticated,service_role`)
  const installed = new Set((await client.query('select extname from pg_extension')).rows.map(r=>r.extname))
  for(const e of source.extensions) if(!installed.has(e.name)) {
    assert(['unaccent','pgcrypto','uuid-ossp'].includes(e.name), 'UNREVIEWED_EXTENSION')
    await client.query(`CREATE EXTENSION ${ident(e.name)} WITH SCHEMA ${ident(e.schema)}`)
  }
  await client.query(schema.replace('SET row_security = off;', ''))
  for(const p of source.storage_policies || []) await client.query(`CREATE POLICY ${ident(p.policyname)} ON storage.${ident(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(r=>r==='public'?'PUBLIC':ident(r)).join(',')}${p.qual?` USING (${p.qual})`:''}${p.with_check?` WITH CHECK (${p.with_check})`:''}`)
  for(const t of source.auth_triggers || []) await client.query(t)
  for(const b of source.buckets || []) {
    assert.equal(b.public,false)
    await client.query('insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values($1,$2,$3,$4,$5)',[b.id,b.name,b.public,b.file_size_limit,b.allowed_mime_types])
  }
  const restored = await getCatalog()
  report.catalogDifferences = diff(source.catalog,restored)
  // Compare the normalized constraint expressions too; tolerate only parser-added parentheses.
  const allowed = ['comunicacoes_remetente_nome_check','documento_upload_intents_storage_path_check']
  for(const name of allowed) {
    const differences = report.catalogDifferences.filter(k=>k.startsWith('constraint:') && k.endsWith(`.${name}`))
    if(!differences.length) continue
    const original = remote(`select pg_get_constraintdef(oid) def from pg_constraint where conname='${name}'`)[0]?.def
    const local = (await client.query('select pg_get_constraintdef(oid) def from pg_constraint where conname=$1',[name])).rows[0]?.def
    assert(original && local && original.replace(/[()]/g,'') === local.replace(/[()]/g,''), 'CONSTRAINT_DRIFT')
    report.catalogDifferences = report.catalogDifferences.filter(k=>!differences.includes(k))
  }
  assert.deepEqual(report.catalogDifferences, [], 'SCHEMA_DRIFT')
  await client.query('COMMIT')
  report.checks.productionSchemaRestored = true
  const before = await getCatalog()
  for (const mode of ['cleanRoom','upgrade']) {
    await client.query("BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s'; CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions; SET LOCAL search_path=public,extensions;")
    if(mode === 'cleanRoom') await client.query(body)
    await client.query(readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql','utf8'))
    const previous = (await client.query("select md5(string_agg(to_jsonb(n)::text,'' order by id)) hash from public.notas_fiscais n")).rows[0].hash
    if(mode === 'upgrade') await client.query(body)
    assert.equal((await client.query("select md5(string_agg(to_jsonb(n)::text,'' order by id)) hash from public.notas_fiscais n")).rows[0].hash,previous,'LEGACY_ROWS_CHANGED')
    report[mode] = tapResults(await client.query(readFileSync('supabase/tests/health_nfse_municipal.assert.sql','utf8')))
    await client.query(readFileSync('supabase/tests/guibor_nfse_review_intents.assert.sql','utf8'))
    assert.deepEqual(diff(before,await getCatalog()),['constraint:public.notas_fiscais.nfse_fatos_check','index:public.nfse_municipal_identity_unique'])
    await client.query('ROLLBACK')
    assert.deepEqual(await getCatalog(),before,'ROLLBACK_SCHEMA_DRIFT')
    const counts=(await client.query('select (select count(*) from auth.users)+(select count(*) from public.notas_fiscais)+(select count(*) from public.operacoes)+(select count(*) from storage.objects) n')).rows[0].n
    assert.equal(Number(counts),0,'FIXTURE_ORPHANS')
    report.checks[mode]=true
  }
  assert.deepEqual(diff(source.catalog,remote(metadataSql)[0].evidence.catalog),[],'REMOTE_SCHEMA_CHANGED')
  report.success=true
} catch(e) {
  await client.query('ROLLBACK').catch(()=>{})
  report.error={code:e.code || 'ASSERTION',message:String(e.message).slice(0,180)}
  process.exitCode=1
} finally {
  await client.end().catch(()=>{})
  writeFileSync('rehearsal/reports/HEALTH_PROD_LOCAL_REHEARSAL.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify({success:report.success,checks:report.checks,error:report.error,catalogDifferences:report.catalogDifferences}))
}
