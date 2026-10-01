// Explicit environment activation, independent from migrations and vercel.json.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {Client} from 'pg'

async function main(){
const args=process.argv.slice(2),file=args.find(x=>x.startsWith('--env-file='))?.slice(11)
assert(file,'ENV_FILE_REQUIRED');assert(args.every(x=>x.startsWith('--env-file=')||['--apply','--remove'].includes(x)))
assert(!(args.includes('--apply')&&args.includes('--remove')))
const e=parseEnv(readFileSync(file,'utf8')),ref=e.EMAIL_INTAKE_EXPECTED_SUPABASE_REF,mode=e.EMAIL_INTAKE_ENVIRONMENT
assert(['preview','homolog'].includes(mode));assert(/^[a-z]{20}$/.test(ref??''))
assert.notEqual(ref,'wwsndnuvnjuabpbjwlck','PRODUCTION_FORBIDDEN')
assert.equal(e.NEXT_PUBLIC_SUPABASE_URL,`https://${ref}.supabase.co`)
const origin=new URL(e.EMAIL_INTAKE_NOTIFICATION_ORIGIN),dbUrl=new URL(e.EMAIL_INTAKE_DATABASE_URL)
assert.equal(origin.protocol,'https:');assert.equal(origin.pathname,'/');assert(!origin.search&&!origin.hash&&!origin.username&&!origin.password)
assert(dbUrl.hostname===`db.${ref}.supabase.co`||decodeURIComponent(dbUrl.username).endsWith('.'+ref))
assert((e.EMAIL_INTAKE_JOB_SECRET?.length??0)>=48)
const tasks={delta:'* * * * *',reconciliation:'* * * * *',subscriptions:'*/5 * * * *',health:'*/5 * * * *',attachments:'* * * * *',visual:'* * * * *'}
const prefix='email04-'+ref,secretNames={origin:prefix+'-origin',token:prefix+'-token'}
const db=new Client({connectionString:dbUrl.href,connectionTimeoutMillis:15000,statement_timeout:30000})
const report={at:new Date().toISOString(),ref,environment:mode,action:args.includes('--apply')?'ACTIVATE':args.includes('--remove')?'REMOVE':'PREFLIGHT',result:'RUNNING',productionChanged:false}
try{
 await db.connect()
 if(report.action==='PREFLIGHT'){
  const extensions=(await db.query("select name,installed_version from pg_available_extensions where name in('pg_cron','pg_net','supabase_vault')")).rows
  assert.equal(extensions.length,3);report.extensions=extensions
  report.jobs=(await db.query("select jobname,schedule,active from cron.job where jobname like $1",[prefix+'-%']).catch(()=>({rows:[]}))).rows
 }else{
  if(report.action==='ACTIVATE'){
   const login=await fetch(new URL('/login',origin),{signal:AbortSignal.timeout(15000)});assert.equal(login.status,200)
   assert(login.headers.get('content-security-policy')?.includes(ref),'DEPLOYMENT_MUST_MATCH_DATABASE')
   const hook=await fetch(new URL('/api/email-intake/graph?validationToken=email04-scheduler-preflight',origin),{method:'POST',signal:AbortSignal.timeout(15000)})
   assert.equal(hook.status,200);assert.equal(await hook.text(),'email04-scheduler-preflight')
  }
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'")
  if(report.action==='ACTIVATE'){
   await db.query('CREATE EXTENSION IF NOT EXISTS pg_cron');await db.query('CREATE EXTENSION IF NOT EXISTS pg_net');await db.query('CREATE EXTENSION IF NOT EXISTS supabase_vault')
   for(const [name,value] of [[secretNames.origin,origin.origin],[secretNames.token,e.EMAIL_INTAKE_JOB_SECRET]]){
    const existing=(await db.query('select id from vault.secrets where name=$1',[name])).rows
    assert(existing.length<=1)
    if(existing.length)await db.query('select vault.update_secret($1,$2,$3,$4)',[existing[0].id,value,name,'RLX EMAIL04 '+mode])
    else await db.query('select vault.create_secret($1,$2,$3)',[value,name,'RLX EMAIL04 '+mode])
   }
   // Values below are validated identifiers, never a token or connection string.
   await db.query(`create or replace function private.email04_dispatch(p_task text) returns bigint language plpgsql security definer set search_path='' as $body$
    declare endpoint text; bearer text; request_id bigint;
    begin
     if p_task not in('delta','reconciliation','subscriptions','health','attachments','visual') then raise exception 'EMAIL_INVALID_TASK'; end if;
     select decrypted_secret into endpoint from vault.decrypted_secrets where name='${secretNames.origin}';
     select decrypted_secret into bearer from vault.decrypted_secrets where name='${secretNames.token}';
     if endpoint is null or bearer is null then raise exception 'EMAIL_SCHEDULER_UNCONFIGURED'; end if;
     select net.http_post(url:=endpoint||'/api/cron/email-intake/'||p_task,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||bearer),body:='{}'::jsonb,timeout_milliseconds:=240000) into request_id;
     return request_id;
    end; $body$`)
   await db.query('revoke all on function private.email04_dispatch(text) from public,anon,authenticated,service_role')
   for(const [task,schedule] of Object.entries(tasks))await db.query('select cron.schedule($1,$2,$3)',[prefix+'-'+task,schedule,`select private.email04_dispatch('${task}')`])
  }else{
   for(const task of Object.keys(tasks)){const found=(await db.query('select jobid from cron.job where jobname=$1',[prefix+'-'+task])).rows;for(const row of found)await db.query('select cron.unschedule($1)',[row.jobid])}
   await db.query('drop function if exists private.email04_dispatch(text)')
   await db.query('delete from vault.secrets where name=any($1::text[])',[Object.values(secretNames)])
  }
  await db.query('COMMIT')
  report.jobs=(await db.query('select jobname,schedule,active from cron.job where jobname like $1',[prefix+'-%'])).rows
  assert.equal(report.jobs.length,report.action==='ACTIVATE'?6:0)
 }
 report.result='PASS'
}catch(error){await db.query('ROLLBACK').catch(()=>{});report.result='FAIL';report.code=error.code??error.name;process.exitCode=1}
finally{await db.end().catch(()=>{});mkdirSync('rehearsal/reports',{recursive:true});writeFileSync(`rehearsal/reports/email04-scheduler-${mode}-${report.action.toLowerCase()}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))}
}
main().catch(error=>{console.error(JSON.stringify({result:'FAIL',code:error.code??error.name}));process.exitCode=1})
