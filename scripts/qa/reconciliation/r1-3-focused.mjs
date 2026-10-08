import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { configureDisposableToml, sanitizedLocalEnvironment, fileSha256, redactCommandOutput } from '../../perf9e/clean-room-lib.mjs'
import { disposableResources, nativeSupabaseCli } from '../../email-intake/disposable-resources.mjs'
import { seedDocumentFixture } from './r1-2-document-fixture.mjs'
import { target, protectedCatalog } from './r1-3-catalog.mjs'
import { verifyNotificationRegression } from './r1-3-notifications.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const projectId = `bw_email03_r13_${Date.now()}`
const root = resolve('rehearsal/tmp',projectId)
const container = `supabase_db_${projectId}`
const cli = await nativeSupabaseCli()
const env = sanitizedLocalEnvironment()
for (const key of Object.keys(env)) if (/SUPABASE|DATABASE|POSTGRES|EMAIL_INTAKE|SECRET|PASSWORD|TOKEN|CREDENTIAL|OPENAI/i.test(key)) delete env[key]
const manifest = JSON.parse(await readFile('scripts/qa/reconciliation/r1-3-focused-manifest.json','utf8'))
for (const m of manifest) assert.equal(fileSha256(m.path),m.sha256,`HASH_DRIFT:${m.path}`)
const forward = manifest.find(m=>m.version==='20261006210815')
const notifications = manifest.filter(m=>m.version>='20261005213812'&&m!==forward)
const historyChain = manifest.filter(m=>m!==forward)
const sources = [
  {path:'../bw_antecipa_notificacoes/rehearsal/tmp/notificacoes-reference-schema.sql',sha256:'23ab8782a97872210730a4fe85ab5ceb6682694ca8572d6c9f41f7f04c58c589'},
  {path:'../bw_antecipa_notificacoes/rehearsal/tmp/notificacoes-reference-metadata.json',sha256:'a35fccc79017f786c58109933897a94706b37093dc752903aec2b04377afe08a'},
  {path:'../bw_antecipa_guibor_prod_02/rehearsal/tmp/guibor-prod02-baseline-schema.sql',sha256:'668e47e0d58543bfdbe7d2df3546e1b4f6de864a7cc9a2cb7ca34256059dff6b'},
]
for(const s of sources) assert.equal(fileSha256(s.path),s.sha256)
const metadata=JSON.parse(await readFile(sources[1].path,'utf8'))
const oldMetadata=JSON.parse(await readFile('../bw_antecipa_guibor_prod_02/rehearsal/reports/GUIBOR_PROD_02_PREFLIGHT.json','utf8'))
const read = async p=>(await readFile(p,'utf8')).replaceAll('\r\n','\n')
const ident = s=>'"'+s.replaceAll('"','""')+'"'
const report={at:new Date().toISOString(),projectId,result:'IN_PROGRESS',scope:'FOCUSED_C5_A6_NOT_FULL_R1_UPGRADE',
  sources,manifest,productionChanged:false,homologChanged:false,historyFaked:false,paths:[],cleanup:'NOT_RUN'}
const connection={host:'127.0.0.1',port:57842,user:'postgres',password:'postgres'}
const connect=async database=>{const db=new Client({...connection,database});await db.connect();await db.query("SET statement_timeout='120s';SET lock_timeout='5s'");return db}
await mkdir(resolve(root,'supabase/migrations'),{recursive:true})
await mkdir('rehearsal/reports',{recursive:true})
await writeFile(resolve(root,'supabase/config.toml'),configureDisposableToml(await read('supabase/config.toml'),{
  projectId,apiPort:57841,dbPort:57842,shadowPort:57840,studioPort:57843,mailPort:57844,analyticsPort:57847}))
