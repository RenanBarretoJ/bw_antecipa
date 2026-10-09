import assert from 'node:assert/strict'
import { readFileSync,writeFileSync } from 'node:fs'
import { details,connect,migration,ref } from './preview-runtime.mjs'
assert.deepEqual(process.argv.slice(2),['--apply'])
const m=migration()
const rehearsal=JSON.parse(readFileSync('rehearsal/reports/SACADO_R2_LOCAL_TEST.json','utf8'))
assert.equal(rehearsal.success,true,'LOCAL_SQL_GATE_REQUIRED')
assert.equal(rehearsal.migrationSha256,m.sha256,'REHEARSAL_HASH_MISMATCH')
const db=await connect(details())
try {
  assert.equal(Number((await db.query('select count(*) n from supabase_migrations.schema_migrations')).rows[0].n),0,'UNEXPECTED_HISTORY')
  const hashSql=`select md5(concat_ws('|',(select string_agg(to_jsonb(n)::text,'' order by id) from public.notas_fiscais n),(select string_agg(to_jsonb(o)::text,'' order by id) from public.operacoes o),(select string_agg(to_jsonb(l)::text,'' order by operacao_id,nota_fiscal_id) from public.operacoes_nfs l))) hash`
  await db.query('BEGIN')
  const before=(await db.query(hashSql)).rows[0].hash
  await db.query(m.source.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''))
  assert.equal((await db.query(hashSql)).rows[0].hash,before,'FINANCIAL_MUTATION')
  // Record only this actually executed migration in the same transaction.
  await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[m.version,m.name,[m.source]])
  assert.equal(Number((await db.query('select count(*) n from public.sacado_acessos')).rows[0].n),1,'BACKFILL_MUST_BE_ONE')
  await db.query('COMMIT')
  const report={at:new Date().toISOString(),success:true,ref,version:m.version,name:m.name,sha256:m.sha256,financialRowsUnchanged:true,historyAdded:[m.version],originalA6Applied:false,historicalDivergence:'KNOWN_AND_PRESERVED'}
  writeFileSync('rehearsal/reports/SACADO_R2_PREVIEW_MIGRATION.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
} catch(e) {
  await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({success:false,code:e.code || 'ASSERTION',message:String(e.message).slice(0,200)}));process.exitCode=1
} finally {await db.end()}
