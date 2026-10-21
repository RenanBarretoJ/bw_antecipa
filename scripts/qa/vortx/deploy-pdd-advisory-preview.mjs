import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { manifest, previewDetails, assertPreviewDetails, repository } from './preview-runtime.mjs'

// Approved, single-migration Preview operation. No replay, production connection,
// provider request, publication, native row edits or artificial historical repair.
const apply = process.argv.includes('--apply')
const version = '20261021144651', name = 'vortx_pdd_advisory_persistence'
const path = `supabase/migrations/${version}_${name}.sql`
const read = path => readFileSync(resolve(repository, path), 'utf8').replace(/\r\n/g, '\n')
const sha = value => createHash('sha256').update(value).digest('hex')
const sql = read(path)
assert.equal(sha(sql), '4fe2adab81c5b67eecd68cbb429e1f24d12becf4b84a29bee07cc45379c2ca90', 'UNCERTIFIED_MIGRATION_BYTES')
const evidenceRoot = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-native-stock-20261019')
const certified = readdirSync(evidenceRoot).filter(p => p.startsWith('sql-')).sort().reverse()
  .map(p => resolve(evidenceRoot, p, 'REPORT.json')).filter(existsSync)
  .map(path => ({ path, data: JSON.parse(readFileSync(path, 'utf8')) }))
  .find(({ data }) => !data.error && data.DOCKER_TEST_ENV_CLEANUP && data.stacks.length === 2
    && data.stacks.every(s => s.cleanup && s.pddMigration?.path === path && s.pddMigration.sha256 === sha(sql)
      && s.tests.includes('only_pdd_old_review_reclassified_with_audit_timestamp_and_full_reconciliation_preserved_no_publication')
      && s.tests.includes('nominal_acquisition_present_value_discrepancies_still_review_and_publication_denied')))
