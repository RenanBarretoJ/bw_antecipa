// Local only. No remote reads/writes, no linked-project fallback.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const container = 'supabase_db_sacado-r2-20261005'
const inspection = spawnSync('docker', ['inspect', container, '--format', '{{index .Config.Labels "com.supabase.cli.project"}}'], { encoding: 'utf8', windowsHide: true })
assert.equal(inspection.status, 0)
assert.equal(inspection.stdout.trim(), 'sacado-r2-20261005')
const checkpoint = JSON.parse(readFileSync('rehearsal/reports/SACADO_PREVIEW_SCHEMA_CHECKPOINT.json','utf8'))
const schema = readFileSync('rehearsal/tmp/sacado-production-schema-only.sql','utf8')
assert.equal(createHash('sha256').update(schema).digest('hex'), checkpoint.sha256)
const sql = readFileSync('supabase/migrations/20261005154435_sacado_multi_cnpj_acessos.sql','utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')
const db = new pg.Client({host:'127.0.0.1',port:57322,user:'postgres',password:'postgres',database:'postgres',ssl:false})
const report = {at:new Date().toISOString(), success:false, mode:process.argv[2] || '--compile', migrationSha256:createHash('sha256').update(readFileSync('supabase/migrations/20261005154435_sacado_multi_cnpj_acessos.sql','utf8').replaceAll('\r\n','\n')).digest('hex'), checks:[]}
assert(['--compile','--test','--ambiguous'].includes(report.mode))
const ident = s => '"'+s.replaceAll('"','""')+'"'
try {
  await db.connect()
  const count = (await db.query("select count(*)::int n from pg_tables where schemaname in ('public','private')")).rows[0].n
  if (count === 0) {
    await db.query('BEGIN')
    for(const kind of ['TABLES','SEQUENCES','FUNCTIONS']) await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${kind} FROM anon,authenticated,service_role`)
    const installed = new Set((await db.query('select extname from pg_extension')).rows.map(r=>r.extname))
    for(const e of checkpoint.source.extensions) if(!installed.has(e.name)) {
      assert(['unaccent','pgcrypto','uuid-ossp'].includes(e.name))
      await db.query(`CREATE EXTENSION ${ident(e.name)} WITH SCHEMA ${ident(e.schema)}`)
    }
    await db.query(schema.replace('SET row_security = off;',''))
    for(const t of checkpoint.source.auth_triggers || []) await db.query(t)
    await db.query('COMMIT')
  } else assert.equal(count,125,'Unexpected local baseline')
  await db.query("BEGIN; SET LOCAL search_path=public,extensions; CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;")
  if(report.mode !== '--compile') {
    await db.query(readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql','utf8'))
    await db.query(readFileSync('supabase/tests/fixtures/sacado_multi.sql','utf8'))
  }
  if(report.mode === '--ambiguous') await db.query("update public.notas_fiscais set fundo_id='22000000-0000-4000-8000-000000000002',cedente_fundo_id='24000000-0000-4000-8000-000000000002' where id='2a000000-0000-4000-8000-000000000004'")
  const financialHash = async () => (await db.query(`select md5(concat_ws('|',
    (select string_agg(to_jsonb(n)::text,'' order by id) from public.notas_fiscais n),
    (select string_agg(to_jsonb(o)::text,'' order by id) from public.operacoes o),
    (select string_agg(to_jsonb(l)::text,'' order by operacao_id,nota_fiscal_id) from public.operacoes_nfs l))) hash`)).rows[0].hash
  const before = await financialHash()
  if(report.mode === '--ambiguous') {
    await db.query('SAVEPOINT ambiguous_backfill')
    await assert.rejects(db.query(sql),/SACADO_BACKFILL_FUND_REVIEW_REQUIRED/)
    await db.query('ROLLBACK TO SAVEPOINT ambiguous_backfill')
    assert.equal((await db.query("select to_regclass('public.sacado_acessos') v")).rows[0].v,null)
    report.checks.push('ambiguous_backfill_rejected_atomically')
  } else await db.query(sql)
  assert.equal(await financialHash(), before, 'MIGRATION_CHANGED_FINANCIAL_DATA')
  report.checks.push('financial_rows_unchanged')
  if(report.mode !== '--ambiguous') report.checks.push('migration_compiles')
  if(report.mode === '--test') {
    const result = await db.query(readFileSync('supabase/tests/sacado_multi.assert.sql','utf8'))
    report.tap = (Array.isArray(result)?result:[result]).flatMap(r=>r.rows).flatMap(r=>Object.values(r)).filter(v=>typeof v==='string')
    assert(!report.tap.some(v=>/^not ok|# Looks like/.test(v)), 'SQL_TEST_FAILED')
    report.checks.push('SQL_assertions')
  }
  await db.query('ROLLBACK')
  report.success=true
} catch(e) {
  await db.query('ROLLBACK').catch(()=>{})
  report.error={message:e.message,code:e.code,position:e.position,where:e.where}
  process.exitCode=1
} finally {
  await db.end()
  writeFileSync('rehearsal/reports/SACADO_R2_LOCAL.json',JSON.stringify(report,null,2))
  writeFileSync(`rehearsal/reports/SACADO_R2_LOCAL_${report.mode.slice(2).toUpperCase()}.json`,JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
}
