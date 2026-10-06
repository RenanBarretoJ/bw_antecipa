// Authorized schema-only repair. Targets are pinned; production is READ ONLY.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const mode = process.argv[2]
assert(['--capture', '--local', '--preview', '--verify'].includes(mode) && process.argv.length === 3)
const sourceRef = 'wwsndnuvnjuabpbjwlck'
const previewRef = 'twmxvhddqbderjzgmcjo'
const branchId = '64676d52-3b99-433e-bd90-9d2e2a04f0cb'
const sourceDir = resolve('../bw_antecipa_guibor_prod_02')
const sha = value => createHash('sha256').update(value).digest('hex')
const ident = value => '"' + value.replaceAll('"', '""') + '"'
const schemaPath = resolve('rehearsal/tmp/notificacoes-reference-schema.sql')
const manifestPath = resolve('rehearsal/reports/NOTIFICACOES_REFERENCE_MANIFEST.json')
const metadataPath = resolve('rehearsal/tmp/notificacoes-reference-metadata.json')
const catalog = readFileSync('scripts/qa/health/schema-catalog.sql', 'utf8')
mkdirSync('rehearsal/tmp', { recursive: true })
mkdirSync('rehearsal/reports', { recursive: true })
if (mode !== '--local') assert.equal(readFileSync(resolve(sourceDir, 'supabase/.temp/project-ref'), 'utf8').trim(), sourceRef)
assert.equal(spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8', windowsHide: true }).stdout.trim(), 'feature/notificacoes-fund-scope')

function cli(args, json = true) {
  const result = spawnSync(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 40 * 1024 * 1024,
  })
  assert.equal(result.status, 0, 'CLI_FAILED_NO_SECRET_OUTPUT')
  return json ? JSON.parse(result.stdout) : null
}

const metadataQuery = `SELECT jsonb_build_object(
 'catalog',(${catalog}),
 'history',(SELECT jsonb_build_object('count',count(*),'hash',md5(string_agg(to_jsonb(m)::text,'' ORDER BY version))) FROM supabase_migrations.schema_migrations m),
 'a6',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20260929193129'),
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
 'storagePolicies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='storage'),
 'authTriggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal AND n.nspname IN ('public','private')),
 'buckets',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) ORDER BY id) FROM storage.buckets),
 'realtimeTables',(SELECT jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename) ORDER BY schemaname,tablename) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname IN ('public','private')),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'def',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conname IN ('comunicacoes_remetente_nome_check','documento_upload_intents_storage_path_check'))
) AS evidence`

function sourceMetadata() {
  const path = resolve('rehearsal/tmp/notificacoes-reference-readonly.sql')
  writeFileSync(path, `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=''; ${metadataQuery}; COMMIT;`)
  return cli(['db', 'query', '--linked', '--workdir', sourceDir, '--file', path, '-o', 'json']).rows[0].evidence
}

function validateSchema(schema) {
  assert(!/^COPY\s|^INSERT INTO\s|^SELECT pg_catalog.setval/m.test(schema), 'DATA_DUMP_REFUSED')
  assert(!/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.|sk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(schema), 'POSSIBLE_SECRET_STOP')
  assert(!/CREATE TABLE[^\n]*"supabase_migrations"|INSERT INTO[^\n]*schema_migrations/i.test(schema), 'HISTORY_DUMP_REFUSED')
}

