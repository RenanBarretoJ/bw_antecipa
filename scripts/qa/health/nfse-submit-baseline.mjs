// Authorized, empty-target schema bootstrap. Never replay or copy migration history.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const mode = process.argv[2]
assert(['--local', '--preview'].includes(mode) && process.argv.length === 3)
const sourceRef = 'wwsndnuvnjuabpbjwlck', previewRef = 'ettpaprrmpjsfkcystob'
const branchId = '8d126d13-396d-47f0-bfc4-12d8a3eba8e6'
const schema = readFileSync('rehearsal/tmp/nfse-submit-production-schema.sql', 'utf8')
const hash = value => createHash('sha256').update(value).digest('hex')
assert.equal(hash(schema), 'bed3965b0470c2f348aae263dcc3f7b1e60d43254426b030d0319ab148709eeb')
assert(!/^COPY\s|^INSERT INTO\s|^SELECT pg_catalog.setval/m.test(schema), 'DATA_DUMP_REFUSED')
assert(!/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.|sk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(schema), 'POSSIBLE_SECRET_STOP')
const sourceDir = resolve('../bw_antecipa_guibor_prod_02')
assert.equal(readFileSync(resolve(sourceDir, 'supabase/.temp/project-ref'), 'utf8').trim(), sourceRef)
const catalog = readFileSync('scripts/qa/health/schema-catalog.sql', 'utf8')
function cli(args) {
  const r = spawnSync(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), ...args], { encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 30 * 1024 * 1024 })
  assert.equal(r.status, 0, 'CLI_FAILED_NO_SECRET_OUTPUT')
  return JSON.parse(r.stdout)
}
const metadata = `select jsonb_build_object('catalog',(${catalog}),
 'history',(select jsonb_build_object('count',count(*),'hash',md5(string_agg(to_jsonb(m)::text,'' order by version))) from supabase_migrations.schema_migrations m),
 'a6',(select count(*) from supabase_migrations.schema_migrations where version='20260929193129'),
 'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname)) from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
 'storage_policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='storage'),
 'auth_triggers',(select jsonb_agg(pg_get_triggerdef(t.oid)) from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where t.tgrelid='auth.users'::regclass and not t.tgisinternal and n.nspname in ('public','private')),
 'buckets',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)) from storage.buckets),
 'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'def',pg_get_constraintdef(oid))) from pg_constraint where conname in ('comunicacoes_remetente_nome_check','documento_upload_intents_storage_path_check'))) evidence`