assert(certified, 'TWO_STACK_EXACT_HASH_CERTIFICATION_REQUIRED')
const output = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-pdd-advisory-20261021', `${apply ? 'apply' : 'preflight'}-${Date.now()}`)
mkdirSync(output, { recursive: true })
const report = { scope: 'PREVIEW_ONLY_PDD_ADVISORY_PERSISTENCE', project: manifest.projectRef, apply, output,
  migration: { version, name, path, sha256: sha(sql) }, certification: certified.path,
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
  report.stage = 'BASELINE'
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=ANY($1)', [[manifest.originalA6Version, version]])).rows[0].n, 0)
  for (const file of ['20261020192527_vortx_stock_callback_processing.sql', '20261021123847_vortx_central_bases_history.sql']) {
    const baseline = (await db.query('select name,statements from supabase_migrations.schema_migrations where version=$1', [file.slice(0, 14)])).rows
    assert.equal(baseline.length, 1, 'BASELINE_MIGRATION_REQUIRED')
    assert.equal(baseline[0].name, file.slice(15, -4))
    assert.equal(baseline[0].statements.join('\n').replace(/\r\n/g, '\n').trim(), read(`supabase/migrations/${file}`).trim(), 'BASELINE_SQL_BYTES_DIFFER')
  }
  assert.equal((await db.query("select to_regprocedure('private.vortx_estoque_reconciliado_financeiro(uuid)')::text f")).rows[0].f, null)
  const tables = ['public.fundos', 'public.profiles', 'public.usuario_fundos', 'public.integracoes_fundo', 'public.integracao_fundo_versoes',
    'public.vortx_relatorio_solicitacoes', 'public.vortx_relatorio_eventos', 'public.importacao_arquivos', 'public.estoque_posicoes', 'public.vortx_posicao_ativos', 'public.vortx_posicao_parcelas']
  const business = async () => {
    const result = {}
    for (const table of tables) result[table] = (await db.query(`select count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) digest from ${table} t`)).rows[0]
    return result
  }
  const functions = async () => (await db.query("select oid,pg_get_functiondef(oid) definition,proacl::text from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace,'auth'::regnamespace) and not (pronamespace='public'::regnamespace and proname='vortx_concluir_processamento_estoque') and not(pronamespace='private'::regnamespace and proname in ('vortx_central_bases_historico','vortx_estoque_reconciliado_financeiro')) order by oid")).rows
  const policies = async () => (await db.query("select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','private','storage') order by schemaname,tablename,policyname")).rows
  const permissions = async () => (await db.query("select oid,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where relnamespace in ('public'::regnamespace,'private'::regnamespace,'storage'::regnamespace) and relkind in ('r','p','v') order by oid")).rows
  const imports = async () => (await db.query("select id,(to_jsonb(i)-'metadados'-'updated_at')||jsonb_build_object('metadados',metadados-ARRAY['politica_conferencia_persistencia','financeiro_conferido','pdd_pendente','pdd_reclassificado_em']) r from importacoes_financeiras i order by id")).rows
  const jobs = async () => (await db.query("select id,to_jsonb(j)-'estado' r from private.vortx_estoque_processamentos j order by id")).rows
  const states = async () => (await db.query("select j.id,j.importacao_id,j.data_referencia,j.estado,i.status,i.publicada_em,i.metadados->>'pdd_pendente' pdd_pendente from private.vortx_estoque_processamentos j join importacoes_financeiras i on i.id=j.importacao_id and i.fundo_id=j.fundo_id order by j.id")).rows
  const acl = async () => (await db.query("select oid,proacl::text,prosecdef,proowner,proconfig from pg_proc where oid=ANY($1::regprocedure[]) order by oid", [['public.vortx_concluir_processamento_estoque(uuid,uuid,jsonb)', 'private.vortx_central_bases_historico(uuid,integer,text,text,text,date)']])).rows
  const before = { business: await business(), functions: await functions(), policies: await policies(), permissions: await permissions(), imports: await imports(), jobs: await jobs(), acl: await acl() }
  report.before = before.business; report.beforeStates = await states()
  report.preservationSha256 = Object.fromEntries(Object.entries(before).map(([key, value]) => [key, sha(JSON.stringify(value))]))
  const preserve = async () => {
    assert.deepEqual(await business(), before.business, 'NATIVE_VALUES_OR_UNRELATED_BUSINESS_CHANGED')
    assert.deepEqual(await functions(), before.functions, 'UNRELATED_FUNCTION_OR_PUBLICATION_GUARD_CHANGED')
    assert.deepEqual(await policies(), before.policies, 'POLICY_CHANGED')
    assert.deepEqual(await permissions(), before.permissions, 'TABLE_RLS_OR_GRANT_CHANGED')
    assert.deepEqual(await imports(), before.imports, 'FINANCIAL_IMPORT_FIELDS_OR_ORIGINAL_METADATA_CHANGED')
    assert.deepEqual(await jobs(), before.jobs, 'ORIGINAL_PROCESSING_CONTEXT_OR_TIMESTAMPS_CHANGED')
    assert.deepEqual(await acl(), before.acl, 'EXISTING_FUNCTION_AUTHORIZATION_CHANGED')
  }
  if (apply) {
    report.stage = 'TRANSACTION'
    await db.query('set default_transaction_read_only=off;begin read write')
    try {
      await db.query('select pg_advisory_xact_lock(20261021,144651)')
      await preserve()
      const body = sql.replace(/^BEGIN;\s*\n/m, '').replace(/\bCOMMIT;\s*$/, '')
      assert.notEqual(body, sql)
      await db.query(body)
      await preserve()
      for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await db.query("select has_function_privilege($1,'private.vortx_estoque_reconciliado_financeiro(uuid)','EXECUTE') allowed", [role])).rows[0].allowed, false)
      // Genuine new entry only after these exact bytes execute successfully, in the same transaction.
      await db.query('insert into supabase_migrations.schema_migrations(version,name,statements)values($1,$2,$3)', [version, name, [sql]])
      await db.query("notify pgrst,'reload schema';commit")
      report.applied = true
    } catch (error) { await db.query('rollback'); throw error }
  }
  await preserve(); report.after = await business(); report.afterStates = await states()
  report.auditReclassifications = (await db.query("select count(*)::int n from plataforma_auditoria where tipo_evento='VORTX_PDD_CONFERENCIA_ADIADA'")).rows[0].n
  report.preserved = true; report.stage = 'COMPLETE'
} catch (error) {
  report.error = { name: error.name, code: error.code || null, reason: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'PREVIEW_OPERATION_FAILED_NO_RAW_DETAILS' }
  process.exitCode = 1
} finally {
  if (db) await db.end()
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, apply, applied: report.applied, preserved: report.preserved, stage: report.stage, error: report.error }))
}