if (mode === '--capture') {
  const before = sourceMetadata()
  assert.equal(before.a6, 0, 'ORIGINAL_A6_PRESENT')
  cli(['db', 'dump', '--linked', '--workdir', sourceDir, '--schema', 'public,private', '--file', schemaPath], false)
  const schema = readFileSync(schemaPath, 'utf8')
  validateSchema(schema)
  assert.deepEqual(sourceMetadata(), before, 'SOURCE_METADATA_CHANGED_DURING_CAPTURE')
  const metadata = JSON.stringify(before, null, 2) + '\n'
  const manifest = { capturedAt: new Date().toISOString(), sourceRef, targetRef: previewRef,
    schemaSha256: sha(schema), metadataSha256: sha(metadata), sourceHistory: before.history,
    sourceOriginalA6Applied: false, mode: 'SCHEMA_ONLY_NO_DATA_NO_HISTORY',
    explicitMigrationList: [], catalogObjects: before.catalog.length }
  writeFileSync(metadataPath, metadata)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(JSON.stringify(manifest))
  process.exit(0)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const approved = JSON.parse(readFileSync('scripts/qa/notificacoes/baseline-manifest.json', 'utf8'))
assert.equal(manifest.schemaSha256, approved.schemaSha256, 'UNREVIEWED_BASELINE_SCHEMA')
assert.equal(manifest.metadataSha256, approved.metadataSha256, 'UNREVIEWED_BASELINE_METADATA')
assert.equal(approved.previewRef, previewRef)
assert.deepEqual(approved.explicitMigrationList, [], 'UNREVIEWED_MIGRATION_LIST')
const schema = readFileSync(schemaPath, 'utf8')
const metadataText = readFileSync(metadataPath, 'utf8')
const source = JSON.parse(metadataText)
assert.equal(manifest.targetRef, previewRef)
assert.equal(manifest.sourceRef, sourceRef)
assert.equal(sha(schema), manifest.schemaSha256, 'SCHEMA_HASH_MISMATCH')
assert.equal(sha(metadataText), manifest.metadataSha256, 'METADATA_HASH_MISMATCH')
validateSchema(schema)
if (mode !== '--local') assert.deepEqual(sourceMetadata(), source, 'SOURCE_METADATA_DRIFT')

let config
if (mode === '--local') {
  const check = spawnSync('docker', ['inspect', 'supabase_db_notificacoes-r1-20261005', '--format', '{{index .Config.Labels "com.supabase.cli.project"}}'], { encoding: 'utf8', windowsHide: true })
  assert.equal(check.status, 0); assert.equal(check.stdout.trim(), 'notificacoes-r1-20261005')
  config = { host: '127.0.0.1', port: 59422, user: 'postgres', password: 'postgres', database: 'postgres' }
} else {
  const local = JSON.parse(readFileSync('rehearsal/reports/NOTIFICACOES_REPAIR_local.json', 'utf8'))
  assert(local.success && local.sqlPass, 'LOCAL_REHEARSAL_REQUIRED')
  assert.equal(local.schemaSha256, manifest.schemaSha256)
  const details = cli(['branches', 'get', branchId, '--project-ref', sourceRef, '-o', 'json'])
  assert.equal(new URL(details.SUPABASE_URL).hostname, `${previewRef}.supabase.co`)
  const dbUrl = new URL(details.POSTGRES_URL)
  assert(dbUrl.hostname === `db.${previewRef}.supabase.co` || decodeURIComponent(dbUrl.username).endsWith(`.${previewRef}`), 'WRONG_TARGET')
  config = { connectionString: details.POSTGRES_URL, ssl: { rejectUnauthorized: false } }
}
const db = new pg.Client({ ...config, connectionTimeoutMillis: 20000 })
const report = { at: new Date().toISOString(), mode, target: mode === '--local' ? '127.0.0.1:59422' : previewRef,
  schemaSha256: manifest.schemaSha256, sourceHistory: source.history, success: false }

async function emptyData() {
  const tables = (await db.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','private') ORDER BY 1,2")).rows
  for (const t of tables) assert.equal((await db.query(`SELECT count(*)::int n FROM ${ident(t.schemaname)}.${ident(t.tablename)}`)).rows[0].n, 0, 'APPLICATION_DATA_PRESENT')
  for (const table of ['auth.users', 'storage.objects', 'supabase_migrations.schema_migrations']) {
    const exists = (await db.query('SELECT to_regclass($1) r', [table])).rows[0].r
    if (!exists && mode === '--local' && table === 'supabase_migrations.schema_migrations') continue
    assert(exists, 'MANAGED_TABLE_MISSING')
    assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0, 'USER_DATA_OR_HISTORY_PRESENT')
  }
  report.emptyAppTables = tables.length
}

async function verifyCatalog() {
  await db.query("SET search_path=''")
  const actual = (await db.query(catalog)).rows[0].objects
  const left = new Map(source.catalog.map(o => [`${o.kind}:${o.name}`, o.hash]))
  const right = new Map(actual.map(o => [`${o.kind}:${o.name}`, o.hash]))
  let differences = [...new Set([...left.keys(), ...right.keys()])].filter(k => left.get(k) !== right.get(k)).sort()
  // These two parser normalization differences are pre-existing PG17.x behavior,
  // not a license to ignore arbitrary constraint drift.
  const known = [
    ['comunicacoes_remetente_nome_check', String.raw`CHECK ((((char_length(btrim(remetente_nome)) >= 1) AND (char_length(btrim(remetente_nome)) <= 120)) AND (remetente_nome !~ '[\r\n]'::text)))`, String.raw`CHECK (((char_length(btrim(remetente_nome)) >= 1) AND (char_length(btrim(remetente_nome)) <= 120) AND (remetente_nome !~ '[\r\n]'::text)))`],
    ['documento_upload_intents_storage_path_check', String.raw`CHECK ((((length(storage_path) >= 1) AND (length(storage_path) <= 1024)) AND (storage_path !~ '(^|/)\.\.(/|$)'::text) AND (storage_path !~ '[\\]'::text)))`, String.raw`CHECK (((length(storage_path) >= 1) AND (length(storage_path) <= 1024) AND (storage_path !~ '(^|/)\.\.(/|$)'::text) AND (storage_path !~ '[\\]'::text)))`],
  ]
  report.constraintNormalizations = []
  for (const [name, before, after] of known) {
    const current = (await db.query('SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname=$1', [name])).rows[0]?.def
    if (source.constraints.find(c => c.name === name)?.def === before && current === after) {
      differences = differences.filter(k => !(k.startsWith('constraint:') && k.endsWith(`.${name}`)))
      report.constraintNormalizations.push(name)
    }
  }
  report.catalogDifferences = differences
  report.catalogObjects = actual.length
  assert.deepEqual(differences, [], 'CATALOG_PARITY_FAILED')
}

try {
  await db.connect()
  await db.query("SET statement_timeout='120s'; SET lock_timeout='5s'")
  const count = (await db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname IN ('public','private')")).rows[0].n
  if (mode === '--verify') assert(count > 0, 'PREVIEW_NOT_RESTORED')
  await emptyData()
  if (count === 0) {
    await db.query('BEGIN')
    for (const kind of ['TABLES', 'SEQUENCES', 'FUNCTIONS']) await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${kind} FROM anon,authenticated,service_role`)
    const installed = new Set((await db.query('SELECT extname FROM pg_extension')).rows.map(r => r.extname))
    for (const e of source.extensions) if (!installed.has(e.name)) {
      assert(['unaccent','pgcrypto','uuid-ossp'].includes(e.name), 'UNREVIEWED_EXTENSION')
      await db.query(`CREATE EXTENSION ${ident(e.name)} WITH SCHEMA ${ident(e.schema)}`)
    }
    await db.query(schema.replace('SET statement_timeout = 0;', "SET LOCAL statement_timeout='120s';").replace('SET lock_timeout = 0;', "SET LOCAL lock_timeout='5s';").replace('SET row_security = off;', ''))
    for (const p of source.storagePolicies || []) await db.query(`CREATE POLICY ${ident(p.policyname)} ON storage.${ident(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(r => r === 'public' ? 'PUBLIC' : ident(r)).join(',')}${p.qual ? ` USING (${p.qual})` : ''}${p.with_check ? ` WITH CHECK (${p.with_check})` : ''}`)
    for (const t of source.authTriggers || []) await db.query(t)
    for (const b of source.buckets || []) {
      assert.equal(b.public, false, 'PUBLIC_BUCKET_REFUSED')
      await db.query('INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES($1,$2,$3,$4,$5)', [b.id,b.name,b.public,b.file_size_limit,b.allowed_mime_types])
    }
    for (const t of source.realtimeTables || []) {
      const already = (await db.query("SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname=$1 AND tablename=$2", [t.schema,t.table])).rowCount
      if (!already) await db.query(`ALTER PUBLICATION supabase_realtime ADD TABLE ${ident(t.schema)}.${ident(t.table)}`)
    }
    await verifyCatalog(); await emptyData()
    await db.query("NOTIFY pgrst, 'reload schema'")
    await db.query('COMMIT')
  } else await verifyCatalog()
  if (mode === '--local') {
    await db.query('BEGIN')
    await db.query(readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql', 'utf8'))
    await db.query(readFileSync('supabase/tests/nfse_submit_frozen.assert.sql', 'utf8'))
    await db.query('ROLLBACK')
    await verifyCatalog(); await emptyData()
    report.sqlPass = true
  }
  const realtime = (await db.query("SELECT jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename) ORDER BY schemaname,tablename) v FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname IN ('public','private')")).rows[0].v
  assert.deepEqual(realtime, source.realtimeTables, 'REALTIME_PUBLICATION_DRIFT')
  if (mode !== '--local') assert.deepEqual(sourceMetadata(), source, 'SOURCE_METADATA_CHANGED')
  report.sourceMetadataUnchanged = mode === '--local' ? 'NOT_QUERIED_LOCAL_ONLY' : true
  report.originalA6Executed = false
  report.historyFaked = false
  report.explicitMigrationList = []
  report.success = true
} catch (error) {
  await db.query('ROLLBACK').catch(() => {})
  report.error = { code: error.code || 'ASSERTION', message: String(error.message).split('\n')[0].slice(0, 100) }
  process.exitCode = 1
} finally {
  await db.end().catch(() => {})
  writeFileSync(`rehearsal/reports/NOTIFICACOES_REPAIR_${mode.slice(2)}.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
}
