import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { manifest, previewDetails, assertPreviewDetails, repository } from './preview-runtime.mjs'

// One explicitly reviewed migration, exact Preview only. No provider calls, replay or publication.
const apply = process.argv.includes('--apply')
const periodCorrection = process.argv.includes('--periodo-canonico')
const version = periodCorrection ? '20261021163306' : '20261021155151'
const name = periodCorrection ? 'vortx_inclusao_periodo_canonico' : 'vortx_inclusao_persistence'
const path = `supabase/migrations/${version}_${name}.sql`
const read = path => readFileSync(resolve(repository, path), 'utf8').replace(/\r\n/g, '\n')
const sha = value => createHash('sha256').update(value).digest('hex')
const sql = read(path)
assert.equal(sha(sql), periodCorrection ? 'b3457af2b2fcf487d17fb33ffa2565debf2c83079668cadf8a32fca6276b6a7c' : '799e09d3019d036c8db9624ceb136a38328114159f4d15d732d2ef29f3634af5', 'UNCERTIFIED_MIGRATION_BYTES')
const base = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-native-stock-20261019')
const certified = readdirSync(base).filter(p => p.startsWith('sql-')).sort().reverse()
  .map(p => resolve(base, p, 'REPORT.json')).filter(existsSync)
  .map(path => ({ path, data: JSON.parse(readFileSync(path, 'utf8')) }))
  .find(({ data: r }) => !r.error && r.DOCKER_TEST_ENV_CLEANUP && r.stacks.length === 2
    && r.stacks.every(s => s.cleanup && (periodCorrection ? s.inclusionPeriodMigration : s.inclusionMigration)?.path === path && (periodCorrection ? s.inclusionPeriodMigration : s.inclusionMigration).sha256 === sha(sql)
      && s.tests.includes('inclusion_real_history_projection_counts_timestamps_no_secret_cross_fund_mfa_revocation_and_auditor')
      && (!periodCorrection || s.tests.includes('inclusion_period_canonical_reference_preserves_original_event_scope_acl_stock_and_review'))
      && s.tests.includes('inclusion_same_file_dedup_and_overlapping_periods_share_canonical_movements')))
assert(certified, 'EXACT_HASH_TWO_STACK_CERTIFICATION_REQUIRED')
const output = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-inclusao-20261021', `${apply ? 'apply' : 'preflight'}-${Date.now()}`)
mkdirSync(output, { recursive: true })
const report = { scope: 'PREVIEW_ONLY_INCLUSAO_MIGRATION', output, project: manifest.projectRef,
  apply, certification: certified.path, migration: { version, name, path, sha256: sha(sql) },
  applied: false, preserved: false, stage: 'TARGET', error: null }
