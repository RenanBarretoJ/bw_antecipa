import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import pg from 'pg'

const ref = 'wwsndnuvnjuabpbjwlck'
const version = '20260928185439'
const migrationName = 'p16_liberar_nf_de_operacao_cancelada'
const operation = '8cbb79f2-7829-462e-b350-518b459092d6'
const sha = '83ece9c676a4f39ff130a8885847735c8b1da17d'
const mode = process.argv.includes('--apply') ? 'apply' : 'preflight'
const file = process.argv.find(arg=>arg.startsWith('--env='))?.slice(6)
assert.ok(file, 'Informe o arquivo local da conexao aprovada')
const env = {}
for (const line of readFileSync(file,'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/)
  if(m)env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'')
}
assert.equal(env.REHEARSAL_PRODUCTION_PROJECT_REF,ref)
const url = new URL(env.REHEARSAL_PRODUCTION_DB_URL)
assert.ok(url.hostname === `db.${ref}.supabase.co` ||
  (url.hostname.endsWith('.pooler.supabase.com') && url.username === `postgres.${ref}`))
assert.equal(url.pathname,'/postgres')
const sql = readFileSync(`supabase/migrations/${version}_${migrationName}.sql`,'utf8')
const hash = createHash('sha256').update(sql).digest('hex')
assert.equal(hash,'6390f43842e82d7d980acfb6ae61e66cd551676e17c21a01a6e8ca237ce3efa1')
assert.equal(execFileSync('git',['rev-parse','origin/main'],{encoding:'utf8'}).trim(),sha)
const homolog = JSON.parse(readFileSync('docs/analises/p16-homolog-migration.json','utf8'))
assert.equal(homolog.hash,hash)
const db = new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000})
const functionNames = ['operacao_status_reserva_nf','solicitar_operacao_antecipacao_atomica',
  'consultor_usuario_pode_operar_cedente','consultor_usuario_tem_acesso_fundo','get_user_cedente_id','get_user_role']
const functions = async()=> (await db.query(`select n.nspname as schema,p.proname,p.pronargs,p.oid::regprocedure::text as signature,
  pg_get_functiondef(p.oid) as definition,md5(pg_get_functiondef(p.oid)) as md5,proacl::text as acl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname=any($1) order by n.nspname,p.proname,p.pronargs`,[functionNames])).rows
const history = async()=> (await db.query("select version,name,md5(array_to_string(statements,E'\\n')) as statements_md5 from supabase_migrations.schema_migrations order by version")).rows
const counts = async()=> (await db.query(`select
  (select count(*) from public.operacoes) as operacoes,
  (select count(*) from public.operacoes_nfs) as operacoes_nfs,
  (select count(*) from public.notas_fiscais) as notas_fiscais,
  (select count(*) from public.logs_auditoria) as logs_auditoria,
  (select md5(string_agg(md5(row_to_json(o)::text),'' order by o.id)) from public.operacoes o) as operations_digest,
  (select md5(string_agg(md5(row_to_json(n)::text),'' order by n.id)) from public.notas_fiscais n) as notes_digest,
  (select md5(string_agg(md5(row_to_json(l)::text),'' order by l.operacao_id,l.nota_fiscal_id)) from public.operacoes_nfs l) as links_digest,
  (select count(*) from public.logs_auditoria where entidade_id=$1) as case_audit_count,
  (select md5(row_to_json(o)::text) from public.operacoes o where o.id=$1) as case_operation_digest,
  (select md5(string_agg(md5(row_to_json(l)::text),'' order by l.nota_fiscal_id)) from public.operacoes_nfs l where l.operacao_id=$1) as case_links_digest,
  (select md5(string_agg(md5(row_to_json(a)::text),'' order by a.id)) from public.logs_auditoria a where a.entidade_id=$1) as case_audit_digest`,[operation])).rows[0]