function sourceRead() {
  const path = resolve('rehearsal/tmp/nfse-submit-source-readonly.sql')
  writeFileSync(path, `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=''; ${metadata}; COMMIT;`)
  return cli(['db', 'query', '--linked', '--workdir', sourceDir, '--file', path, '-o', 'json']).rows[0].evidence
}
const source = sourceRead()
assert.equal(source.a6, 0, 'ORIGINAL_A6_PRESENT')
let connection
if (mode === '--local') {
  const inspect = spawnSync('docker', ['inspect', 'supabase_db_nfse-submit-20261005', '--format', '{{index .Config.Labels "com.supabase.cli.project"}}'], { encoding: 'utf8', windowsHide: true })
  assert.equal(inspect.status, 0); assert.equal(inspect.stdout.trim(), 'nfse-submit-20261005')
  connection = { host: '127.0.0.1', port: 59322, user: 'postgres', password: 'postgres', database: 'postgres', ssl: false }
} else {
  const local = JSON.parse(readFileSync('rehearsal/reports/NFSE_SUBMIT_BASELINE_local.json', 'utf8'))
  assert(local.success && local.sqlPass, 'LOCAL_SQL_GATE_REQUIRED')
  assert.equal(local.schemaSha256, hash(schema))
  const details = cli(['branches', 'get', branchId, '--project-ref', sourceRef, '-o', 'json'])
  assert.equal(new URL(details.SUPABASE_URL).hostname, `${previewRef}.supabase.co`)
  const dbUrl = new URL(details.POSTGRES_URL)
  assert(dbUrl.hostname === `db.${previewRef}.supabase.co` || decodeURIComponent(dbUrl.username).endsWith(`.${previewRef}`), 'WRONG_TARGET')
  connection = { connectionString: details.POSTGRES_URL, ssl: { rejectUnauthorized: false } }
}
const db = new pg.Client({ ...connection, connectionTimeoutMillis: 20000 })
const report = { at: new Date().toISOString(), mode, target: mode === '--local' ? '127.0.0.1:59322' : previewRef, schemaSha256: hash(schema), sourceHistory: source.history, success: false }
const ident = s => '"' + s.replaceAll('"', '""') + '"'
function diff(a, b) {
  const left = new Map(a.map(o => [`${o.kind}:${o.name}`, o.hash])), right = new Map(b.map(o => [`${o.kind}:${o.name}`, o.hash]))
  return [...new Set([...left.keys(), ...right.keys()])].filter(k => left.get(k) !== right.get(k)).sort()
}
async function verifyCatalog() {
  await db.query("set search_path=''")
  let delta = diff(source.catalog, (await db.query(catalog)).rows[0].objects)
  const pairs = [
    ['comunicacoes_remetente_nome_check', String.raw`CHECK ((((char_length(btrim(remetente_nome)) >= 1) AND (char_length(btrim(remetente_nome)) <= 120)) AND (remetente_nome !~ '[\r\n]'::text)))`, String.raw`CHECK (((char_length(btrim(remetente_nome)) >= 1) AND (char_length(btrim(remetente_nome)) <= 120) AND (remetente_nome !~ '[\r\n]'::text)))`],
    ['documento_upload_intents_storage_path_check', String.raw`CHECK ((((length(storage_path) >= 1) AND (length(storage_path) <= 1024)) AND (storage_path !~ '(^|/)\.\.(/|$)'::text) AND (storage_path !~ '[\\]'::text)))`, String.raw`CHECK (((length(storage_path) >= 1) AND (length(storage_path) <= 1024) AND (storage_path !~ '(^|/)\.\.(/|$)'::text) AND (storage_path !~ '[\\]'::text)))`],
  ]
  for (const [name, before, after] of pairs) {
    const actual = (await db.query('select pg_get_constraintdef(oid) def from pg_constraint where conname=$1', [name])).rows[0]?.def
    if (source.constraints.find(c => c.name === name)?.def === before && actual === after) delta = delta.filter(k => !(k.startsWith('constraint:') && k.endsWith(`.${name}`)))
  }
  report.catalogDifferences = delta
  assert.deepEqual(delta, [], 'SCHEMA_PARITY_FAILED')
}
async function emptyRows() {
  const tables = (await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','private')")).rows
  for (const t of tables) assert.equal((await db.query(`select count(*)::int n from ${ident(t.schemaname)}.${ident(t.tablename)}`)).rows[0].n, 0, 'APPLICATION_DATA_PRESENT')
  for (const table of ['auth.users', 'storage.objects', 'supabase_migrations.schema_migrations']) {
    const exists = (await db.query('select to_regclass($1) relation', [table])).rows[0].relation
    if (!exists && mode === '--local' && table === 'supabase_migrations.schema_migrations') continue
    assert(exists, 'EXPECTED_MANAGED_TABLE_MISSING')
    assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n, 0, 'DATA_OR_HISTORY_PRESENT')
  }
  report.emptyTables = tables.length
}
try {
  await db.connect()
  await db.query("SET statement_timeout='120s'; SET lock_timeout='5s'")
  const count = (await db.query("select count(*)::int n from pg_tables where schemaname in ('public','private')")).rows[0].n
  if (count === 0) {
    await emptyRows()
    await db.query('BEGIN')
    for (const kind of ['TABLES', 'SEQUENCES', 'FUNCTIONS']) await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${kind} FROM anon,authenticated,service_role`)
    const installed = new Set((await db.query('select extname from pg_extension')).rows.map(r => r.extname))
    for (const e of source.extensions) if (!installed.has(e.name)) {
      assert(['unaccent', 'pgcrypto', 'uuid-ossp'].includes(e.name), 'UNREVIEWED_EXTENSION')
      await db.query(`CREATE EXTENSION ${ident(e.name)} WITH SCHEMA ${ident(e.schema)}`)
    }
    await db.query(schema.replace('SET statement_timeout = 0;', "SET LOCAL statement_timeout='120s';").replace('SET lock_timeout = 0;', "SET LOCAL lock_timeout='5s';").replace('SET row_security = off;', ''))
    for (const p of source.storage_policies || []) await db.query(`CREATE POLICY ${ident(p.policyname)} ON storage.${ident(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(r => r === 'public' ? 'PUBLIC' : ident(r)).join(',')}${p.qual ? ` USING (${p.qual})` : ''}${p.with_check ? ` WITH CHECK (${p.with_check})` : ''}`)
    for (const t of source.auth_triggers || []) await db.query(t)
    for (const b of source.buckets || []) {
      assert.equal(b.public, false)
      await db.query('insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values($1,$2,$3,$4,$5)', [b.id, b.name, b.public, b.file_size_limit, b.allowed_mime_types])
    }
    await verifyCatalog(); await emptyRows()
    await db.query('COMMIT')
  } else { await verifyCatalog(); await emptyRows() }
  if (mode === '--local') {
    await db.query('BEGIN')
    await db.query(readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql', 'utf8'))
    await db.query(readFileSync('supabase/tests/nfse_submit_frozen.assert.sql', 'utf8'))
    await db.query('ROLLBACK')
    await verifyCatalog(); await emptyRows()
    report.sqlPass = true
  }
  assert.deepEqual(sourceRead(), source, 'SOURCE_METADATA_CHANGED')
  report.historyFaked = false; report.originalA6Applied = false; report.success = true
} catch (e) {
  await db.query('ROLLBACK').catch(() => {})
  report.error = { code: e.code || 'ASSERTION', message: String(e.message).split('\n')[0].slice(0, 150) }
  process.exitCode = 1
} finally {
  await db.end().catch(() => {})
  writeFileSync(`rehearsal/reports/NFSE_SUBMIT_BASELINE_${mode.slice(2)}.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