const rpc = 'public.vortx_central_bases_historico(uuid,integer,text,text,text,date)'
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
  report.stage = 'BASELINE'
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=ANY($1)', [[manifest.originalA6Version, version]])).rows[0].n, 0)
  for (const file of ['20261021123847_vortx_central_bases_history.sql', '20261021144651_vortx_pdd_advisory_persistence.sql', ...(periodCorrection ? ['20261021155151_vortx_inclusao_persistence.sql'] : [])]) {
    const baseline = (await db.query('select name,statements from supabase_migrations.schema_migrations where version=$1', [file.slice(0, 14)])).rows
    assert.equal(baseline.length, 1, 'BASELINE_MIGRATION_REQUIRED')
    assert.equal(baseline[0].name, file.slice(15, -4))
    assert.equal(baseline[0].statements.join('\n').replace(/\r\n/g, '\n').trim(), read(`supabase/migrations/${file}`).trim(), 'BASELINE_BYTES_DIFFER')
  }
  const wrapper = (await db.query('select prosrc,proacl::text,proowner,prosecdef,proconfig from pg_proc where oid=$1::regprocedure', [rpc])).rows[0]
  if (!periodCorrection) assert.equal(wrapper.prosrc.trim(), 'SELECT private.vortx_central_bases_historico(p_fundo_id,p_pagina,p_tipo,p_origem,p_estado,p_referencia);', 'UNEXPECTED_EXISTING_HISTORY_WRAPPER')
  assert.equal((await db.query("select to_regclass('public.vortx_inclusoes') t")).rows[0].t, periodCorrection ? 'vortx_inclusoes' : null)
  const corrected = periodCorrection ? ['private.vortx_inclusao_autorizada(uuid)', 'public.vortx_reservar_processamento_inclusao(uuid)'] : []
  const verifyBodies = async source => {
    for (const signature of corrected) {
      const fn = signature.slice(0, signature.indexOf('('))
      const expected = source.slice(source.indexOf(`FUNCTION ${fn}(`)).split('AS $$')[1].split('$$;')[0]
      assert.equal((await db.query('select prosrc from pg_proc where oid=$1::regprocedure',[signature])).rows[0].prosrc, expected, 'UNEXPECTED_FUNCTION_BODY')
    }
  }
  if (periodCorrection) await verifyBodies(read('supabase/migrations/20261021155151_vortx_inclusao_persistence.sql'))
  const tableNames = (await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','private') order by schemaname,tablename")).rows
  const business = async () => {
    const queries = tableNames.map(t => {
      const ident = [t.schemaname, t.tablename].map(s => '"' + s.replaceAll('"', '""') + '"').join('.')
      const label = `${t.schemaname}.${t.tablename}`.replaceAll("'", "''")
      return `select '${label}'::text name,count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) digest from ${ident} t`
    })
    const rows = (await db.query(queries.join(' UNION ALL '))).rows
    return Object.fromEntries(rows.map(({ name, n, digest }) => [name, { n, digest }]))
  }
  const functions = async () => (await db.query("select oid,case when oid=ANY($2::regprocedure[]) then null else pg_get_functiondef(oid) end definition,proacl::text,proowner,prosecdef,proconfig from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace,'auth'::regnamespace) and oid<>$1::regprocedure order by oid", [rpc,corrected])).rows
  const policies = async () => (await db.query("select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','private','storage') order by schemaname,tablename,policyname")).rows
  const permissions = async () => (await db.query("select oid,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where relnamespace in ('public'::regnamespace,'private'::regnamespace,'storage'::regnamespace) and relkind in ('r','p','v') order by oid")).rows
  const before = { business: await business(), functions: await functions(), policies: await policies(), permissions: await permissions() }
  report.before = before.business
  report.preservationSha256 = Object.fromEntries(Object.entries(before).map(([key,value]) => [key,sha(JSON.stringify(value))]))
  const preserve = async () => {
    assert.deepEqual(await business(), before.business, 'EXISTING_BUSINESS_ROWS_CHANGED')
    assert.deepEqual((await functions()).filter(f => before.functions.some(b => b.oid === f.oid)), before.functions, 'EXISTING_FUNCTION_OR_ACL_CHANGED')
    assert.deepEqual((await permissions()).filter(t => before.permissions.some(b => b.oid === t.oid)), before.permissions, 'EXISTING_TABLE_GRANT_OR_RLS_CHANGED')
    assert.deepEqual((await policies()).filter(p => before.policies.some(b => b.schemaname === p.schemaname && b.tablename === p.tablename && b.policyname === p.policyname)), before.policies, 'EXISTING_POLICY_CHANGED')
    const current = (await db.query('select proacl::text,proowner,prosecdef,proconfig from pg_proc where oid=$1::regprocedure', [rpc])).rows[0]
    const oldAcl = { proacl: wrapper.proacl, proowner: wrapper.proowner, prosecdef: wrapper.prosecdef, proconfig: wrapper.proconfig }
    assert.deepEqual(current, oldAcl, 'HISTORY_WRAPPER_AUTHORIZATION_CHANGED')
    if (periodCorrection) assert.equal((await db.query('select prosrc from pg_proc where oid=$1::regprocedure',[rpc])).rows[0].prosrc, wrapper.prosrc, 'HISTORY_WRAPPER_BODY_CHANGED')
  }
  if (apply) {
    report.stage = 'TRANSACTION'
    await db.query('set default_transaction_read_only=off;begin read write')
    try {
      await db.query('select pg_advisory_xact_lock(20261021,155151)')
      await preserve()
      const body = sql.replace(/^BEGIN;\s*\n/m, '').replace(/\bCOMMIT;\s*$/, '')
      assert.notEqual(body, sql)
      await db.query(body)
      if (periodCorrection) await verifyBodies(sql)
      await preserve()
      for (const table of ['public.vortx_inclusoes', 'public.vortx_inclusao_linhas', 'private.vortx_inclusao_processamentos', 'private.vortx_inclusao_blocos']) {
        const row = (await db.query('select relrowsecurity from pg_class where oid=$1::regclass', [table])).rows[0]
        assert.equal(row.relrowsecurity, true)
      }
      for (const name of ['vortx_reservar_processamento_inclusao(uuid)', 'vortx_manifesto_inclusao(uuid,uuid,jsonb)', 'vortx_estagiar_inclusao(uuid,uuid,integer,jsonb)', 'vortx_concluir_inclusao(uuid,uuid)', 'vortx_falhar_inclusao(uuid,uuid,text)']) {
        for (const role of ['anon', 'authenticated']) assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${name}`])).rows[0].allowed, false)
        assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') allowed", [`public.${name}`])).rows[0].allowed, true)
      }
      await db.query('insert into supabase_migrations.schema_migrations(version,name,statements)values($1,$2,$3)', [version,name,[sql]])
      await db.query("notify pgrst,'reload schema';commit")
      report.applied = true
    } catch (error) { await db.query('rollback'); throw error }
  }
  await preserve()
  report.after = await business(); report.preserved = true; report.stage = 'COMPLETE'
} catch (error) {
  report.error = { name: error.name, code: error.code || null, reason: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'PREVIEW_OPERATION_FAILED_NO_RAW_DETAILS' }
  process.exitCode = 1
} finally {
  if (db) await db.end()
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report,null,2))
  console.log(JSON.stringify({ output, apply, applied: report.applied, preserved: report.preserved, stage: report.stage, error: report.error }))
}
