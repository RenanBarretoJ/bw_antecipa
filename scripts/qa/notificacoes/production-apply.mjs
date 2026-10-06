// Explicit R4 migration allowlist. No db push, no historical repair.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import pg from 'pg'
import {migrations} from './preview-runtime.mjs'
import {assertSource,command,connectProduction,productionRef,out,fingerprints} from './production-runtime.mjs'
const local=process.argv[2]==='--local-rehearsal'
assert(process.argv.length===3&&(local||process.argv[2]==='--apply-production'))
assertSource()
const list=migrations(),rehearsal=JSON.parse(readFileSync(out+'/rehearsal.json','utf8'))
const preflight=JSON.parse(readFileSync(out+'/preflight-latest.json','utf8'))
assert(rehearsal.success&&rehearsal.sqlChecks===429&&preflight.success)
assert.deepEqual(rehearsal.migrations,list.map(({file,version,name,sha256})=>({file,version,name,sha256})))
const sha=command('git',['rev-parse','HEAD'])
if(!local){
  const approval=JSON.parse(readFileSync(out+'/baseline-approval.json','utf8'))
  assert(approval.userConfirmedLegitimateActivity===true&&approval.ref===productionRef&&approval.preflightAt===preflight.at,'EXPLICIT_BASELINE_APPROVAL_REQUIRED')
  assert(Date.now()-Date.parse(preflight.at)<15*60*1000,'FRESH_PREFLIGHT_REQUIRED')
  assert(JSON.parse(readFileSync(out+'/smoke-preview.json','utf8')).success,'QA_HARNESS_PREVIEW_REQUIRED')
  assert(JSON.parse(readFileSync(out+'/apply-local.json','utf8')).success,'APPLY_REHEARSAL_REQUIRED')
  assert.equal(command('git',['status','--porcelain']),'','CLEAN_WORKTREE_REQUIRED')
  assert.equal(command('git',['ls-remote','origin','refs/heads/main']).split(/\s/)[0],'7dd1d3a39b98859aa5f9f5bfe7d34385dc66045c','MAIN_DRIFT')
  const ci=JSON.parse(command('C:/Program Files/GitHub CLI/gh.exe',['run','list','--commit',sha,'--workflow','ci.yml','--json','headSha,conclusion,status,url']))
  assert(ci.some(r=>r.headSha===sha&&r.conclusion==='success'&&r.status==='completed'),'RELEASE_SHA_CI_REQUIRED')
}
const db=local?new pg.Client({host:'127.0.0.1',port:59422,user:'postgres',password:'postgres',database:'postgres'}):await connectProduction()
if(local){await db.connect();await db.query('CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[])')}
const report={at:new Date().toISOString(),success:false,ref:local?'localhost:59422':productionRef,sha,steps:[],committed:false}
const catalogSql=readFileSync('scripts/qa/health/schema-catalog.sql','utf8')
const historySql="SELECT version,name,md5(array_to_string(statements,E'\\n')) hash FROM supabase_migrations.schema_migrations ORDER BY version"
const sorted=rows=>[...rows].sort((a,b)=>a.name.localeCompare(b.name))
const key=x=>x.kind+':'+x.name
try{
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL search_path=''; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s'")
  const before=await fingerprints(db),history=(await db.query(historySql)).rows
  let prior=(await db.query(catalogSql)).rows[0].objects
  assert(!history.some(h=>h.version==='20260929193129'||list.some(m=>m.version===h.version)),'UNEXPECTED_HISTORY')
  if(!local){assert.deepEqual(before,sorted(preflight.baseline.fingerprints),'DATA_DRIFT_STOP');assert.deepEqual(history,preflight.baseline.history,'HISTORY_DRIFT_STOP');assert.deepEqual(prior,preflight.baseline.catalog,'SCHEMA_DRIFT_STOP')}
  // Calculate the expected backfill independently before executing any DDL.
  // Source is hash-pinned; only explicit entity foreign keys are used.
  const resolver=list[0].source.match(/LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS \$\$([\s\S]*?)\$\$;/)?.[1].trim().replace(/;$/,'')
  assert(resolver&&!/href|dedupe|mensagem|titulo/.test(resolver),'BACKFILL_RESOLVER_INVALID')
  const expectedSql=`SELECT to_jsonb(n)||jsonb_build_object('scope_type',CASE WHEN c.fundo_id IS NULL THEN 'LEGACY_UNSCOPED' ELSE 'FUNDO' END,'fundo_id',c.fundo_id,'cedente_fundo_id',c.cedente_fundo_id,'cedente_id',c.cedente_id) row FROM public.notificacoes n LEFT JOIN LATERAL (${resolver.replaceAll('p_tipo','n.entidade_tipo').replaceAll('p_id','n.entidade_id')}) c(fundo_id,cedente_fundo_id,cedente_id) ON true`
  report.expectedBackfill=(await db.query(`SELECT count(*)::int count,md5(coalesce(string_agg(row::text,'' ORDER BY row::text),'')) hash,count(*) FILTER(WHERE row->>'scope_type'='FUNDO')::int scoped,count(*) FILTER(WHERE row->>'scope_type'='LEGACY_UNSCOPED')::int legacy FROM (${expectedSql}) q`)).rows[0]
  assert.equal(report.expectedBackfill.count,before.find(x=>x.name==='public.notificacoes').count,'AMBIGUOUS_BACKFILL')
  for(const [i,m] of list.entries()){
    assert(!/^\s*(?:BEGIN|COMMIT);/im.test(m.source),'OUTER_TRANSACTION_REQUIRED')
    console.log(JSON.stringify({phase:'migration',target:report.ref,file:m.file,sha256:m.sha256}))
    await db.query(m.source)
    const actual=(await db.query(catalogSql)).rows[0].objects,step=rehearsal.catalogSteps[i]
    assert.equal(step.file,m.file)
    const prevMap=new Map(prior.map(o=>[key(o),o.hash])),actualMap=new Map(actual.map(o=>[key(o),o.hash]))
    const changes=[...new Set([...prevMap.keys(),...actualMap.keys()])].filter(k=>prevMap.get(k)!==actualMap.get(k)).sort()
    assert.deepEqual(changes,[...step.changed].sort(),'UNEXPECTED_CATALOG_DELTA')
    const expectedMap=new Map(step.catalog.map(o=>[key(o),o.hash]))
    for(const k of changes)assert.equal(actualMap.get(k),expectedMap.get(k),'CATALOG_HASH_MISMATCH:'+k)
    // Only record migrations that really executed in this transaction.
    await db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)',[m.version,m.name,[m.source]])
    report.steps.push({file:m.file,version:m.version,name:m.name,sha256:m.sha256,catalogChanges:changes.length,pass:true});prior=actual
  }
  assert.deepEqual(await fingerprints(db,{legacyNotifications:true}),before,'PREEXISTING_ROWS_CHANGED')
  const after=await fingerprints(db),notifications=after.find(x=>x.name==='public.notificacoes')
  assert.equal(notifications.hash,report.expectedBackfill.hash,'BACKFILL_CONTENT_MISMATCH')
  assert.equal(notifications.count,report.expectedBackfill.count)
  const afterHistory=(await db.query(historySql)).rows
  assert.deepEqual(afterHistory.filter(h=>!list.some(m=>m.version===h.version)),history,'HISTORICAL_HISTORY_CHANGED')
  assert.equal(afterHistory.length,history.length+4)
  for(const m of list)assert.deepEqual((await db.query('SELECT name,statements FROM supabase_migrations.schema_migrations WHERE version=$1',[m.version])).rows,[{name:m.name,statements:[m.source]}])
  const writers=(await db.query("SELECT n.nspname||'.'||p.proname name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f' AND p.prosrc ~* 'INSERT\\s+INTO\\s+public.notificacoes' ORDER BY 1")).rows
  assert.deepEqual(writers.map(x=>x.name),['private.criar_notificacao_fundo','private.notificar_seguranca_global'])
  report.rawWriters=writers;report.history=afterHistory;report.catalog=prior;report.fingerprints=after
  await db.query('COMMIT');report.committed=true
  // A fresh snapshot detects concurrent activity; never silently rebaseline it.
  assert.deepEqual(await fingerprints(db),after,'CONCURRENT_ACTIVITY_AFTER_APPLY_STOP')
  report.success=true
}catch(e){await db.query('ROLLBACK').catch(()=>{});report.error={code:e.code??'ASSERTION',message:e.message.split('\n')[0].slice(0,250)};process.exitCode=1}
finally{await db.end();writeFileSync(out+(local?'/apply-local.json':'/apply-production.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({success:report.success,committed:report.committed,target:report.ref,steps:report.steps,backfill:report.expectedBackfill,error:report.error}))}
