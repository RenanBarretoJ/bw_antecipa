import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { manifest, previewDetails, assertPreviewDetails, repository } from './preview-runtime.mjs'

// One exact, rehearsed migration on the existing isolated Preview. No provider calls,
// financial processing, capability publication, history repair or production target.
assert(process.argv.slice(2).every(arg => arg === '--apply'), 'UNKNOWN_ARGUMENT')
const apply = process.argv.includes('--apply')
const baselineManifest = JSON.parse(readFileSync(resolve(repository, 'scripts/qa/vortx/main-integration-manifest.json'), 'utf8'))
const version = '20261022121028', name = 'vortx_carteira_atomic_persistence'
const path = `supabase/migrations/${version}_${name}.sql`
const hash = value => createHash('sha256').update(value).digest('hex')
const sql = readFileSync(resolve(repository, path), 'utf8').replaceAll('\r\n', '\n')
assert.equal(hash(sql), 'f501bf4a4c5c5af52cf885e5ca6e1fe5c7fc5d3279065789d6b472eec1913665')
for (const id of ['bw-main-native-1792675634053', 'bw-main-native-1792675850039']) {
  const proof = JSON.parse(readFileSync(resolve(repository, `rehearsal/reports/${id}/report.json`), 'utf8'))
  const wallet = JSON.parse(readFileSync(resolve(repository, `rehearsal/reports/${id}/carteira.json`), 'utf8'))
  assert.equal(proof.result, 'PASS'); assert.equal(proof.DOCKER_TEST_ENV_CLEANUP, 'PASS')
  assert.equal(wallet.result, 'PASS'); assert.equal(wallet.migration.sha256, hash(sql))
  assert(wallet.checks.length >= 25 && wallet.checks.every(c => c.result === 'PASS'))
  if (id === 'bw-main-native-1792675850039') for (const input of proof.sourceInputs) {
    assert.equal(hash(readFileSync(resolve(repository, input.path))), input.sha256, `SOURCE_PROOF_DRIFT:${input.path}`)
  }
}
const output = resolve(repository, 'rehearsal/reports', `vortx-carteira-preview-${apply ? 'apply' : 'preflight'}-${Date.now()}.json`)
mkdirSync(resolve(repository, 'rehearsal/reports'), { recursive: true })
const report = { scope: 'PREVIEW_ONLY_SINGLE_WALLET_MIGRATION', project: manifest.projectRef,
  apply, migration: { version, name, path, sha256: hash(sql) }, applied: false,
  preservation: false, stage: 'TARGET', result: 'IN_PROGRESS', error: null }