async function realCase() {
  const rows = (await db.query(`select o.id as cancelled_operation_id,o.status as operation_status,nf.id as nf_id,nf.numero_nf,nf.status as nf_status,
    (select jsonb_agg(jsonb_build_object('operation_id',x.id,'status',x.status)) from public.operacoes_nfs l join public.operacoes x on x.id=l.operacao_id where l.nota_fiscal_id=nf.id) as all_links
    from public.operacoes o join public.operacoes_nfs link on link.operacao_id=o.id join public.notas_fiscais nf on nf.id=link.nota_fiscal_id where o.id=$1 order by nf.numero_nf`,[operation])).rows
  assert.equal(rows.length,20)
  for(const row of rows) {
    assert.equal(row.operation_status,'cancelada')
    assert.equal(row.nf_status,'aprovada')
    assert.ok(!row.all_links.some(link=>link.operation_id!==operation && !['cancelada','reprovada'].includes(link.status)),'STOP: outra reserva ativa')
  }
  return rows
}
await db.connect()
try {
  await db.query(mode==='apply'?'begin isolation level repeatable read':'begin read only')
  await db.query("set local lock_timeout='10s'; set local statement_timeout='30s'")
  const target=(await db.query('select current_database() as database,current_user as database_user')).rows[0]
  assert.equal(target.database,'postgres')
  const before = {functions:await functions(),history:await history(),counts:await counts(),realCase:await realCase()}
  assert.ok(!before.history.some(row=>row.version===version),'STOP: P16 ja registrado')
  assert.ok(before.history.some(row=>row.version==='20260925144547'),'STOP: C1.1 ausente')
  for(const expected of homolog.before) {
    const actual = before.functions.find(row=>row.signature===expected.signature)
    assert.equal(actual?.md5,expected.md5,'STOP: definicao difere do baseline homologado')
    assert.equal(actual.acl,expected.acl)
  }
  const evidence={projectRef:ref,host:url.hostname,...target,mainSha:sha,appSha:sha,
    deploymentId:'dpl_C4Jb3Q2GVxekaJDZAWaSZieg5jUD',p16Commit:'65ba24f50b5b599e3f3ac321cab9d7d2949e048f',
    migrationVersion:version,migrationSha256:hash,capturedAt:new Date().toISOString(),...before}
  writeFileSync(`docs/analises/p16-prod-${mode==='apply'?'checkpoint':'preflight'}.json`,JSON.stringify(evidence,null,2)+'\n')
  const prior = before.functions.find(row=>row.proname==='operacao_status_reserva_nf').definition
  writeFileSync('rehearsal/tmp/p16-prod-rollback.sql',`BEGIN;\n${prior};\nCOMMENT ON FUNCTION private.operacao_status_reserva_nf(public.operacao_status) IS 'P16 rollback: restauracao do predicado P14 sem DML';\nCOMMIT;\n`)
  if(mode==='apply') {
    const rehearsal = JSON.parse(readFileSync('docs/analises/p16-prod-rehearsal.json','utf8'))
    assert.equal(rehearsal.result,'PASS')
    assert.equal(rehearsal.migrationSha256,hash)
    await db.query("select pg_advisory_xact_lock(hashtextextended('p16-migration',0))")
    await db.query(sql.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,''))
    await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values ($1,$2,$3)',[version,migrationName,[sql]])
    const after={functions:await functions(),history:await history(),counts:await counts()}
    assert.deepEqual(after.counts,before.counts,'STOP: DML inesperado')
    assert.deepEqual(after.history.filter(row=>row.version!==version),before.history,'STOP: history fora do P16 alterado')
    assert.equal(after.history.filter(row=>row.version===version).length,1)
    assert.deepEqual(after.functions.filter(row=>row.proname!=='operacao_status_reserva_nf'),before.functions.filter(row=>row.proname!=='operacao_status_reserva_nf'))
    for(const expected of homolog.after) {
      const actual=after.functions.find(row=>row.signature===expected.signature)
      assert.equal(actual?.md5,expected.md5)
      assert.equal(actual.acl,expected.acl)
    }
    const matrix=(await db.query('select s::text as status,private.operacao_status_reserva_nf(s) as reserves from unnest(enum_range(null::public.operacao_status)) s')).rows
    for(const row of matrix)assert.equal(row.reserves,!['cancelada','reprovada'].includes(row.status))
    await db.query('commit')
    writeFileSync('docs/analises/p16-prod-migration.json',JSON.stringify({projectRef:ref,appliedAt:new Date().toISOString(),version,hash,matrix,after,result:'PASS',unintendedDml:'ZERO'},null,2)+'\n')
  } else { await db.query('rollback') }
  console.log(JSON.stringify({mode,projectRef:ref,version,hash,result:'PASS',legacyP14HistoryPresent:before.history.some(row=>row.version==='20260922182301')}))
} catch(error) {
  await db.query('rollback')
  console.error(JSON.stringify({result:'FAIL',message:error.message}))
  process.exitCode=1
} finally { await db.end() }
