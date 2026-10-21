import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { manifest, previewDetails, assertPreviewDetails, repository } from './preview-runtime.mjs'

const apply = process.argv.includes('--apply'), version = '20261020201600', name = 'vortx_stock_zip_recovery'
const path = `supabase/migrations/${version}_${name}.sql`
const read = path => readFileSync(resolve(repository, path), 'utf8').replace(/\r\n/g, '\n')
const sha = value => createHash('sha256').update(value).digest('hex')
const paths = ['supabase/migrations/20261019192624_vortx_native_stock.sql',
  'supabase/migrations/20261020192527_vortx_stock_callback_processing.sql', path]
const base = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-native-stock-20261019')
const output = resolve(base, `recovery-${apply ? 'apply' : 'preflight'}-${Date.now()}`)
mkdirSync(output, { recursive: true })
const sql = read(path)
const certified = readdirSync(base).filter(p => p.startsWith('sql-')).sort().reverse()
  .map(p => JSON.parse(readFileSync(resolve(base, p, 'REPORT.json'), 'utf8')))
  .find(r => !r.error && r.DOCKER_TEST_ENV_CLEANUP && r.stacks.length === 2 && r.stacks.every(s => s.cleanup && s.tests.length >= 50)
    && paths.every(path => r.migrations?.some(m => m.path === path && m.sha256 === sha(read(path)))))
assert(certified, 'EXACT_THREE_MIGRATION_REHEARSAL_REQUIRED')
const report = { scope: 'PREVIEW_ONLY_FORWARD_ZIP_RECOVERY', project: manifest.projectRef, apply,
  migration: { version, name, path, sha256: sha(sql) }, applied: false, preservedBusinessData: false, error: null }
let db
try {
  const details = assertPreviewDetails(previewDetails()); assert.equal(manifest.projectRef, 'phdckowbexkkvuwnzeaf')
  const caResponse = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt', { redirect: 'error', signal: AbortSignal.timeout(15000) })
  assert(caResponse.ok); const ca = await caResponse.text(), cert = new X509Certificate(ca)
  assert(cert.ca && cert.verify(cert.publicKey) && Date.parse(cert.validTo) > Date.now())
  assert.equal(cert.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA')
  const connection = new URL(details.POSTGRES_URL)
  for (const key of ['sslmode','sslrootcert','sslcert','sslkey']) connection.searchParams.delete(key)
  db = new pg.Client({ connectionString: connection.toString(), ssl: { ca, rejectUnauthorized: true, servername: connection.hostname }, connectionTimeoutMillis: 20000 })
  await db.connect(); await db.query("set default_transaction_read_only=on; set statement_timeout='45s'; set lock_timeout='3s'")
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=any($1)', [[manifest.originalA6Version, version]])).rows[0].n, 0)
  for (const prior of paths.slice(0, 2)) {
    const priorVersion = prior.match(/\/(\d+)_/)[1], priorSql = read(prior)
    const row = (await db.query('select statements from supabase_migrations.schema_migrations where version=$1', [priorVersion])).rows[0]
    assert.deepEqual(row?.statements, [priorSql], 'PREDECESSOR_MIGRATION_SOURCE_CHANGED')
  }
  const processing = read(paths[1])
  for (const [functionName, signature] of [['persistir_estoque_vortx','jsonb'], ['vortx_reservar_processamento_estoque','uuid'], ['vortx_concluir_processamento_estoque','uuid,uuid,jsonb']]) {
    const source = processing.slice(processing.indexOf(`FUNCTION public.${functionName}(`)).split('AS $$')[1].split('$$;')[0]
    const row = (await db.query('select prosrc,prosecdef from pg_proc where oid=$1::regprocedure', [`public.${functionName}(${signature})`])).rows[0]
    assert.equal(row.prosrc, source); assert.equal(row.prosecdef, true)
  }
  const fingerprint = async () => {
    const result = {}
    for (const table of ['public.fundos','public.integracoes_fundo','public.integracao_fundo_versoes',
      'public.vortx_relatorio_solicitacoes','public.vortx_relatorio_eventos','public.importacoes_financeiras',
      'public.estoque_posicoes','public.vortx_posicao_ativos','public.vortx_posicao_parcelas','private.vortx_estoque_processamentos']) {
      result[table] = (await db.query(`select count(*)::int n,md5(coalesce(string_agg(row_to_json(t)::text,'|' order by id),'')) digest from ${table} t`)).rows[0]
    }
    return result
  }
  report.before = await fingerprint()
  if (apply) {
    await db.query('set default_transaction_read_only=off'); await db.query('begin read write')
    try {
      const body = sql.replace(/^BEGIN;\s*\n/m, '').replace(/\bCOMMIT;\s*$/, '')
      assert.notEqual(body, sql); assert(!/^BEGIN;|\bCOMMIT;\s*$/m.test(body))
      await db.query(body)
      await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)', [version, name, [sql]])
      report.after = await fingerprint(); assert.deepEqual(report.after, report.before)
      await db.query("notify pgrst,'reload schema'; commit"); report.applied = true
    } catch (error) { await db.query('rollback'); throw error }
  } else report.after = await fingerprint()
  assert.deepEqual(report.after, report.before); report.preservedBusinessData = true
} catch (error) {
  report.error = { name: error.name, code: error.code ?? null, assertion: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'PREVIEW_RECOVERY_APPLY_FAILED_NO_RAW_DETAILS' }
  process.exitCode = 1
} finally {
  if (db) await db.end()
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, apply, applied: report.applied, preservedBusinessData: report.preservedBusinessData, error: report.error }))
}
