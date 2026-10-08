// One-off, schema-only repair of the explicitly authorized empty HEALTH Preview.
// Source is read-only. No customer data, credentials, old seed/reset or hotfix SQL.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const SOURCE = 'wwsndnuvnjuabpbjwlck'
const TARGET = 'mkfslrspxzplghjeixjq'
const BRANCH = 'b5227cca-3494-46f9-b3a7-2f0ddee7650d'
const sourceDir = resolve('../bw_antecipa_guibor_prod_02')
const cli = resolve('node_modules/supabase/dist/supabase.js')
const dumpFile = 'rehearsal/tmp/health-preview-schema-only.sql'
const reportFile = 'rehearsal/reports/HEALTH_PREVIEW_BASELINE_REPAIR.json'
const auditVersion = '20261002220000'
assert(process.argv.slice(2).every(a => ['--apply', '--verify'].includes(a)), 'UNSUPPORTED_ARGUMENT')
assert(!(process.argv.includes('--apply') && process.argv.includes('--verify')), 'CHOOSE_ONE_MODE')
assert.equal(readFileSync(resolve(sourceDir, 'supabase/.temp/project-ref'), 'utf8').trim(), SOURCE)
mkdirSync('rehearsal/tmp', { recursive: true })
mkdirSync('rehearsal/reports', { recursive: true })
const hash = value => createHash('sha256').update(value).digest('hex')
const ident = value => '"' + value.replaceAll('"', '""') + '"'
function run(args) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 30 * 1024 * 1024,
  })
  // CLI errors may contain connection strings: do not echo stdout/stderr.
  assert.equal(r.status, 0, 'CLI_COMMAND_FAILED_NO_SECRET_OUTPUT')
  return r.stdout
}
function sourceQuery(sql) {
  const file = resolve('rehearsal/tmp/health-source-readonly.sql')
  writeFileSync(file, `BEGIN READ ONLY; SET LOCAL search_path=''; ${sql}; COMMIT;`)
  return JSON.parse(run(['db', 'query', '--linked', '--workdir', sourceDir, '--file', file, '-o', 'json'])).rows
}
const catalogSql = readFileSync('scripts/qa/health/schema-catalog.sql', 'utf8')
const diagnosticsSql = `select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'acl',p.proacl::text,'owner',p.proowner::regrole::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('update_updated_at','usuario_possui_mfa_elevado')),
 'relations',(select jsonb_agg(jsonb_build_object('name',c.oid::regclass::text,'acl',c.relacl::text,'owner',c.relowner::regrole::text,'options',c.reloptions,'rls',c.relrowsecurity,'force',c.relforcerowsecurity)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relname in ('gestor_usuario_convite_fundos','notas_fiscais')),
 'defaults',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'role',d.defaclrole::regrole::text,'type',d.defaclobjtype::text,'acl',d.defaclacl::text)) from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname in ('public','private')),
 'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'def',pg_get_constraintdef(oid))) from pg_constraint where conname in ('comunicacoes_remetente_nome_check','documento_upload_intents_storage_path_check'))
 ) diagnostics`
const metadataSql = `select jsonb_build_object(
 'catalog',(${catalogSql}),
 'history',(select jsonb_agg(jsonb_build_object('version',version,'name',name,'hash',md5(coalesce(array_to_string(statements,E'\\n'),''))) order by version) from supabase_migrations.schema_migrations),
 'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname)) from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
 'storage_policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='storage'),
 'auth_triggers',(select jsonb_agg(pg_get_triggerdef(t.oid)) from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where t.tgrelid='auth.users'::regclass and not t.tgisinternal and n.nspname in ('public','private')),
 'buckets',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)) from storage.buckets)
 ) evidence`
const emptySql = `select jsonb_build_object('tables',(select count(*) from pg_tables where schemaname in ('public','private')),
 'users',(select count(*) from auth.users),'objects',(select count(*) from storage.objects),
 'history',(select count(*) from supabase_migrations.schema_migrations)) state`