let db
try {
  assert.equal(manifest.projectRef, 'phdckowbexkkvuwnzeaf')
  const details = assertPreviewDetails(previewDetails())
  report.stage = 'VERIFIED_TLS'
  const response = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt', { redirect: 'error', signal: AbortSignal.timeout(15000) })
  assert(response.ok)
  const ca = await response.text(), cert = new X509Certificate(ca)
  assert(cert.ca && cert.verify(cert.publicKey) && Date.parse(cert.validTo) > Date.now())
  assert.equal(cert.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA')
  const connection = new URL(details.POSTGRES_URL)
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) connection.searchParams.delete(key)
  db = new pg.Client({ connectionString: connection.toString(), ssl: { ca, rejectUnauthorized: true, servername: connection.hostname }, connectionTimeoutMillis: 20000 })
  await db.connect()
  await db.query("set default_transaction_read_only=on;set statement_timeout='45s';set lock_timeout='3s'")
  report.stage = 'PRECONDITIONS'
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=any($1)', [[manifest.originalA6Version, version]])).rows[0].n, 0)
  assert.equal((await db.query("select to_regclass('public.vortx_carteira_cotas') is null and to_regclass('private.vortx_carteira_execucoes') is null ok")).rows[0].ok, true)
  assert.equal((await db.query("select count(*)::int n from storage.buckets where id='vortx-carteiras'")).rows[0].n, 0)
  const baseline = await db.query('select version, name, statements from supabase_migrations.schema_migrations where version=any($1)', [manifestVersions()])
  assert.equal(baseline.rows.length, baselineManifest.importedMigrations.length)
  for (const migration of baselineManifest.importedMigrations) {
    const ver = migration.path.split('/').at(-1).split('_')[0]
    const current = baseline.rows.find(row => row.version === ver)
    assert(current, 'BASELINE_MIGRATION_MISSING')
    assert.equal(hash(current.statements.join('\n').replaceAll('\r\n', '\n').trim()), hash(readFileSync(resolve(repository, migration.path), 'utf8').replaceAll('\r\n', '\n').trim()), 'BASELINE_MIGRATION_DRIFT')
  }
  const tables = ['public.fundos', 'public.profiles', 'public.usuario_fundos', 'public.integracoes_fundo',
    'public.integracao_fundo_versoes', 'public.integracao_fundo_versao_capacidades', 'public.integracoes_vortx_vrs_credenciais',
    'public.vortx_relatorio_solicitacoes', 'public.vortx_relatorio_eventos', 'public.importacoes_financeiras',
    'public.importacao_arquivos', 'public.importacao_linhas', 'public.carteira_snapshots',
    'public.estoque_posicoes', 'public.vortx_posicao_ativos', 'public.vortx_posicao_parcelas', 'storage.objects']
  const business = async () => {
    const rows = {}
    for (const table of tables) rows[table] = (await db.query(`select count(*)::int n,md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) digest from ${table} t`)).rows[0]
    return rows
  }
  const history = async () => (await db.query('select version,name,md5(statements::text) digest from supabase_migrations.schema_migrations where version<>$1 order by version', [version])).rows
  const functions = async () => (await db.query("select oid,proname,proowner,proacl::text,prosecdef,proconfig,case when oid='private.integracao_adapter_capability_suportada(text,text)'::regprocedure then null else prosrc end body from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace,'auth'::regnamespace,'storage'::regnamespace) order by oid")).rows
  const policies = async () => (await db.query("select oid,to_jsonb(p) definition from pg_policy p order by oid")).rows
  const permissions = async () => (await db.query("select oid,relowner,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where relnamespace in ('public'::regnamespace,'private'::regnamespace,'auth'::regnamespace,'storage'::regnamespace) and relkind in ('r','p','v') order by oid")).rows
  const constraints = async () => (await db.query("select oid,pg_get_constraintdef(oid) definition from pg_constraint where connamespace in ('public'::regnamespace,'private'::regnamespace,'auth'::regnamespace,'storage'::regnamespace) and not (conrelid='public.importacoes_financeiras'::regclass and conname='importacoes_vortx_escopo_check') order by oid")).rows
  report.stage = 'PRESERVATION_BASELINE'
  const before = { business: await business(), history: await history(), functions: await functions(), policies: await policies(), permissions: await permissions(), constraints: await constraints() }
  report.before = Object.fromEntries(Object.entries(before).map(([key, value]) => [key, hash(JSON.stringify(value))]))
  const preserve = async () => {
    assert.deepEqual(await business(), before.business, 'EXISTING_BUSINESS_ROWS_CHANGED')
    assert.deepEqual(await history(), before.history, 'HISTORICAL_MIGRATION_HISTORY_CHANGED')
    for (const [key, get] of [['functions', functions], ['policies', policies], ['permissions', permissions], ['constraints', constraints]]) {
      const existing = new Set(before[key].map(row => row.oid))
      assert.deepEqual((await get()).filter(row => existing.has(row.oid)), before[key], `PREEXISTING_${key.toUpperCase()}_CHANGED`)
    }
  }
  if (apply) {
    report.stage = 'TRANSACTION'
    await db.query('set default_transaction_read_only=off;begin read write')
    try {
      await db.query('select pg_advisory_xact_lock(20261022,121028)')
      assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1', [version])).rows[0].n, 0)
      await preserve()
      const body = sql.replace(/^BEGIN;\s*\n/m, '').replace(/\bCOMMIT;\s*$/, '')
      assert.notEqual(body, sql); assert(!/^BEGIN;|\bCOMMIT;\s*$/m.test(body))
      await db.query(body)
      await db.query('insert into supabase_migrations.schema_migrations(version,name,statements)values($1,$2,$3)', [version, name, [sql]])
      await preserve()
      const bucket = (await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='vortx-carteiras'")).rows
      assert.deepEqual(bucket, [{ public: false, file_size_limit: '20971520', allowed_mime_types: ['application/json'] }])
      for (const rpc of ['vortx_reservar_carteira(uuid,uuid,date,text,bigint)', 'vortx_concluir_carteira(uuid,uuid,jsonb)', 'vortx_encerrar_carteira(uuid,uuid)']) {
        for (const role of ['anon', 'authenticated', 'service_role']) {
          assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${rpc}`])).rows[0].allowed, role === 'service_role')
        }
      }
      assert.equal((await db.query("select count(*)::int n from pg_class where oid in ('public.vortx_carteira_cotas'::regclass,'private.vortx_carteira_execucoes'::regclass) and relrowsecurity")).rows[0].n, 2)
      assert.equal((await db.query("select private.integracao_adapter_capability_suportada('vortx_vrs','CARTEIRA') and not private.integracao_adapter_capability_suportada('sinqia_portal_fidc','CARTEIRA') ok")).rows[0].ok, true)
      assert.equal((await db.query("select count(*)::int n from public.vortx_carteira_cotas")).rows[0].n, 0)
      assert.equal((await db.query("select count(*)::int n from private.vortx_carteira_execucoes")).rows[0].n, 0)
      await db.query("notify pgrst,'reload schema';commit")
      report.applied = true
    } catch (error) { await db.query('rollback'); throw error }
  }
  await preserve()
  report.preservation = true; report.stage = 'COMPLETE'; report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  report.error = { name: error.name, code: error.code ?? null,
    reason: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'PREVIEW_OPERATION_FAILED_NO_RAW_DETAILS' }
  process.exitCode = 1
} finally {
  if (db) await db.end()
  writeFileSync(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, result: report.result, stage: report.stage, applied: report.applied, preservation: report.preservation, error: report.error }))
}
function manifestVersions() { return baselineManifest.importedMigrations.map(m => m.path.split('/').at(-1).split('_')[0]) }
