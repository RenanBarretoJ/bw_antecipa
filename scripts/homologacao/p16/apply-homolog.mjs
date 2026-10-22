import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { database, loadHomologEnv, projectRef } from './homolog-env.mjs'

const version = '20260928185439'
const name = 'p16_liberar_nf_de_operacao_cancelada'
const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8')
const hash = createHash('sha256').update(sql).digest('hex')
assert.equal(hash, '6390f43842e82d7d980acfb6ae61e66cd551676e17c21a01a6e8ca237ce3efa1')
const { connectionString } = loadHomologEnv()
const db = database(connectionString)
const inventory = `select p.oid::regprocedure::text as signature, pronargs, md5(pg_get_functiondef(p.oid)) as md5, proacl::text as acl
  from pg_proc p where proname in ('operacao_status_reserva_nf','solicitar_operacao_antecipacao_atomica') order by pronargs`
await db.connect()
try {
  await db.query('begin')
  await db.query("set local lock_timeout='10s'; set local statement_timeout='30s'")
  await db.query("select pg_advisory_xact_lock(hashtextextended('p16-migration',0))")
  assert.equal((await db.query('select version from supabase_migrations.schema_migrations where version=$1',[version])).rowCount,0,'Migration ja aplicada; executar somente postflight')
  const before = (await db.query(inventory)).rows
  assert.deepEqual(before.map(row=>row.md5),[
    '90cbdcc13789bfe14907f403903a5cac','3e8de55f12866ef332af984fde40c102','bf0ba6dfc83993afd4106c46408edb05',
  ])
  // A transacao externa inclui DDL e historico; qualquer erro impede o COMMIT.
  await db.query(sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''))
  await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values ($1,$2,$3)', [version,name,[sql]])
  const after = (await db.query(inventory)).rows
  assert.deepEqual(after.slice(1),before.slice(1),'RPCs publicos mudaram')
  assert.equal(after[0].acl,before[0].acl,'ACL do predicado mudou')
  const matrix = (await db.query('select s::text as status, private.operacao_status_reserva_nf(s) as reserves from unnest(enum_range(null::public.operacao_status)) s')).rows
  for (const row of matrix) assert.equal(row.reserves,!['cancelada','reprovada'].includes(row.status))
  await db.query('commit')
  const evidence = {projectRef,version,name,hash,appliedAt:new Date().toISOString(),before,after,matrix,result:'PASS'}
  writeFileSync('docs/analises/p16-homolog-migration.json',JSON.stringify(evidence,null,2)+'\n')
  console.log(JSON.stringify({projectRef,version,hash,result:'PASS'}))
} catch (error) {
  await db.query('rollback')
  throw error
} finally { await db.end() }