const source = sourceQuery(metadataSql)[0].evidence
const schema = readFileSync(dumpFile, 'utf8')
assert(schema.length > 100000, 'EMPTY_OR_TRUNCATED_SCHEMA_DUMP')
assert(!/^COPY\s|^INSERT INTO\s|^SELECT pg_catalog.setval/m.test(schema), 'DATA_DUMP_REFUSED')
assert(!/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.|sk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(schema), 'POSSIBLE_SECRET_IN_SCHEMA_STOP')
const details = JSON.parse(run(['branches', 'get', BRANCH, '--project-ref', SOURCE, '-o', 'json']))
assert.equal(new URL(details.SUPABASE_URL).hostname, `${TARGET}.supabase.co`, 'WRONG_PREVIEW_STOP')
const url = new URL(details.POSTGRES_URL)
assert(url.hostname === `db.${TARGET}.supabase.co` || decodeURIComponent(url.username).endsWith(`.${TARGET}`), 'WRONG_DB_TARGET_STOP')
const client = new pg.Client({ connectionString: details.POSTGRES_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 })
let inTransaction = false
const report = { source: SOURCE, target: TARGET, at: new Date().toISOString(), mode: process.argv[2] || '--preflight', schemaSha256: hash(schema), sourceHistory: source.history, sourceCatalogHash: hash(JSON.stringify(source.catalog)), success: false }
async function targetCatalog() {
  await client.query("SET search_path=''")
  return (await client.query(catalogSql)).rows[0].objects
}
function compare(expected, actual) {
  const left = new Map(expected.map(o => [`${o.kind}:${o.name}`, o.hash]))
  const right = new Map(actual.map(o => [`${o.kind}:${o.name}`, o.hash]))
  return [...new Set([...left.keys(), ...right.keys()])].filter(k => left.get(k) !== right.get(k))
}
async function verifyCatalog() {
  const differences = compare(source.catalog, await targetCatalog())
  // Postgres flattens two nested AND groups while restoring the dump. Accept only
  // these exact definitions, not an arbitrary constraint-name exemption.
  const pairs = [
    ['comunicacoes_remetente_nome_check', String.raw`CHECK ((((char_length(btrim(remetente_nome)) >= 1) AND (char_length(btrim(remetente_nome)) <= 120)) AND (remetente_nome !~ '[\r\n]'::text)))`, String.raw`CHECK (((char_length(btrim(remetente_nome)) >= 1) AND (char_length(btrim(remetente_nome)) <= 120) AND (remetente_nome !~ '[\r\n]'::text)))`],
    ['documento_upload_intents_storage_path_check', String.raw`CHECK ((((length(storage_path) >= 1) AND (length(storage_path) <= 1024)) AND (storage_path !~ '(^|/)\.\.(/|$)'::text) AND (storage_path !~ '[\\]'::text)))`, String.raw`CHECK (((length(storage_path) >= 1) AND (length(storage_path) <= 1024) AND (storage_path !~ '(^|/)\.\.(/|$)'::text) AND (storage_path !~ '[\\]'::text)))`],
  ]
  const accepted = []
  if (differences.length) {
    report.sourceDiagnostics = sourceQuery(diagnosticsSql)[0].diagnostics
    report.targetDiagnostics = (await client.query(diagnosticsSql)).rows[0].diagnostics
    for (const [name, before, after] of pairs) {
      if (report.sourceDiagnostics.constraints.find(c => c.name === name)?.def === before && report.targetDiagnostics.constraints.find(c => c.name === name)?.def === after) {
        accepted.push(...differences.filter(k => k.startsWith('constraint:') && k.endsWith(`.${name}`)))
      }
    }
  }
  report.equivalentAndParentheses = accepted
  return differences.filter(k => !accepted.includes(k))
}
async function checkEmptyData() {
  const tables = (await client.query("select schemaname,tablename from pg_tables where schemaname in ('public','private') order by schemaname,tablename")).rows
  for (const t of tables) {
    const { rows } = await client.query(`select count(*)::int n from ${ident(t.schemaname)}.${ident(t.tablename)}`)
    assert.equal(rows[0].n, 0, 'UNEXPECTED_APPLICATION_DATA_STOP')
  }
  assert.equal((await client.query('select count(*)::int n from auth.users')).rows[0].n, 0)
  assert.equal((await client.query('select count(*)::int n from storage.objects')).rows[0].n, 0)
  return tables.length
}
try {
  await client.connect()
  report.before = (await client.query(emptySql)).rows[0].state
  if (process.argv.includes('--apply')) {
    assert.deepEqual(report.before, { tables: 0, users: 0, objects: 0, history: 0 }, 'TARGET_NOT_EMPTY_STOP')
    await client.query('BEGIN; SET LOCAL lock_timeout=\'5s\'; SET LOCAL statement_timeout=\'120s\'')
    inTransaction = true
    // Fresh Supabase defaults grant additional TRUNCATE/REFERENCES/TRIGGER/MAINTAIN
    // privileges not present in production. Clear these before creating objects.
    // The dump restores the exact production grants afterwards.
    for (const kind of ['TABLES','SEQUENCES','FUNCTIONS']) await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${kind} FROM anon,authenticated,service_role`)
    const installed = new Set((await client.query('select extname from pg_extension')).rows.map(r => r.extname))
    for (const e of source.extensions) if (!installed.has(e.name)) {
      assert(['unaccent', 'pgcrypto', 'uuid-ossp'].includes(e.name), 'UNREVIEWED_EXTENSION_STOP')
      await client.query(`CREATE EXTENSION ${ident(e.name)} WITH SCHEMA ${ident(e.schema)}`)
    }
    await client.query(schema.replace('SET statement_timeout = 0;', "SET LOCAL statement_timeout = '120s';").replace('SET lock_timeout = 0;', "SET LOCAL lock_timeout = '5s';").replace('SET row_security = off;', ''))
    for (const p of source.storage_policies || []) {
      const roles = p.roles.map(r => r === 'public' ? 'PUBLIC' : ident(r)).join(',')
      await client.query(`CREATE POLICY ${ident(p.policyname)} ON storage.${ident(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${roles}${p.qual ? ` USING (${p.qual})` : ''}${p.with_check ? ` WITH CHECK (${p.with_check})` : ''}`)
    }
    for (const trigger of source.auth_triggers || []) await client.query(trigger)
    for (const b of source.buckets || []) {
      assert.equal(b.public, false, 'PUBLIC_BUCKET_STOP')
      await client.query('insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values($1,$2,$3,$4,$5)', [b.id,b.name,b.public,b.file_size_limit,b.allowed_mime_types])
    }
    report.catalogDifferences = await verifyCatalog()
    assert.deepEqual(report.catalogDifferences, [], 'SCHEMA_PARITY_FAILED_ROLLBACK')
    report.emptyApplicationTables = await checkEmptyData()
    // Mark versions represented by the verified snapshot, NOT as SQL replayed.
    // Original migration bodies are deliberately not copied (may contain real data).
    for (const h of source.history) await client.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)', [h.version,h.name,[`-- Represented by HEALTH schema-only snapshot ${report.schemaSha256}; source history body MD5 ${h.hash}; no historical SQL replayed.`]])
    await client.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)', [auditVersion,'health_preview_schema_snapshot',[`-- Isolated Preview ${TARGET}; schema SHA256 ${report.schemaSha256}; source ${SOURCE}; ${source.history.length} versions represented; application/Auth/Storage object rows = 0.`]])
    assert.deepEqual(compare(source.catalog, sourceQuery(metadataSql)[0].evidence.catalog), [], 'SOURCE_SCHEMA_DRIFT_STOP')
    await client.query('COMMIT')
    inTransaction = false
    report.committed = true
  }
  if (process.argv.includes('--apply') || process.argv.includes('--verify')) {
    report.catalogDifferences = await verifyCatalog()
    assert.deepEqual(report.catalogDifferences, [], 'POSTFLIGHT_SCHEMA_PARITY_FAILED')
    report.emptyApplicationTables = await checkEmptyData()
    const history = (await client.query('select version,name from supabase_migrations.schema_migrations order by version')).rows
    assert.equal(history.length, source.history.length + 1)
    for (const h of source.history) assert(history.some(r => r.version === h.version && r.name === h.name), 'HISTORY_MISSING')
    assert(history.some(r => r.version === auditVersion && r.name === 'health_preview_schema_snapshot'))
    report.historyRows = history.length
  }
  report.success = true
} catch (error) {
  if (inTransaction) await client.query('ROLLBACK').catch(() => {})
  report.error = { code: error.code || 'ASSERTION', message: String(error.message).slice(0,250) }
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
  report.finishedAt = new Date().toISOString()
  writeFileSync(reportFile, JSON.stringify(report, null, 2))
  // Report details stay in ignored files; never print connection information.
  console.log(JSON.stringify({ target: TARGET, mode: report.mode, success: report.success, committed: !!report.committed, schemaObjects: source.catalog.length, differences: report.catalogDifferences?.length, emptyTables: report.emptyApplicationTables, errorCode: report.error?.code, report: reportFile }))
}
