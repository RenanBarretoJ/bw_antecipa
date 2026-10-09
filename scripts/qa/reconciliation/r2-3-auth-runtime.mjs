import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {Client} from 'pg'
import {setTimeout as delay} from 'node:timers/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {resolve} from 'node:path'
import {freshMappingStack} from './r2-2-fresh-stack.mjs'
import {applyR116} from './r1-16-forwards.mjs'
import {applyAuthFix} from './r1-16-auth-forward.mjs'
import {inventory,nativeSupabaseCli} from '../../email-intake/disposable-resources.mjs'
import {redactCommandOutput,sanitizedLocalEnvironment} from '../../perf9e/clean-room-lib.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const hash=x=>createHash('sha256').update(x).digest('hex')
const migrationPath='supabase/migrations/20261009123943_r2_3_revalidar_sessao_consumo_autorizacao.sql'
const report=`rehearsal/reports/R2_3_AUTH_RUNTIME_FIXED_${Date.now()}.json`
const out={at:new Date().toISOString(),status:'IN_PROGRESS',remoteCalls:0,stacks:[],checks:[],fixtures:[],limitations:['Synthetic Auth session rows model verified sessions; no real passwords/TOTP or remote users are used.','Reference is the saved homolog checkpoint, not a new remote certification.']}
const save=()=>writeFile(report,JSON.stringify(out,null,2)+'\n')
const before=await inventory()
let stack,db,catalogBefore,activeCase='BOOTSTRAP'
const peers=[]
const names=['registrar_sessao_mfa_atual','obter_sessao_mfa_atual','revogar_sessao_mfa_atual','criar_autorizacao_acao_sensivel','consumir_autorizacao_acao_sensivel','handle_new_user','sessoes_elevadas','autorizacoes_acoes_sensiveis','profiles']
const normalize=o=>({...o,definition:typeof o.definition==='string'?o.definition.replaceAll('\r\n','\n'):o.definition})
const selected=rows=>rows.filter(o=>o.schema==='public'&&names.includes(o.name)&&['function','relation'].includes(o.kind)).map(normalize)
const a={id:'41000000-0000-4000-8000-000000000001',session:'42000000-0000-4000-8000-000000000001',factor:'43000000-0000-4000-8000-000000000001',email:'r23-mfa-a@example.invalid'}
const b={id:'41000000-0000-4000-8000-000000000002',session:'42000000-0000-4000-8000-000000000002',factor:'43000000-0000-4000-8000-000000000002',email:'r23-mfa-b@example.invalid'}
const otherSession='42000000-0000-4000-8000-000000000003'
const action='encerrar_outras_sessoes'
const nonce=n=>hash('local-synthetic-r23-'+n)
async function asActor(actor,sql,params=[]){
  await db.query('SAVEPOINT actor_call')
  await db.query('SET LOCAL ROLE authenticated')
  try{
    await db.query("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",[JSON.stringify({sub:actor.id,role:'authenticated',aal:'aal2',session_id:actor.session,amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]}),actor.id])
    const proof=(await db.query("SELECT current_user role,auth.uid()::text uid,rolsuper,rolbypassrls,pg_has_role(current_user,'postgres','MEMBER') owner_member FROM pg_roles WHERE rolname=current_user")).rows[0]
    assert.deepEqual(proof,{role:'authenticated',uid:actor.id,rolsuper:false,rolbypassrls:false,owner_member:false})
    return await db.query(sql,params)
  } catch(e){
    // Restore the local transaction before RESET ROLE; retain the original SQLSTATE.
    await db.query('ROLLBACK TO SAVEPOINT actor_call')
    throw e
  } finally {await db.query('RESET ROLE');await db.query('RELEASE SAVEPOINT actor_call')}
}
async function allow(actor,n){return asActor(actor,'SELECT * FROM public.criar_autorizacao_acao_sensivel($1,$2)',[action,nonce(n)])}
async function consume(actor,n,kind=action){return (await asActor(actor,'SELECT public.consumir_autorizacao_acao_sensivel($1,$2) value',[kind,nonce(n)])).rows[0].value}
async function state(actor){return (await asActor(actor,'SELECT * FROM public.obter_sessao_mfa_atual()')).rows[0]}
async function denied(sql,params,actor=a){
  await db.query('SAVEPOINT expected_denial')
  let code
  try{await asActor(actor,sql,params)}catch(e){code=e.code}
  finally{await db.query('ROLLBACK TO SAVEPOINT expected_denial');await db.query('RESET ROLE')}
  assert.equal(code,'42501')
}
function validateProfile(rows,actor){assert.equal(rows.length,1,'AUTO_PROFILE_CARDINALITY');assert.deepEqual(rows[0],{id:actor.id,email:actor.email,nome_completo:actor.email,role:'cedente',status:'ativo'},'AUTO_PROFILE_CRITICAL_ATTRIBUTE_DRIFT')}
async function check(name,fn){
  activeCase=name
  await db.query('SAVEPOINT case_start')
  try{const detail=await fn();out.checks.push({name,status:'PASS',actorRole:'authenticated',detail});console.log(JSON.stringify({test:name,status:'PASS'}))}
  catch(e){out.checks.push({name,status:'FAIL',code:e.code,message:redactCommandOutput(e.message)});throw e}
  finally{await db.query('ROLLBACK TO SAVEPOINT case_start');await db.query('RESET ROLE');await save()}
}
async function seed(){
  for(const actor of [a,b]){
    await db.query("INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES($1,$2,'{}','{}',now(),now())",[actor.id,actor.email])
    const profile=(await db.query('SELECT id::text,email,nome_completo,role::text,status::text FROM public.profiles WHERE id=$1',[actor.id])).rows
    validateProfile(profile,actor)
    assert.throws(()=>validateProfile([{...profile[0],role:'gestor'}],actor),/AUTO_PROFILE_CRITICAL_ATTRIBUTE_DRIFT/)
    out.fixtures.push({actor:actor.id,initial:profile[0],testState:profile[0],profileUpdated:false,negativeAttributeGuard:'PASS'})
    await db.query("INSERT INTO auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) VALUES($1,$2,'totp','verified',now(),now())",[actor.factor,actor.id])
    await createSession(actor)
  }
}
async function createSession(actor){
  await db.query("INSERT INTO auth.sessions(id,user_id,factor_id,aal,created_at,updated_at) VALUES($1,$2,$3,'aal2',now(),now())",[actor.session,actor.id,actor.factor])
  await asActor(actor,'SELECT * FROM public.registrar_sessao_mfa_atual($1)',[actor.factor])
}
async function peer(){
  assert.equal(stack.connection.host,'127.0.0.1')
  const client=new Client({...stack.connection,application_name:'r23_mfa_concurrency'})
  await client.connect();peers.push(client)
  await client.query("SET statement_timeout='15s';SET lock_timeout='10s';BEGIN;SET LOCAL ROLE authenticated")
  await client.query("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",[JSON.stringify({sub:a.id,role:'authenticated',aal:'aal2',session_id:a.session}),a.id])
  const proof=(await client.query("SELECT pg_backend_pid() pid,current_user role,auth.uid()::text uid,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0]
  assert.deepEqual({...proof,pid:0},{pid:0,role:'authenticated',uid:a.id,rolsuper:false,rolbypassrls:false})
  return {client,pid:proof.pid}
}
async function waitBlocked(pid){
  for(let i=0;i<100;i++){
    const row=(await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]
    if(row?.wait_event_type==='Lock')return
    await delay(30)
  }
  throw new Error('EXPECTED_CONCURRENT_LOCK_WAIT_NOT_OBSERVED')
}
async function concurrentCheck(name,fn){
  activeCase=name
  try{await fn();out.checks.push({name,status:'PASS',actorRole:'authenticated',concurrent:true})}
  catch(e){out.checks.push({name,status:'FAIL',code:e.code,message:redactCommandOutput(e.message)});throw e}
  finally{await db.query('ROLLBACK');for(const p of peers.splice(0)){await p.query('ROLLBACK').catch(()=>{});await p.end()}await save()}
  console.log(JSON.stringify({test:name,status:'PASS'}))
}
async function mint(n){await db.query('BEGIN');await allow(a,n);await db.query('COMMIT')}
const consumePeer=(p,n)=>p.client.query('SELECT public.consumir_autorizacao_acao_sensivel($1,$2) value',[action,nonce(n)])
try{
  stack=await freshMappingStack(out.stacks);db=stack.db
  await applyR116(db,stack.evidence);out.authForward=await applyAuthFix(db)
  catalogBefore=await stack.capture()
  const reference=JSON.parse(await readFile('rehearsal/reports/R2_3_HOMOLOG_CHECKPOINT.json','utf8'))
  const current=selected(catalogBefore).map(o=>{const copy={...o};delete copy.hash;return copy})
  const expected=selected(reference.applicationObjects)
  assert.equal(current.length,9);assert.deepEqual(current,expected,'MFA_REFERENCE_CATALOG_DRIFT')
  out.reference={file:'R2_3_HOMOLOG_CHECKPOINT.json',selectedObjectCount:current.length,sha256:hash(JSON.stringify(current)),normalization:'CRLF_TO_LF_IN_FUNCTION_DEFINITIONS_ONLY',result:'PASS'}
  activeCase='APPLY_INCREMENTAL_FIX'
  const migration=await readFile(migrationPath,'utf8')
  const beforeFix=catalogBefore
  await db.query(migration)
  const afterFix=await stack.capture()
  assert.equal(beforeFix.length,afterFix.length)
  const changed=beforeFix.map((o,i)=>[o,afterFix[i]]).filter(([x,y])=>JSON.stringify(x)!==JSON.stringify(y))
  assert.equal(changed.length,1,'UNRELATED_CATALOG_CHANGE')
  const [oldFn,newFn]=changed[0]
  assert.equal(oldFn.kind,'function');assert.equal(oldFn.name,'consumir_autorizacao_acao_sensivel')
  assert.deepEqual({...oldFn,definition:newFn.definition,hash:newFn.hash},newFn,'FUNCTION_METADATA_OR_GRANTS_CHANGED')
  await db.query(migration)
  assert.deepEqual(await stack.capture(),afterFix,'MIGRATION_NOT_IDEMPOTENT')
  out.migration={path:migrationPath,sha256:hash(migration),idempotence:'PASS',onlyFunctionBodyChanged:true,grantsOwnersPoliciesPreserved:true}
  catalogBefore=afterFix
  out.canonicalTrigger=(await db.query("SELECT tgname,tgenabled,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created'")).rows
  assert.equal(out.canonicalTrigger.length,1);assert.equal(out.canonicalTrigger[0].tgenabled,'O')
  await db.query('BEGIN')
  await seed()
  await check('valid_session_and_fixed_24h_window',async()=>{const x=await state(a);assert.equal(x.status,'valid');assert.equal(x.expira_em-x.elevada_em,86400000);assert.deepEqual((await state(a)).expira_em,x.expira_em)})
  await check('valid_authorization_created_for_five_minutes',async()=>{await allow(a,'ttl');const x=(await db.query('SELECT extract(epoch from expira_em-criada_em)::int seconds FROM public.autorizacoes_acoes_sensiveis WHERE nonce_hash=$1',[nonce('ttl')])).rows[0];assert.equal(x.seconds,300)})
  await check('consume_once_then_replay_denied',async()=>{await allow(a,'replay');assert.equal(await consume(a,'replay'),true);assert.equal(await consume(a,'replay'),false)})
  await check('expired_authorization_denied',async()=>{await allow(a,'expired');await db.query("UPDATE public.autorizacoes_acoes_sensiveis SET criada_em=clock_timestamp()-interval '10 minutes',expira_em=clock_timestamp()-interval '1 second' WHERE nonce_hash=$1",[nonce('expired')]);assert.equal(await consume(a,'expired'),false)})
  await check('revoked_authorization_denied',async()=>{await allow(a,'revoked');await db.query('UPDATE public.autorizacoes_acoes_sensiveis SET revogada_em=clock_timestamp() WHERE nonce_hash=$1',[nonce('revoked')]);assert.equal(await consume(a,'revoked'),false)})
  await check('other_user_denied_original_still_valid',async()=>{await allow(a,'user');assert.equal(await consume(b,'user'),false);assert.equal(await consume(a,'user'),true)})
  await check('other_session_denied_original_still_valid',async()=>{await db.query("INSERT INTO auth.sessions(id,user_id,factor_id,aal,created_at,updated_at) VALUES($1,$2,$3,'aal2',now(),now())",[otherSession,a.id,a.factor]);await allow(a,'session');assert.equal(await consume({...a,session:otherSession},'session'),false);assert.equal(await consume(a,'session'),true)})
  await check('other_action_denied_original_still_valid',async()=>{await allow(a,'action');assert.equal(await consume(a,'action','alterar_senha'),false);assert.equal(await consume(a,'action'),true)})
  await check('direct_nonce_table_access_denied',async()=>{await denied('SELECT * FROM public.autorizacoes_acoes_sensiveis',[])})
  await check('expired_elevation_denies_new_authorization',async()=>{await db.query("UPDATE public.sessoes_elevadas SET elevada_em=clock_timestamp()-interval '25 hours',expira_em=clock_timestamp()-interval '1 hour' WHERE user_id=$1 AND session_id=$2",[a.id,a.session]);assert.equal((await state(a)).status,'expired');await denied('SELECT * FROM public.criar_autorizacao_acao_sensivel($1,$2)',[action,nonce('expired-session')])})
  await check('revocation_invalidates_pending_authorization_and_audits',async()=>{await allow(a,'revoke-session');assert.equal((await asActor(a,"SELECT public.revogar_sessao_mfa_atual('logout') value")).rows[0].value,true);assert.equal((await state(a)).status,'revoked');assert.equal(await consume(a,'revoke-session'),false);const rows=(await db.query("SELECT tipo_evento FROM public.seguranca_eventos WHERE usuario_id=$1 AND tipo_evento='SESSAO_MFA_REVOGADA'",[a.id])).rows;assert.equal(rows.length,1)})
  await check('missing_auth_session_denies_state_and_new_authorization',async()=>{await db.query('DELETE FROM auth.sessions WHERE id=$1',[a.session]);assert.equal((await state(a)).status,'session_invalid');await denied('SELECT * FROM public.criar_autorizacao_acao_sensivel($1,$2)',[action,nonce('missing-session')])})
  await check('unverified_factor_denies_state_and_new_authorization',async()=>{await db.query("UPDATE auth.mfa_factors SET status='unverified' WHERE id=$1",[a.factor]);assert.equal((await state(a)).status,'factor_invalid');await denied('SELECT * FROM public.criar_autorizacao_acao_sensivel($1,$2)',[action,nonce('factor')])})
  await check('auth_session_past_not_after_denied',async()=>{await db.query("UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=$1",[a.session]);assert.equal((await state(a)).status,'session_invalid')})
  await check('consumption_after_auth_session_removed_denied',async()=>{await allow(a,'removed-consume');await db.query('DELETE FROM auth.sessions WHERE id=$1',[a.session]);assert.equal((await state(a)).status,'session_invalid');const actual=await consume(a,'removed-consume');out.removedSessionConsumption={expected:false,actual};assert.equal(actual,false,'CONSUMED_AUTHORIZATION_WITH_MISSING_AUTH_SESSION')})
  for(const [name,sql,params] of [
    ['expired_elevation',"UPDATE public.sessoes_elevadas SET elevada_em=clock_timestamp()-interval '25 hours',expira_em=clock_timestamp()-interval '1 hour' WHERE session_id=$1",[a.session]],
    ['revoked_elevation',"UPDATE public.sessoes_elevadas SET revogada_em=clock_timestamp() WHERE session_id=$1",[a.session]],
    ['missing_elevation','DELETE FROM public.sessoes_elevadas WHERE session_id=$1',[a.session]],
    ['aal1_session',"UPDATE auth.sessions SET aal='aal1' WHERE id=$1",[a.session]],
    ['expired_auth_session',"UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=$1",[a.session]],
    ['unverified_factor',"UPDATE auth.mfa_factors SET status='unverified' WHERE id=$1",[a.factor]],
  ])await check('consume_denied_'+name,async()=>{await allow(a,name);await db.query(sql,params);assert.equal(await consume(a,name),false);assert.equal((await db.query('SELECT consumida_em FROM public.autorizacoes_acoes_sensiveis WHERE nonce_hash=$1',[nonce(name)])).rows[0].consumida_em,null)})
  await check('malformed_or_missing_session_denied',async()=>{await allow(a,'malformed');for(const session of ['invalid',null])assert.equal(await consume({...a,session},'malformed'),false);assert.equal(await consume(a,'malformed'),true)})
  await check('unknown_nonce_and_action_denied',async()=>{assert.equal(await consume(a,'unknown'),false);await allow(a,'unknown-action');assert.equal(await consume(a,'unknown-action','unknown'),false);assert.equal(await consume(a,'unknown-action'),true)})
  await db.query('ROLLBACK')
  // Independent connections require committed synthetic fixtures, confined to this fresh stack.
  await db.query('BEGIN');await seed();await db.query('COMMIT')
  await concurrentCheck('two_consumers_exactly_one_success',async()=>{
    await mint('parallel');const first=await peer(),second=await peer()
    assert.equal((await consumePeer(first,'parallel')).rows[0].value,true)
    const pending=consumePeer(second,'parallel');pending.catch(()=>{})
    await waitBlocked(second.pid);await first.client.query('COMMIT')
    assert.equal((await pending).rows[0].value,false);await second.client.query('COMMIT')
  })
  await concurrentCheck('auth_deletion_commits_before_consumer_denied',async()=>{
    await mint('delete-race');const consumer=await peer()
    await db.query('BEGIN');await db.query('DELETE FROM auth.sessions WHERE id=$1',[a.session])
    const pending=consumePeer(consumer,'delete-race');pending.catch(()=>{})
    await waitBlocked(consumer.pid);await db.query('COMMIT')
    assert.equal((await pending).rows[0].value,false);await consumer.client.query('COMMIT')
  })
  await db.query('BEGIN');await createSession(a);await db.query('COMMIT')
  await concurrentCheck('revocation_commits_before_consumer_denied',async()=>{
    await mint('revoke-race');const revoker=await peer(),consumer=await peer()
    assert.equal((await revoker.client.query("SELECT public.revogar_sessao_mfa_atual('logout') value")).rows[0].value,true)
    const pending=consumePeer(consumer,'revoke-race');pending.catch(()=>{})
    await waitBlocked(consumer.pid);await revoker.client.query('COMMIT')
    assert.equal((await pending).rows[0].value,false);await consumer.client.query('COMMIT')
  })
  await db.query('BEGIN');await asActor(a,'SELECT * FROM public.registrar_sessao_mfa_atual($1)',[a.factor]);await db.query('COMMIT')
  await concurrentCheck('consumer_first_revocation_waits_then_succeeds',async()=>{
    await mint('consumer-first');const consumer=await peer(),revoker=await peer()
    assert.equal((await consumePeer(consumer,'consumer-first')).rows[0].value,true)
    const pending=revoker.client.query("SELECT public.revogar_sessao_mfa_atual('logout') value");pending.catch(()=>{})
    await waitBlocked(revoker.pid);await consumer.client.query('COMMIT')
    assert.equal((await pending).rows[0].value,true);await revoker.client.query('COMMIT')
  })
  await db.query('BEGIN');await asActor(a,'SELECT * FROM public.registrar_sessao_mfa_atual($1)',[a.factor]);await db.query('COMMIT')
  await concurrentCheck('mfa_expiry_while_waiting_for_nonce_denied',async()=>{
    await mint('wait-expire')
    await db.query("UPDATE public.sessoes_elevadas SET elevada_em=clock_timestamp()-interval '1 hour',expira_em=clock_timestamp()+interval '2 seconds' WHERE session_id=$1",[a.session])
    const consumer=await peer()
    await db.query('BEGIN');await db.query('SELECT id FROM public.autorizacoes_acoes_sensiveis WHERE nonce_hash=$1 FOR UPDATE',[nonce('wait-expire')])
    const pending=consumePeer(consumer,'wait-expire');pending.catch(()=>{})
    await waitBlocked(consumer.pid);await db.query('SELECT pg_sleep(2.1)');await db.query('COMMIT')
    assert.equal((await pending).rows[0].value,false);await consumer.client.query('COMMIT')
  })
  assert.deepEqual(await stack.capture(),catalogBefore,'CATALOG_CHANGED_BY_TEST')
  activeCase='LOCAL_ADVISORS'
  const env=sanitizedLocalEnvironment();for(const key of Object.keys(env))if(/SUPABASE|DATABASE|POSTGRES|SECRET|PASSWORD|TOKEN|CREDENTIAL|OPENAI/i.test(key))delete env[key]
  const advisor=await promisify(execFile)(await nativeSupabaseCli(),['db','advisors','--local','--type','security','--fail-on','none','--workdir',resolve('rehearsal/tmp',stack.spec.projectId),'-o','json'],{env,windowsHide:true,timeout:45000,maxBuffer:8*1024*1024})
  out.advisors={executed:true,output:redactCommandOutput(advisor.stdout),stderr:redactCommandOutput(advisor.stderr)}
  out.status='PASS';stack.evidence.result='PASS'
}catch(e){out.status='FAIL_STOPPED';out.failure={stage:activeCase,code:e.code??'ASSERTION',message:redactCommandOutput(e.message)};process.exitCode=1}
finally{
  for(const p of peers.splice(0)){await p.query('ROLLBACK').catch(()=>{});await p.end().catch(()=>{})}
  if(db){await db.query('ROLLBACK').catch(()=>{});if(catalogBefore){out.catalogPreserved=JSON.stringify(await stack.capture())===JSON.stringify(catalogBefore);assert.equal(out.catalogPreserved,true)}}
  await stack?.close()
  assert.deepEqual(await inventory(),before,'PREEXISTING_DOCKER_RESOURCES_CHANGED')
  out.cleanup='PASS';out.preexistingPreserved=true;await save()
}
console.log(JSON.stringify({report,status:out.status,checks:out.checks.length,failure:out.failure,cleanup:out.cleanup}))
