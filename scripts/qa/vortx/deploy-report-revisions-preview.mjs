import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { manifest, previewDetails, assertPreviewDetails, repository } from './preview-runtime.mjs'

const apply = process.argv.includes('--apply'), version = '20261020204704', name = 'vortx_report_request_revisions'
const path = `supabase/migrations/${version}_${name}.sql`
const read = path => readFileSync(resolve(repository, path), 'utf8').replace(/\r\n/g, '\n')
const sha = value => createHash('sha256').update(value).digest('hex')
const sql = read(path), base = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-callback-20261019')
const certified = readdirSync(base).filter(p => p.startsWith('sql-')).sort().reverse()
  .map(p => resolve(base, p, 'REPORT.json')).filter(existsSync).map(p => ({ path: p, report: JSON.parse(readFileSync(p, 'utf8')) }))
  .find(({ report: r }) => !r.error && r.DOCKER_TEST_ENV_CLEANUP && r.stacks.length === 2
    && r.stacks.every(s => s.cleanup && s.checks.includes('revisions_concurrent_confirmations_create_exactly_one_successor'))
    && r.migrations.some(m => m.path === path && m.sha256 === sha(sql)))
assert(certified, 'EXACT_REVISION_MIGRATION_TWO_STACK_REHEARSAL_REQUIRED')
const output = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-report-revisions-20261020', `${apply ? 'apply' : 'preflight'}-${Date.now()}`)
mkdirSync(output, { recursive: true })
const report = { scope: 'PREVIEW_ONLY_REPORT_REVISIONS', project: manifest.projectRef, apply,
  rehearsal: certified.path, migration: { version, name, path, sha256: sha(sql) },
  applied: false, preservedBusinessData: false, preservedOtherFunctions: false, stage: 'TARGET', error: null }
let db
try {
  const details = assertPreviewDetails(previewDetails()); assert.equal(manifest.projectRef, 'phdckowbexkkvuwnzeaf')
  report.stage = 'TLS_CERTIFICATE'
  const response = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt', { redirect: 'error', signal: AbortSignal.timeout(15000) })
  assert(response.ok); const ca = await response.text(), cert = new X509Certificate(ca)
  assert(cert.ca && cert.verify(cert.publicKey) && Date.parse(cert.validTo) > Date.now())
  assert.equal(cert.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA')
  const connection = new URL(details.POSTGRES_URL)
  for (const key of ['sslmode','sslrootcert','sslcert','sslkey']) connection.searchParams.delete(key)
  db = new pg.Client({ connectionString: connection.toString(), ssl: { ca, rejectUnauthorized: true, servername: connection.hostname }, connectionTimeoutMillis: 20000 })
  await db.connect(); await db.query("set default_transaction_read_only=on; set statement_timeout='45s'; set lock_timeout='3s'")
  report.stage = 'MIGRATION_HISTORY'
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=any($1)', [[manifest.originalA6Version, version]])).rows[0].n, 0)
  const original = read('supabase/migrations/20261019180624_vortx_report_requests_preview.sql')
  for (const [functionName, signature] of [['private.vortx_relatorio_reservar','uuid,uuid,text,date,date,date,integer,text,text'], ['public.admin_listar_relatorios_vortx','uuid,integer']]) {
    report.stage = `BASELINE:${functionName}`
    const expected = original.slice(original.indexOf(`FUNCTION ${functionName}(`)).split('AS $$')[1].split('$$;')[0]
    assert.equal((await db.query('select prosrc from pg_proc where oid=$1::regprocedure', [`${functionName}(${signature})`])).rows[0].prosrc, expected, 'REQUEST_FUNCTION_PRECONDITION_FAILED')
  }
  const fingerprint = async () => {
    const result = {}
    for (const table of ['public.fundos','public.integracoes_fundo','public.integracao_fundo_versoes',
      'public.vortx_relatorio_solicitacoes','public.vortx_relatorio_eventos','public.importacoes_financeiras',
      'public.estoque_posicoes','public.vortx_posicao_ativos','public.vortx_posicao_parcelas','private.vortx_estoque_processamentos']) {
      const value = table === 'public.vortx_relatorio_solicitacoes' ? "to_jsonb(t)-'revisao'-'solicitacao_anterior_id'" : 'to_jsonb(t)'
      result[table] = (await db.query(`select count(*)::int n,md5(coalesce(string_agg((${value})::text,'|' order by id),'')) digest from ${table} t`)).rows[0]
    }
    return result
  }
  const functions = async () => (await db.query(`select p.oid,n.nspname,p.proname,pg_get_functiondef(p.oid) definition,p.proacl::text
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','auth')
    and p.proname not in ('vortx_relatorio_reservar','admin_listar_relatorios_vortx','vortx_relatorio_reservar_revisao','admin_ressolicitar_relatorio_vortx') order by p.oid`)).rows
  const policies = async () => (await db.query("select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','private','storage') order by schemaname,tablename,policyname")).rows
  report.stage = 'BUSINESS_FINGERPRINT'
  report.before = await fingerprint(); const beforeFunctions = await functions(), beforePolicies = await policies()
  report.otherFunctionsSha256 = sha(JSON.stringify(beforeFunctions)); report.policiesSha256 = sha(JSON.stringify(beforePolicies))
  if (apply) {
    await db.query('set default_transaction_read_only=off'); await db.query('begin read write')
    try {
      await db.query('lock table public.vortx_relatorio_solicitacoes in access exclusive mode')
      assert.deepEqual(await fingerprint(), report.before, 'BUSINESS_STATE_CHANGED_DURING_PREFLIGHT')
      const body = sql.replace(/^BEGIN;\s*\n/m, '').replace(/\bCOMMIT;\s*$/, '')
      assert.notEqual(body, sql); assert(!/^BEGIN;|\bCOMMIT;\s*$/m.test(body))
      await db.query(body)
      await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)', [version, name, [sql]])
      report.after = await fingerprint(); assert.deepEqual(report.after, report.before)
      assert.deepEqual(await functions(), beforeFunctions); assert.deepEqual(await policies(), beforePolicies)
      await db.query("notify pgrst,'reload schema'; commit"); report.applied = true
    } catch (error) { await db.query('rollback'); throw error }
  } else report.after = await fingerprint()
  assert.deepEqual(report.after, report.before); assert.deepEqual(await functions(), beforeFunctions); assert.deepEqual(await policies(), beforePolicies)
  report.preservedBusinessData = true; report.preservedOtherFunctions = true
} catch (error) {
  report.error = { name: error.name, code: error.code ?? null, assertion: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'PREVIEW_REVISION_APPLY_FAILED_NO_RAW_DETAILS' }
  process.exitCode = 1
} finally {
  if (db) await db.end()
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, apply, applied: report.applied, preservedBusinessData: report.preservedBusinessData, preservedOtherFunctions: report.preservedOtherFunctions, error: report.error }))
}
