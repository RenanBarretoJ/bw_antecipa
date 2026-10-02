// HEALTH Preview only; every synthetic fixture is rolled back, even in --apply mode.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const ref = 'mkfslrspxzplghjeixjq'
const parent = 'wwsndnuvnjuabpbjwlck'
const branch = 'b5227cca-3494-46f9-b3a7-2f0ddee7650d'
assert(process.argv.slice(2).every(a => a === '--apply'), 'UNSUPPORTED_ARGUMENT')
const file = '20261002205122_health_nfse_municipal_identity.sql'
const source = readFileSync(`supabase/migrations/${file}`, 'utf8').replaceAll('\r\n','\n')
const hash = createHash('sha256').update(source).digest('hex')
const body = source.replace(/^begin;\s*$/mi,'').replace(/^commit;\s*$/mi,'')
assert(!/^\s*(begin|commit);/mi.test(body), 'TRANSACTION_ENVELOPE_STOP')
const cli = spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js','branches','get',branch,'--project-ref',parent,'-o','json'],{encoding:'utf8',windowsHide:true,timeout:30000})
assert.equal(cli.status,0,'BRANCH_LOOKUP_FAILED')
const details = JSON.parse(cli.stdout)
assert.equal(new URL(details.SUPABASE_URL).hostname,`${ref}.supabase.co`)
const url = new URL(details.POSTGRES_URL)
assert(url.hostname === `db.${ref}.supabase.co` || decodeURIComponent(url.username).endsWith(`.${ref}`),'WRONG_DATABASE_STOP')
const client = new pg.Client({connectionString:details.POSTGRES_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:20000})
const catalog = readFileSync('scripts/qa/health/schema-catalog.sql','utf8')
const report = {target:ref,at:new Date().toISOString(),migration:file,sha256:hash,apply:process.argv.includes('--apply'),success:false,checks:{}}
mkdirSync('rehearsal/reports',{recursive:true})
const stateSql = `select jsonb_build_object('users',(select count(*) from auth.users),'nfs',(select count(*) from public.notas_fiscais),'operations',(select count(*) from public.operacoes),'objects',(select count(*) from storage.objects),'history',(select count(*) from supabase_migrations.schema_migrations)) state`
async function state(){return (await client.query(stateSql)).rows[0].state}
async function getCatalog(){await client.query("set search_path=''");return (await client.query(catalog)).rows[0].objects}
function difference(before,after){const m=new Map(before.map(o=>[`${o.kind}:${o.name}`,o.hash]));const n=new Map(after.map(o=>[`${o.kind}:${o.name}`,o.hash]));return [...new Set([...m.keys(),...n.keys()])].filter(k=>m.get(k)!==n.get(k)).sort()}
const expectedChanges=['constraint:public.notas_fiscais.nfse_fatos_check','index:public.nfse_municipal_identity_unique']
const tapRows = result => (Array.isArray(result)?result:[result]).flatMap(r=>r.rows||[]).flatMap(r=>Object.values(r)).filter(v=>typeof v==='string'&&/^(?:ok |not ok |1\.\.|#)/.test(v))
let inTransaction=false
try {
  await client.connect()
  const before=await state()
  assert.equal(before.users+before.nfs+before.operations+before.objects,0,'EMPTY_PREVIEW_REQUIRED')
  const history=(await client.query('select statements from supabase_migrations.schema_migrations where version=$1',[file.slice(0,14)])).rows
  assert.equal(history.length,0,'MIGRATION_ALREADY_APPLIED_STOP')
  const beforeCatalog=await getCatalog()
  await client.query("BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s'; CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions; SET LOCAL search_path=public,extensions;")
  inTransaction=true
  await client.query(readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql','utf8'))
  await client.query(`INSERT INTO public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,
    data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,
    valor_bruto,valor_liquido,valor_liquido_origem,status,tipo_documento_fiscal,vencimento_origem,chave_acesso,fiscal_proveniencia)
    SELECT '3a000000-0000-4000-8000-000000000099',cedente_id,cedente_fundo_id,fundo_id,'90099','1',
      data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,
      valor_bruto,valor_liquido,valor_liquido_origem,status,'NFSE','DOCUMENT',repeat('3456789012',5),
      jsonb_build_object('strategy','danfse_v2_labels','source','PDF_TEXT_NATIVE','sha256',repeat('d',64),'competencia',null,'vencimento_documento',data_vencimento)
    FROM public.notas_fiscais WHERE id='2a000000-0000-4000-8000-000000000001'`)
  const oldRows=(await client.query("select md5(string_agg(to_jsonb(n)::text,'' order by id)) hash from public.notas_fiscais n")).rows[0].hash
  await client.query(body)
  assert.equal((await client.query("select md5(string_agg(to_jsonb(n)::text,'' order by id)) hash from public.notas_fiscais n")).rows[0].hash,oldRows,'UPGRADE_CHANGED_LEGACY_DATA')
  report.checks.existingRowsUnchanged=true
  const tap=tapRows(await client.query(readFileSync('supabase/tests/health_nfse_municipal.assert.sql','utf8')))
  report.tap=tap
  assert(tap.some(t=>t.startsWith('1..')),'MISSING_TAP_PLAN')
  assert(!tap.some(t=>/^not ok |# Looks like/.test(t)),'SQL_ASSERTIONS_FAILED')
  report.checks.municipalAssertions=tap.filter(t=>t.startsWith('ok ')).length
  await client.query(readFileSync('supabase/tests/guibor_nfse_review_intents.assert.sql','utf8'))
  report.checks.reviewClaimFencing=true
  await client.query('ROLLBACK');inTransaction=false
  assert.deepEqual(await state(),before,'FIXTURE_CLEANUP_FAILED')
  assert.deepEqual(await getCatalog(),beforeCatalog,'ROLLBACK_SCHEMA_DRIFT')
  report.checks.schemaAndDataRollback=true
  if(report.apply){
    await client.query("BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s';")
    inTransaction=true
    await client.query(body)
    assert.deepEqual(difference(beforeCatalog,await getCatalog()),expectedChanges,'UNEXPECTED_SCHEMA_CHANGE')
    await client.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[file.slice(0,14),file.slice(15,-4),[source]])
    await client.query('COMMIT');inTransaction=false
    report.committed=true
    assert.deepEqual(await state(),{...before,history:before.history+1})
    assert.deepEqual(difference(beforeCatalog,await getCatalog()),expectedChanges)
    const stored=(await client.query('select statements from supabase_migrations.schema_migrations where version=$1',[file.slice(0,14)])).rows[0].statements
    assert.equal(createHash('sha256').update(stored.join('\n')).digest('hex'),hash)
    report.checks.exactHistory=true
    report.checks.securityCatalogUnchanged=true
  }
  report.success=true
}catch(e){
  if(inTransaction)await client.query('ROLLBACK').catch(()=>{})
  report.error={code:e.code||'ASSERTION',message:String(e.message).slice(0,250)}
  process.exitCode=1
}finally{
  await client.end().catch(()=>{})
  report.finishedAt=new Date().toISOString()
  writeFileSync('rehearsal/reports/HEALTH_FISCAL_PREVIEW_SQL.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify({target:ref,success:report.success,checks:report.checks,committed:!!report.committed,errorCode:report.error?.code}))
}
