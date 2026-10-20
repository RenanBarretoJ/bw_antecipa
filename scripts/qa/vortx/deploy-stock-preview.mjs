import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { manifest, previewDetails, assertPreviewDetails, repository } from './preview-runtime.mjs'

// Fixed approved Preview and explicit two-migration list. No replay, adoption or history repair.
const apply = process.argv.includes('--apply')
const evidenceBase = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-native-stock-20261019')
const output = resolve(evidenceBase, `preview-${apply ? 'apply' : 'preflight'}-${Date.now()}`)
mkdirSync(output, { recursive: true })
const sha = value => createHash('sha256').update(value).digest('hex')
const read = path => readFileSync(resolve(repository, path), 'utf8').replace(/\r\n/g, '\n')
const entries = [
  ['20261019192624', 'vortx_native_stock'], ['20261020192527', 'vortx_stock_callback_processing'],
].map(([version, name]) => {
  const path = `supabase/migrations/${version}_${name}.sql`, sql = read(path)
  return { version, name, path, sql, sha256: sha(sql) }
})
const certified = readdirSync(evidenceBase).filter(p => p.startsWith('sql-')).sort().reverse()
  .map(p => JSON.parse(readFileSync(resolve(evidenceBase, p, 'REPORT.json'), 'utf8')))
  .find(r => !r.error && r.DOCKER_TEST_ENV_CLEANUP && r.stacks.length === 2
    && r.stacks.every(s => s.cleanup && s.tests.length >= 45)
    && entries.every(e => r.migrations?.some(m => m.path === e.path && m.sha256 === e.sha256)))
assert(certified, 'EXACT_STOCK_MIGRATIONS_NOT_CERTIFIED')
const report = { scope: 'VORTX_PREVIEW_EXPLICIT_STOCK_MIGRATIONS_ONLY', project: manifest.projectRef, apply,
  migrations: entries.map(({ version, name, path, sha256 }) => ({ version, name, path, sha256 })),
  applied: [], preservedBusinessData: false, originalA6Applied: false, error: null }
let db
try {
  const details = assertPreviewDetails(previewDetails())
  assert.equal(manifest.projectRef, 'phdckowbexkkvuwnzeaf', 'WRONG_APPROVED_PREVIEW')
  const caSource = 'https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt'
  const response = await fetch(caSource, { redirect: 'error', signal: AbortSignal.timeout(15000) })
  assert(response.ok, 'OFFICIAL_CA_DOWNLOAD_FAILED')
  const ca = await response.text(), certificate = new X509Certificate(ca)
  assert(certificate.ca && certificate.verify(certificate.publicKey) && Date.parse(certificate.validTo) > Date.now())
  assert.equal(certificate.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA')
  const connection = new URL(details.POSTGRES_URL)
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) connection.searchParams.delete(key)
  db = new pg.Client({ connectionString: connection.toString(), connectionTimeoutMillis: 20000,
    ssl: { ca, rejectUnauthorized: true, servername: connection.hostname } })
  await db.connect()
  await db.query("set default_transaction_read_only=on; set statement_timeout='45s'; set lock_timeout='3s'")
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1', [manifest.originalA6Version])).rows[0].n, 0)
  const existing = (await db.query('select version,name,statements from supabase_migrations.schema_migrations where version=any($1)', [entries.map(e => e.version)])).rows
  // Do not adopt a partially applied release or reconcile a divergent catalog automatically.
  assert.equal(existing.length, 0, 'EXPLICIT_MIGRATIONS_ALREADY_PRESENT_REVIEW_REQUIRED')
  const baseline = JSON.parse(read('scripts/qa/vortx/__fixtures__/native-stock-functions-baseline.json'))
  report.functionBaseline = []
  for (const f of baseline.functions) {
    const rows = (await db.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1", [f.name])).rows
    assert.equal(rows.length, 1, 'FUNCTION_BASELINE_AMBIGUOUS')
    assert.equal(rows[0].definition.replace(/\r\n/g, '\n').trim(), f.definition.trim(), `FUNCTION_BASELINE_CHANGED_${f.name}`)
    report.functionBaseline.push({ name: f.name, sha256: sha(f.definition) })
  }
  const absent = (await db.query("select to_regclass('public.vortx_posicao_ativos')::text a,to_regclass('public.vortx_posicao_parcelas')::text p,to_regclass('private.vortx_estoque_processamentos')::text j")).rows[0]
  assert.deepEqual(absent, { a: null, p: null, j: null }, 'NATIVE_CATALOG_ALREADY_PRESENT_REVIEW_REQUIRED')
  const fingerprint = async () => {
    const result = {}
    for (const table of ['fundos', 'integracoes_fundo', 'integracao_fundo_versoes', 'integracao_fundo_versao_capacidades',
      'vortx_relatorio_solicitacoes', 'importacoes_financeiras', 'estoque_posicoes', 'aquisicao_movimentos', 'liquidacao_movimentos', 'carteira_snapshots',
      'posicao_logistica_execucoes', 'posicao_logistica_resultados']) {
      result[table] = (await db.query(`select count(*)::int n,md5(coalesce(string_agg(row_to_json(t)::text,'|' order by id),'')) digest from public.${table} t`)).rows[0]
    }
    return result
  }
  report.before = await fingerprint()
  if (apply) {
    await db.query('set default_transaction_read_only=off; begin')
    try {
      for (const e of entries) {
        const body = e.sql.replace(/^BEGIN;\s*\n/m, '').replace(/\bCOMMIT;\s*$/, '')
        assert.notEqual(body, e.sql, 'MIGRATION_TRANSACTION_WRAPPER_MISSING')
        assert(!/^BEGIN;|\bCOMMIT;\s*$/m.test(body), 'MIGRATION_TRANSACTION_WRAPPER_REMAINS')
        await db.query(body)
        await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)', [e.version, e.name, [e.sql]])
        report.applied.push({ version: e.version, name: e.name, sha256: e.sha256, executedBodySha256: sha(body) })
      }
      report.after = await fingerprint()
      assert.deepEqual(report.after, report.before, 'BUSINESS_DATA_CHANGED_BY_DDL')
      await db.query("notify pgrst,'reload schema'; commit")
    } catch (error) { await db.query('rollback'); report.applied = []; throw error }
  } else report.after = await fingerprint()
  assert.deepEqual(report.after, report.before)
  report.preservedBusinessData = true
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1', [manifest.originalA6Version])).rows[0].n, 0)
} catch (error) {
  report.error = { name: error.name, code: error.code ?? null,
    assertion: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'PREVIEW_OPERATION_FAILED_NO_RAW_DETAILS' }
  process.exitCode = 1
} finally {
  if (db) await db.end()
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, apply, applied: report.applied, preservedBusinessData: report.preservedBusinessData, error: report.error }))
}
