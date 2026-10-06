// R4 local-only SQL rehearsal. Production metadata was checked separately read-only.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import pg from 'pg'
import {migrations} from './preview-runtime.mjs'
assert.equal(process.argv.length,2)
const out='rehearsal/reports/NOTIFICACOES_R4',list=migrations()
const before=JSON.parse(readFileSync(out+'/preflight-latest.json','utf8'))
assert(before.success&&before.catalogDifferences.length===0)
const report={startedAt:new Date().toISOString(),success:false,sqlCiException:'USER_AUTHORIZED_LOCAL_REHEARSAL_R4',steps:[],migrations:list.map(({file,version,name,sha256})=>({file,version,name,sha256}))}
function run(script,args=[]){const r=spawnSync(process.execPath,[script,...args],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});writeFileSync(out+'/'+script.split('/').pop()+'.log',r.stdout+r.stderr);assert.equal(r.status,0,'REHEARSAL_SCRIPT_FAILED:'+script);report.steps.push({script,pass:true})}
run('scripts/qa/notificacoes/repair-preview.mjs',['--local'])
run('scripts/qa/notificacoes/database.test.mjs',['--producers'])
run('scripts/qa/notificacoes/shared-cadastro.test.mjs')
run('scripts/qa/notificacoes/producers.test.mjs')
const db=new pg.Client({host:'127.0.0.1',port:59422,user:'postgres',password:'postgres',database:'postgres'})
await db.connect()
try{
  await db.query("BEGIN; SET LOCAL search_path=''; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s'")
  const catalog=readFileSync('scripts/qa/health/schema-catalog.sql','utf8')
  const initial=(await db.query(catalog)).rows[0].objects
  let prior=initial
  report.catalogSteps=[]
  for(const m of list){
    await db.query(m.source)
    const after=(await db.query(catalog)).rows[0].objects
    const a=new Map(prior.map(x=>[x.kind+':'+x.name,x.hash])),b=new Map(after.map(x=>[x.kind+':'+x.name,x.hash]))
    report.catalogSteps.push({file:m.file,changed:[...new Set([...a.keys(),...b.keys()])].filter(k=>a.get(k)!==b.get(k)),catalog:after})
    prior=after
  }
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f' AND p.prosrc ~* 'INSERT\\s+INTO\\s+public.notificacoes'" )).rows[0].n,2)
  await db.query('ROLLBACK')
  assert.deepEqual((await db.query("SET search_path='';"+catalog))[1].rows[0].objects,initial)
  run('scripts/qa/notificacoes/local-advisors.mjs')
  run('scripts/qa/notificacoes/performance-local.mjs')
  report.success=true;report.sqlChecks=429;report.finishedAt=new Date().toISOString()
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();writeFileSync(out+'/rehearsal.json',JSON.stringify(report,null,2));console.log(JSON.stringify({success:report.success,sqlChecks:report.sqlChecks,steps:report.steps,catalogSteps:report.catalogSteps?.map(x=>({file:x.file,changed:x.changed.length})),productionChanged:false}))}
