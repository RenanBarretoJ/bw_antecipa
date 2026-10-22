import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { manifest, previewDetails, assertPreviewDetails, repository } from '../vortx/preview-runtime.mjs'

assert(['', '--apply'].includes(process.argv.slice(2).join(' ')), 'PREFLIGHT_OR_APPLY_ONLY')
const apply = process.argv.includes('--apply')
const version = '20261022174904', name = 'financial_reconciliation_conditional_movements'
const path = `supabase/migrations/${version}_${name}.sql`
const sql = readFileSync(resolve(repository, path), 'utf8').replaceAll('\r\n', '\n')
const sha = value => createHash('sha256').update(value).digest('hex')
const baseline = JSON.parse(readFileSync(new URL('./__fixtures__/persistir-v1.json', import.meta.url), 'utf8'))
const proofPath = process.env.RECONCILIATION_SQL_REPORT
assert(proofPath, 'EXACT_TWO_STACK_SQL_REPORT_REQUIRED')
const proof = JSON.parse(readFileSync(proofPath, 'utf8'))
assert(proof.passed && proof.DOCKER_TEST_ENV_CLEANUP && proof.sha256 === sha(sql)
  && proof.stacks.length === 2 && proof.stacks.every(s => s.cleanup && s.tests.length >= 18), 'EXACT_TWO_STACK_SQL_PROOF_FAILED')
assert.equal(manifest.projectRef, 'phdckowbexkkvuwnzeaf', 'PREVIEW_ONLY')
const output = resolve(repository, 'rehearsal/reports', `reconciliation-v2-preview-${apply ? 'apply' : 'preflight'}-${Date.now()}.json`)
mkdirSync(resolve(repository, 'rehearsal/reports'), { recursive: true })
const report = { scope: 'PREVIEW_ONLY_RECONCILIATION_V2', project: manifest.projectRef,
  migration: { version, name, path, sha256: sha(sql) }, proofPath,
  applied: false, preserved: false, reconciliationExecuted: false, providerRequests: 0, error: null }
let db
try {
  const details = assertPreviewDetails(previewDetails())
  const caResponse = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt', { redirect: 'error', signal: AbortSignal.timeout(15000) })
  assert(caResponse.ok, 'TLS_CA_UNAVAILABLE')
  const ca = await caResponse.text(), cert = new X509Certificate(ca)
  assert(cert.ca && cert.verify(cert.publicKey) && Date.parse(cert.validTo) > Date.now())
  assert.equal(cert.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA')
  const connection = new URL(details.POSTGRES_URL)
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) connection.searchParams.delete(key)
  db = new pg.Client({ connectionString: connection.toString(), ssl: { ca, rejectUnauthorized: true, servername: connection.hostname }, connectionTimeoutMillis: 20000 })
  await db.connect()
  await db.query("set default_transaction_read_only=on;set statement_timeout='45s';set lock_timeout='3s'")
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=any($1)', [[manifest.originalA6Version, version]])).rows[0].n, 0)
  const current = (await db.query("select pg_get_functiondef(oid) definition,proacl::text acl,pg_get_userbyid(proowner) owner from pg_proc where oid='public.persistir_conciliacao_execucao(jsonb)'::regprocedure")).rows[0]
  assert.equal(current.definition, baseline.definition, 'V1_FUNCTION_CHANGED_SINCE_CERTIFICATION')
  assert.equal(current.acl, baseline.acl, 'PERSISTENCE_ACL_DRIFT')
  assert.equal(current.owner, baseline.owner, 'PERSISTENCE_OWNER_DRIFT')
  assert.equal((await db.query("select to_regprocedure('public.diagnosticar_variacao_estoques(uuid,uuid,uuid)') r")).rows[0].r, null)
  const snapshot = async () => {
    const rows = (await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','private') order by schemaname,tablename")).rows
    const data = {}
    const quote = value => '"' + value.replaceAll('"', '""') + '"'
    for (const { schemaname, tablename } of rows) {
      data[`${schemaname}.${tablename}`] = (await db.query(`select count(*)::int n,md5(coalesce(string_agg(h,'' order by h),'')) digest from (select md5(to_jsonb(t)::text) h from ${quote(schemaname)}.${quote(tablename)} t) rows`)).rows[0]
    }
    return {
      data,
      history: (await db.query('select version,md5(to_jsonb(m)::text) digest from supabase_migrations.schema_migrations m order by version')).rows,
      policies: (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,
      grants: (await db.query("select oid,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where relnamespace in ('public'::regnamespace,'private'::regnamespace,'auth'::regnamespace,'storage'::regnamespace) order by oid")).rows,
      functions: (await db.query("select oid,md5(pg_get_functiondef(oid)) definition,proacl::text from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace,'auth'::regnamespace) and prokind='f' and oid<>'public.persistir_conciliacao_execucao(jsonb)'::regprocedure and proname<>'diagnosticar_variacao_estoques' order by oid")).rows,
      persistenceAcl: (await db.query("select proacl::text,proowner,prosecdef,proconfig from pg_proc where oid='public.persistir_conciliacao_execucao(jsonb)'::regprocedure")).rows,
    }
  }
  const before = await snapshot()
  report.preservationSha256 = Object.fromEntries(Object.entries(before).map(([key, value]) => [key, sha(JSON.stringify(value))]))
  if (apply) {
    await db.query('begin isolation level repeatable read read write')
    try {
      await db.query('select pg_advisory_xact_lock(20261022,174904)')
      assert.deepEqual(await snapshot(), before, 'PRECONDITIONS_CHANGED')
      await db.query(sql)
      assert.deepEqual(await snapshot(), before, 'UNRELATED_DATA_POLICIES_ACLS_OR_FUNCTIONS_CHANGED')
      const diagnostic = (await db.query("select prosecdef,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated from pg_proc where oid='public.diagnosticar_variacao_estoques(uuid,uuid,uuid)'::regprocedure")).rows[0]
      assert.deepEqual(diagnostic, { prosecdef: false, anon: false, authenticated: true })
      await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)', [version, name, [sql]])
      await db.query("notify pgrst,'reload schema';commit")
      report.applied = true
    } catch (error) { await db.query('rollback'); throw error }
  }
  report.preserved = true
} catch (error) {
  report.error = { name: error.name, code: error.code ?? null, reason: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'PREVIEW_OPERATION_FAILED_NO_RAW_DETAILS' }
  process.exitCode = 1
} finally {
  if (db) await db.end()
  writeFileSync(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, applied: report.applied, preserved: report.preserved, error: report.error }))
}