const owned=await disposableResources({projectId,file:`rehearsal/reports/${projectId}-resources.json`,tempDirs:[root]})
const run=args=>new Promise((done,reject)=>{
  const child=spawn(cli,[...args,'--workdir',root],{env,windowsHide:true});let output=''
  for(const s of [child.stdout,child.stderr])s.on('data',b=>{output+=b})
  child.on('error',reject);child.on('exit',code=>done({code,output}))
})
const docker=(args,input)=>{
  const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,maxBuffer:16000000,timeout:120000})
  assert.equal(r.status,0,redactCommandOutput(r.stderr??String(r.error)).slice(-2000));return r.stdout
}
async function restore(db,old=false){
  report.stage=old?'RESTORE_PRE_A6_SCHEMA_ONLY':'RESTORE_PRODUCTION_SCHEMA_ONLY'
  const schema=await read(sources[old?2:0].path)
  assert(!/^COPY\s|^INSERT INTO\s|^SELECT pg_catalog.setval/m.test(schema),'DATA_DUMP_REFUSED')
  assert(!/CREATE TABLE[^\n]*"supabase_migrations"/i.test(schema),'HISTORY_DUMP_REFUSED')
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname IN('public','private')")).rows[0].n,0)
  await db.query('BEGIN')
  for(const kind of ['TABLES','SEQUENCES','FUNCTIONS'])await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${kind} FROM anon,authenticated,service_role`)
  const installed=new Set((await db.query('SELECT extname FROM pg_extension')).rows.map(r=>r.extname))
  for(const e of metadata.extensions)if(!installed.has(e.name)){
    assert(['unaccent','pgcrypto','uuid-ossp'].includes(e.name));await db.query(`CREATE EXTENSION ${ident(e.name)} WITH SCHEMA ${ident(e.schema)}`)
  }
  await db.query(schema.replace('SET statement_timeout = 0;',"SET LOCAL statement_timeout='120s';").replace('SET lock_timeout = 0;',"SET LOCAL lock_timeout='5s';").replace('SET row_security = off;',''))
  // Historical pg_policies deparser used unqualified public function names.
  await db.query('SET LOCAL search_path=public,extensions')
  for(const p of old?oldMetadata.policies:metadata.storagePolicies){
    const roles=Array.isArray(p.roles)?p.roles:p.roles.replace(/^\{|\}$/g,'').split(',')
    await db.query(`CREATE POLICY ${ident(p.policyname)} ON storage.${ident(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${roles.map(r=>r==='public'?'PUBLIC':ident(r)).join(',')}${p.qual?` USING (${p.qual})`:''}${p.with_check?` WITH CHECK (${p.with_check})`:''}`)
  }
  for(const t of metadata.authTriggers)await db.query(t)
  await db.query('COMMIT; SET search_path=public,extensions; CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions')
}
async function apply(db,m,evidence){
  assert.equal(fileSha256(m.path),m.sha256)
  if(evidence.mode==='production-like')assert(!/c5_r2_|20260929193129/.test(m.path),'HISTORICAL_REPLAY_REFUSED')
  report.stage=`${evidence.mode}:${m.version}`
  await db.query(await read(m.path));evidence.applied.push(m.version)
}
async function tap(db,file,prefix=''){
  report.stage=`TEST:${file}`
  let sql=await read('supabase/tests/'+file)
  sql=sql.replace(/^\\set.*$/mg,'')
  for(const match of [...sql.matchAll(/^\\ir (.+)$/mg)])sql=sql.replace(match[0],await read('supabase/tests/'+match[1].trim()))
  const results=await db.query(prefix+sql)
  const lines=(Array.isArray(results)?results:[results]).flatMap(r=>r.rows).flatMap(Object.values).filter(v=>typeof v==='string')
  const failures=lines.filter(l=>/^not ok|^# Looks like/.test(l))
  assert.deepEqual(failures,[],`${file}: ${failures.join('\n')}`)
  const checks=lines.filter(l=>/^ok \d+/.test(l)).length
  assert(checks>0,`NO_TAP_CHECKS:${file}`);await db.query('ROLLBACK')
  console.log(JSON.stringify({test:file,checks}));return {file,checks,pass:true}
}
async function verify(db,evidence){
  await db.query('SET search_path=public,extensions')
  evidence.fixture=await seedDocumentFixture(db,'SCHEMA_ONLY_MINIMAL')
  const before=await protectedCatalog(db)
  await apply(db,forward,evidence)
  assert.deepEqual(await protectedCatalog(db),before,'PROTECTED_CATALOG_CHANGED_STOP')
  const first=await target(db)
  assert.equal(first.functions.length,21,'CRITICAL_FUNCTION_INVENTORY')
  assert.equal(first.indexes.length,3)
  await apply(db,forward,evidence)
  assert.deepEqual(await target(db),first,'FORWARD_NOT_IDEMPOTENT')
  assert.deepEqual(await protectedCatalog(db),before,'REAPPLY_CHANGED_PROTECTED_CATALOG_STOP')
  evidence.catalog=first;evidence.protectedCatalogPreserved=true;evidence.ddlIdempotent=true
  assert.equal(first.sacadoShortCircuit.length,3)
  assert(first.sacadoShortCircuit.every(f=>f.lanname==='plpgsql'&&f.prosrc.includes("IS DISTINCT FROM 'sacado'")),'SACADO_SHORT_CIRCUIT_MISSING_STOP')
  // Reapply in a controlled rollback with a pre-existing ON flag and fiscal rows.
  await db.query('BEGIN')
  await db.query(await read('supabase/tests/fixtures/guibor_a5_a6.sql'))
  await db.query("SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000004',true); SELECT set_config('request.jwt.claims','{\"role\":\"authenticated\",\"aal\":\"aal2\"}',true)")
  await db.query("SELECT public.configurar_comissao_consultor_fundo('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',true)")
  const rows=async()=>{
    const out={};for(const table of ['consultor_fundos','notas_fiscais','operacoes','logs_auditoria','documento_requisito_instancias'])out[table]=(await db.query(`SELECT to_jsonb(t) row FROM public.${ident(table)} t ORDER BY to_jsonb(t)::text`)).rows
    return out
  }
  const dataBefore=await rows()
  await db.query((await read(forward.path)).replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''))
  assert.deepEqual(await rows(),dataBefore,'FORWARD_CHANGED_EXISTING_DATA_STOP')
  await db.query('ROLLBACK');evidence.existingOnAndFiscalRowsPreserved=true
  evidence.tests=[]
  for(const name of ['guibor_a6_comissao.test.sql','guibor_a6_r2_analytics_scope.test.sql',
    'c1_1_organizacao_consultora.test.sql','c2_1_r2_fluxo_taxa.test.sql','r1_3_c5_a6_compat.test.sql'])evidence.tests.push(await tap(db,name))
  evidence.tests.push(await tap(db,'notificacoes_shared_cedente.sql',`BEGIN;${await read('supabase/tests/fixtures/guibor_a5_a6.sql')}\n`))
  // Existing SACADO assertions require a reviewed legacy link; create only this synthetic link,
  // without re-running its historical migration/backfill on a post-SACADO baseline.
  evidence.tests.push(await tap(db,'sacado_multi.assert.sql',`BEGIN;${await read('supabase/tests/fixtures/guibor_a5_a6.sql')}\n${await read('supabase/tests/fixtures/sacado_multi.sql')}\nINSERT INTO public.sacado_acessos(user_id,sacado_id,fundo_id) VALUES('31000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;\n`))
  report.stage='NOTIFICATIONS_PRODUCERS_UI_SCOPE'
  evidence.notifications=await verifyNotificationRegression(db)
  assert.equal((await db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,0)
  assert.equal((await db.query('SELECT count(*)::int n FROM public.operacoes')).rows[0].n,0)
  evidence.result='PASS'
}
let admin,prod,clean,homolog
try{
  report.stage='BOOTSTRAP';console.log(JSON.stringify({stage:report.stage,projectId}))
  const started=await run(['start','--exclude','realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'])
  await owned.capture();assert.equal(started.code,0,redactCommandOutput(started.output).slice(-2000))
  admin=await connect('postgres')
  const bootstrap=docker(['exec',container,'pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--no-owner'])
  for(const name of ['r13_prod','r13_clean']){
    assert.equal((await admin.query('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[name])).rows[0].n,0)
    await admin.query(`CREATE DATABASE ${ident(name)} OWNER postgres TEMPLATE template0`)
    docker(['exec','-i',container,'psql','-U','supabase_admin','-d',name,'-v','ON_ERROR_STOP=1','-q'],bootstrap)
  }
  prod=await connect('r13_prod');await restore(prod)
  const p={mode:'production-like',applied:[],originalA6Executed:false,c5HistoricalExecuted:false};report.paths.push(p)
  // Construct historical synthetic notification BEFORE its scope migration.
  // This auxiliary rollback is baseline certification, not a production upgrade.
  report.stage='NOTIFICATION_LEGACY_BASELINE_PROOF'
  await prod.query('BEGIN; SET LOCAL search_path=public,extensions')
  await prod.query(await read('supabase/tests/fixtures/guibor_a5_a6.sql'))
  await prod.query("INSERT INTO public.notificacoes(usuario_id,titulo,mensagem,tipo) VALUES('21000000-0000-4000-8000-000000000004','Historic QA','Unscoped','info')")
  for(const m of notifications)await prod.query(await read(m.path))
  const legacyBefore=(await prod.query('SELECT * FROM public.notificacoes ORDER BY id')).rows
  assert.equal(legacyBefore.length,1);assert.equal(legacyBefore[0].scope_type,'LEGACY_UNSCOPED')
  await prod.query((await read(forward.path)).replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''))
  assert.deepEqual((await prod.query('SELECT * FROM public.notificacoes ORDER BY id')).rows,legacyBefore)
  await prod.query("SELECT set_config('request.jwt.claims','{\"sub\":\"21000000-0000-4000-8000-000000000004\",\"role\":\"authenticated\"}',true); SET LOCAL ROLE authenticated")
  assert.equal((await prod.query("SELECT count(*)::int n FROM public.listar_notificacoes_filtradas('FUNDO','22000000-0000-4000-8000-000000000001')")).rows[0].n,0)
  assert.equal((await prod.query("SELECT count(*)::int n FROM public.listar_notificacoes_filtradas('GLOBAL',NULL)")).rows[0].n,0)
  await prod.query('ROLLBACK');report.notificationLegacyPreservedAndHidden=true
  for(const m of notifications)await apply(prod,m,p)
  p.baselinePreparedWith=p.applied;p.applied=[]
  assert.equal((await prod.query("SELECT to_regprocedure('private.consultor_usuario_pode_visualizar_cedente(uuid,uuid)') v")).rows[0].v,null)
  await verify(prod,p)
  clean=await connect('r13_clean');await restore(clean,true)
  const c={mode:'historical-cleanroom',applied:[],originalA6Executed:true,c5HistoricalExecuted:true};report.paths.push(c)
  for(const m of historyChain)await apply(clean,m,c)
  await clean.end();clean=null
  // Materialized historical C5+A6+A6R2 state, with no business records or fabricated history.
  await admin.query('CREATE DATABASE r13_homolog OWNER postgres TEMPLATE r13_clean')
  clean=await connect('r13_clean');homolog=await connect('r13_homolog')
  const h={mode:'homolog-like-focused',applied:[],baseline:'materialized historical C5+A6+A6R2 schema; not full remote homolog',originalA6Executed:false,c5HistoricalExecuted:false};report.paths.push(h)
  await verify(clean,c);await verify(homolog,h)
  assert.deepEqual(c.catalog,p.catalog,'HISTORICAL_CRITICAL_CATALOG_DIVERGENCE_STOP')
  assert.deepEqual(h.catalog,p.catalog,'HOMOLOG_CRITICAL_CATALOG_DIVERGENCE_STOP')
  report.catalogConvergence='PASS';report.result='PASS'
}catch(error){
  report.result='FAIL';report.failure={code:error.code??'ASSERTION',message:redactCommandOutput(error.message).slice(0,7000),where:error.where}
}finally{
  for(const db of [prod,clean,homolog,admin]){await db?.query('ROLLBACK').catch(()=>{});await db?.end().catch(()=>{})}
  try{await owned.cleanup(async()=>{const r=await run(['stop','--project-id',projectId,'--no-backup']);assert.equal(r.code,0)});report.cleanup='PASS'}
  catch(e){report.cleanup='FAIL';report.cleanupError=e.message}
  await writeFile('rehearsal/reports/R1_3_FOCUSED_SQL.json',JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({result:report.result,stage:report.stage,failure:report.failure,cleanup:report.cleanup}))
  if(report.result!=='PASS'||report.cleanup!=='PASS')process.exitCode=1
}
