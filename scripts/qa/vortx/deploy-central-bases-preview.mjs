import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { manifest, previewDetails, assertPreviewDetails, repository } from './preview-runtime.mjs'

// Explicit single-migration Preview release. Never replay history, repair a gap, or request provider data.
const apply = process.argv.includes('--apply')
const version = '20261021123847', name = 'vortx_central_bases_history'
const path = `supabase/migrations/${version}_${name}.sql`
const sql = readFileSync(resolve(repository, path), 'utf8').replace(/\r\n/g, '\n')
const sha = value => createHash('sha256').update(value).digest('hex')
assert.equal(sha(sql), '2dc1623e5e03dd8a4c01dd399c2f53dbdbaae440bc4f063c583884081f33cca6', 'MIGRATION_BYTES_NOT_CERTIFIED')
const evidenceRoot = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-callback-20261019')
const rehearsal = readdirSync(evidenceRoot).filter(p => p.startsWith('sql-')).sort().reverse()
  .map(p => resolve(evidenceRoot, p, 'REPORT.json')).filter(existsSync)
  .map(path => ({ path, data: JSON.parse(readFileSync(path, 'utf8')) }))
  .find(({ data }) => !data.error && data.DOCKER_TEST_ENV_CLEANUP && data.stacks.length === 2
    && data.stacks.every(stack => stack.cleanup && stack.checks.includes('central_migration_preserves_every_existing_function_grant_policy_rls_and_row')
      && stack.checks.includes('central_anon_service_role_cross_fund_unbound_and_tampered_filters_fail_closed'))
    && data.migrations.some(m => m.path === path && m.sha256 === sha(sql)))
assert(rehearsal, 'EXACT_TWO_STACK_REHEARSAL_REQUIRED')
const output = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/central-bases-20261021', `${apply ? 'apply' : 'preflight'}-${Date.now()}`)
mkdirSync(output, { recursive: true })
const report = { output, scope: 'PREVIEW_ONLY_SINGLE_ADDITIVE_READ_RPC_MIGRATION', project: manifest.projectRef, apply,
  migration: { version, name, path, sha256: sha(sql) }, rehearsal: rehearsal.path,
  applied: false, preserved: false, stage: 'TARGET', error: null }
let db
try {
  const details = assertPreviewDetails(previewDetails())
  assert.equal(manifest.projectRef, 'phdckowbexkkvuwnzeaf')
  report.stage = 'TLS'
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
  report.stage = 'HISTORY'
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=any($1)', [[manifest.originalA6Version, version]])).rows[0].n, 0)
  const baseline = (await db.query("select name,statements from supabase_migrations.schema_migrations where version='20261020212422'")).rows
  assert.equal(baseline.length, 1)
  assert.equal(baseline[0].name, 'vortx_operational_reports')
  const expected = readFileSync(resolve(repository, 'supabase/migrations/20261020212422_vortx_operational_reports.sql'), 'utf8').replace(/\r\n/g, '\n').trim()
  assert.equal(baseline[0].statements.join('\n').replace(/\r\n/g, '\n').trim(), expected, 'OPERATIONAL_BASELINE_BYTES_DIFFER')
  for (const schema of ['private', 'public']) {
    assert.equal((await db.query('select to_regprocedure($1)::text rpc', [`${schema}.vortx_central_bases_historico(uuid,integer,text,text,text,date)`])).rows[0].rpc, null)
  }
  const tables = ['public.fundos', 'public.profiles', 'public.usuario_fundos', 'public.integracoes_fundo', 'public.integracao_fundo_versoes',
    'public.vortx_relatorio_solicitacoes', 'public.vortx_relatorio_eventos', 'public.importacoes_financeiras', 'public.estoque_posicoes',
    'public.vortx_posicao_ativos', 'public.vortx_posicao_parcelas', 'private.vortx_estoque_processamentos']
  const business = async () => {
    const result = {}
    for (const table of tables) result[table] = (await db.query(`select count(*)::int n,md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) digest from ${table} t`)).rows[0]
    return result
  }
  const functions = async () => (await db.query("select oid,pg_get_functiondef(oid) definition,proacl::text from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace,'auth'::regnamespace) and proname <> 'vortx_central_bases_historico' order by oid")).rows
  const policies = async () => (await db.query("select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','private','storage') order by schemaname,tablename,policyname")).rows
  const permissions = async () => (await db.query("select oid,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where relnamespace in ('public'::regnamespace,'private'::regnamespace,'storage'::regnamespace) and relkind in ('r','p','v') order by oid")).rows
  report.stage = 'PRESERVATION_BASELINE'
  const before = { business: await business(), functions: await functions(), policies: await policies(), permissions: await permissions() }
  report.before = before.business
  report.functionsSha256 = sha(JSON.stringify(before.functions))
  report.policiesSha256 = sha(JSON.stringify(before.policies))
  report.permissionsSha256 = sha(JSON.stringify(before.permissions))
  const preserve = async () => {
    assert.deepEqual(await business(), before.business, 'BUSINESS_DATA_CHANGED')
    assert.deepEqual(await functions(), before.functions, 'EXISTING_FUNCTION_OR_ACL_CHANGED')
    assert.deepEqual(await policies(), before.policies, 'POLICY_CHANGED')
    assert.deepEqual(await permissions(), before.permissions, 'TABLE_PERMISSION_OR_RLS_CHANGED')
  }
  if (apply) {
    report.stage = 'TRANSACTION'
    await db.query('set default_transaction_read_only=off;begin read write')
    try {
      // An identical second attempt must fail before creating anything or changing history.
      await db.query('select pg_advisory_xact_lock(20261021,123847)')
      assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1', [version])).rows[0].n, 0)
      await preserve()
      const body = sql.replace(/^BEGIN;\s*\n/m, '').replace(/\bCOMMIT;\s*$/, '')
      assert.notEqual(body, sql); assert(!/^BEGIN;|\bCOMMIT;\s*$/m.test(body))
      await db.query(body)
      // Register only the migration executed in this very transaction; no historical gap repairs.
      await db.query('insert into supabase_migrations.schema_migrations(version,name,statements)values($1,$2,$3)', [version, name, [sql]])
      await preserve()
      const identity = 'vortx_central_bases_historico(uuid,integer,text,text,text,date)'
      for (const schema of ['public', 'private']) for (const role of ['anon', 'service_role', 'authenticated']) {
        const allowed = (await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed', [role, `${schema}.${identity}`])).rows[0].allowed
        assert.equal(allowed, role === 'authenticated')
      }
      await db.query("notify pgrst,'reload schema';commit")
      report.applied = true
    } catch (error) { await db.query('rollback'); throw error }
  }
  await preserve()
  report.after = await business()
  report.preserved = true
  report.stage = 'COMPLETE'
} catch (error) {
  report.error = { name: error.name, code: error.code || null, reason: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'PREVIEW_PREFLIGHT_OR_APPLY_FAILED_NO_RAW_DETAILS' }
  process.exitCode = 1
} finally {
  if (db) await db.end()
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, apply, applied: report.applied, preserved: report.preserved, stage: report.stage, error: report.error }))
}
