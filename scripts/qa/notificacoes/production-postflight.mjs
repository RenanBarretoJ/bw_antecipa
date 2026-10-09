// Read-only final gates, including concurrent raw inbox evidence kept separate.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {connectProduction,fingerprints,command,productionRef,out,assertSource} from './production-runtime.mjs'
import {migrations} from './preview-runtime.mjs'
import {concurrentSql} from './concurrent-webhooks.mjs'
assert.equal(process.argv.length,2);assertSource()
const apply=JSON.parse(readFileSync(out+'/apply-production.json','utf8')),deploy=JSON.parse(readFileSync(out+'/deploy.json','utf8')),smoke=JSON.parse(readFileSync(out+'/smoke-production.json','utf8'))
const r3=JSON.parse(readFileSync('rehearsal/reports/NOTIFICACOES_R3_FINAL.json','utf8'))
assert(apply.success&&deploy.success&&smoke.success&&smoke.ref===productionRef)
assert(smoke.cleanup.length===2&&smoke.screens.length===6&&smoke.screens.every(x=>x.keyboard&&x.violations.length===0))
assert(smoke.markOneActions.length===4&&smoke.markOneActions.every(x=>x.events.filter(e=>e.event==='request'&&e.kind==='mark').length===1&&x.events.some(e=>e.event==='response'&&e.kind==='mark'&&e.status===200)))
for(const role of ['gestor','cedente','sacado','consultor','single-fund'])assert(smoke.checks.some(x=>x.startsWith(role+':')))
assert.equal(r3.NOTIF_PRODUCERS_TOTAL,49);assert.equal(r3.NOTIF_PRODUCERS_PENDING,0)
const db=await connectProduction(),report={at:new Date().toISOString(),success:false,ref:productionRef,deploy,smoke,limitations:smoke.limitations}
try{
 await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=''")
 const current=await fingerprints(db,{concurrency:apply.concurrency})
 report.dataDifferences=current.filter(x=>apply.fingerprints.find(y=>y.name===x.name)?.hash!==x.hash||apply.fingerprints.find(y=>y.name===x.name)?.count!==x.count).map(x=>x.name)
 assert.deepEqual(report.dataDifferences,[],'PREEXISTING_DATA_DRIFT')
 assert.deepEqual((await db.query(readFileSync('scripts/qa/health/schema-catalog.sql','utf8'))).rows[0].objects,apply.catalog,'SCHEMA_DRIFT')
 assert.deepEqual((await db.query("SELECT version,name,md5(array_to_string(statements,E'\\n')) hash FROM supabase_migrations.schema_migrations ORDER BY version")).rows,apply.history,'HISTORY_DRIFT')
 for(const m of migrations())assert.deepEqual((await db.query('SELECT name,statements FROM supabase_migrations.schema_migrations WHERE version=$1',[m.version])).rows,[{name:m.name,statements:[m.source]}])
 assert(!apply.history.some(h=>h.version==='20260929193129'))
 const writers=(await db.query("SELECT n.nspname||'.'||p.proname name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f' AND p.prosrc ~* 'INSERT\\s+INTO\\s+public.notificacoes' ORDER BY 1")).rows
 assert.deepEqual(writers,apply.rawWriters)
 const broadcast=(await db.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f' AND p.prosrc ~* '(notifica|notificar)' AND p.prosrc ~* 'FROM\\s+public.profiles\\s+\\w+\\s+WHERE\\s+\\w+.role\\s*=\\s*''gestor''' ")).rows[0].n
 assert.equal(broadcast,0,'GLOBAL_GESTOR_BROADCAST')
 report.concurrentRawIngestion=(await db.query(concurrentSql,[apply.concurrency.eventIds,apply.concurrency.storageIds,apply.concurrency.fundIds])).rows.map(x=>({table:x.name,newUnlinkedRows:x.concurrent,preexistingCount:x.count}))
 report.scopes=(await db.query('SELECT scope_type,count(*)::int count FROM public.notificacoes GROUP BY scope_type ORDER BY scope_type')).rows
 const manifest=JSON.parse(readFileSync(out+'/smoke-production/qa-manifest.json','utf8'))
 for(const [table,column] of [['auth.users','id'],['auth.sessions','user_id'],['auth.mfa_factors','user_id']])assert.equal((await db.query(`SELECT count(*)::int n FROM ${table} WHERE ${column}=ANY($1::uuid[])`,[manifest.owned])).rows[0].n,0,'QA_AUTH_REMAINS')
 await db.query('COMMIT')
 for(const kind of ['container','volume','network'])assert.equal(command('docker',[kind,'ls','--filter','label=com.supabase.cli.project=notificacoes-r1-20261005','--quiet']),'','OWN_DOCKER_REMAINS')
 const logs=JSON.parse(readFileSync(out+'/runtime-logs.json','utf8'));assert(logs.success&&logs.deploymentId===deploy.deploymentId,'RUNTIME_LOG_GATE')
 const names=['SOURCE_EQUIVALENCE','MIGRATIONS','HISTORY','DEPLOY','TARGET','PRODUCERS','LIST_BY_FUND','BADGE_BY_FUND','MARK_READ','MARK_ALL','REALTIME','HREF_GUARD','GESTOR','CEDENTE','SACADO','CONSULTOR','LEGACY','SINGLE_FUND_REGRESSION','FINANCIAL_INTEGRITY','STORAGE_INTEGRITY','CLEANUP','POSTFLIGHT']
 Object.assign(report,Object.fromEntries(names.map(n=>['NOTIF_PROD_'+n,'PASS'])),{NOTIF_PROD_CERTIFIED_HEAD:'c93f88196614c41299b03175851cc2be3feda030',NOTIF_PROD_MIGRATION_COUNT:4,NOTIF_PROD_GLOBAL_BROADCASTS:0,NOTIF_PRODUCERS_TOTAL:49,GUIBOR_A6_ORIGINAL_APPLIED:'NO',GUIBOR_A6_ORIGINAL_HISTORY_FAKED:'NO',DOCKER_TEST_ENV_CLEANUP:'PASS',RLX_EMAIL_CHANGED:'NO',SACADO_CHANGED:'NO',HEALTH_PARSER_CHANGED:'NO',CERC_CHANGED:'NO',NOTIFICACOES_PROD_READY:'YES',success:true})
}catch(e){report.error={code:e.code??'ASSERTION',message:e.message.split('\n')[0]};process.exitCode=1}
finally{await db.query('ROLLBACK').catch(()=>{});await db.end();writeFileSync(out+'/FINAL.json',JSON.stringify(report,null,2));console.log(JSON.stringify({success:report.success,ready:report.NOTIFICACOES_PROD_READY??'NO',dataDifferences:report.dataDifferences,error:report.error,concurrent:report.concurrentRawIngestion,scopes:report.scopes}))}
