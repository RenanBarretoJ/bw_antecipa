// Local PostgreSQL only. Run with Node 22 inside the disposable QA network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Client } from 'pg'

assert.equal(process.env.SACADO_LOCAL_QA, 'true', 'Explicit disposable QA required')
assert.ok(process.env.LOCAL_QA_PG_PASSWORD, 'Local QA password required')
const db = new Client({ host: '127.0.0.1', port: 57862, database: 'postgres', user: 'postgres', password: process.env.LOCAL_QA_PG_PASSWORD })
const root = new URL('../../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const migration = read('supabase/migrations/20261015180516_sacado_contestacao_parcial_dashboard.sql')
const report = { localOnly: true, rollbackOnly: true, migrationSha256: createHash('sha256').update(migration).digest('hex'), status: 'IN_PROGRESS', checks: [] }

async function claims(id) {
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal2' })])
}

async function visible(id) {
  await claims(id)
  await db.query('SET LOCAL ROLE authenticated')
  const hashes = {}
  for (const table of ['notas_fiscais', 'operacoes', 'operacoes_nfs']) {
    hashes[table] = (await db.query(`select md5(coalesce(string_agg(row_to_json(t)::text,'' order by row_to_json(t)::text),'')) hash from public.${table} t`)).rows[0].hash
  }
  await db.query('RESET ROLE')
  return hashes
}

try {
  await db.connect()
  await db.query('BEGIN')
  await db.query("SET LOCAL statement_timeout='30s'")
  const fund = (await db.query("select nome from public.fundos where id='22000000-0000-4000-8000-000000000001'")).rows[0]
  assert.ok(fund?.nome.includes('QA'), 'Prepared synthetic QA baseline required')
  await db.query('CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions')
  await db.query('SET LOCAL search_path=public,extensions')
  await db.query(read('supabase/tests/fixtures/sacado_hotfix.sql'))
  const actors = ['51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', ...Array.from({ length: 4 }, (_, i) => '21000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'))]
  const before = new Map()
  for (const id of actors) before.set(id, await visible(id))
  const rpcBefore = (await db.query("select pg_get_functiondef('public.processar_aceite_sacado(uuid[],text,text)'::regprocedure) d")).rows[0].d
  await db.query(migration)
  await db.query(migration)
  const rpcAfter = (await db.query("select pg_get_functiondef('public.processar_aceite_sacado(uuid[],text,text)'::regprocedure) d")).rows[0].d
  assert.equal(rpcAfter, rpcBefore.replace("v_nf.aceite_sacado_status <> 'pendente'", "v_nf.aceite_sacado_status NOT IN ('pendente', 'contestado')"))
  report.checks.push('IDEMPOTENT_MIGRATION_PRESERVES_RPC_BODY')
  for (const id of actors) assert.deepEqual(await visible(id), before.get(id))
  report.checks.push('RLS_EQUIVALENCE_SIX_ACTORS')
  const result = await db.query(read('supabase/tests/sacado_hotfix.assert.sql'))
  const tap = (Array.isArray(result) ? result : [result]).flatMap((r) => r.rows).flatMap((r) => Object.values(r)).filter((v) => typeof v === 'string')
  report.tapAssertions = tap.filter((v) => v.startsWith('ok ')).length
  report.failedTests = tap.filter((v) => v.startsWith('not ok ')).map((v) => v.split('\n')[0])
  assert.equal(report.failedTests.length, 0)
  assert.ok(!tap.some((v) => v.startsWith('# Looks like')))
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'
  report.errorCode = error.code || error.name
  process.exitCode = 1
} finally {
  await db.query('ROLLBACK').catch(() => {})
  await db.end()
  console.log(JSON.stringify(report))
}
