import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {Client} from 'pg'
import {verifySubscriptionRecovery} from './subscription-recovery-db.mjs'

export async function verifyEmailAutomation(db, connection) {
  assert.equal(connection.host,'127.0.0.1');assert.equal(connection.port,57842)
  const id=randomUUID(),fund='22000000-0000-4000-8000-000000000001',user='21000000-0000-4000-8000-000000000003'
  const tenant=randomUUID(),mailbox=randomUUID(),checks=[],clients=[]
  await db.query(`insert into private.email_integrations(id,fundo_id,name,provider,mailbox_address,enabled,start_at,scope_verified_at,scope_evidence_hash,credential_env_ref,created_by)
    values($1,$2,'EMAIL04 disposable','OUTLOOK_GRAPH','qa@example.invalid',true,now()-interval '7 days',now(),repeat('a',64),'EMAIL_INTAKE_QA_TEST',$3)`,[id,fund,user])
  await db.query(`insert into private.email_automation(integration_id,enabled,tenant_id,mailbox_object_id,subscription_resource) values($1,true,$2,$3,$4)`,[id,tenant,mailbox,`users/${mailbox}/mailFolders/inbox/messages`])
  const rpc=async(sql,values=[],client=db)=>(await client.query('select public.'+sql+' r',values)).rows[0].r
  const signal=kind=>rpc('email_automation_signal($1)',[JSON.stringify([{integrationId:id,kind,dedupeKey:({DELTA:'a',RENEW:'b',RECREATE:'c'}[kind]).repeat(64)}])])
  const claim=kind=>rpc('email_automation_claim($1)',[kind])
  const fail=(job,code='PROVIDER_UNAVAILABLE',retry=true,reset=false,ms=1000)=>rpc('email_automation_fail($1,$2,$3,$4,$5,$6)',[id,job.token,code,ms,retry,reset])
  const due=()=>db.query("update private.email_sync_state set next_run_at=now()-interval '1 second' where integration_id=$1",[id])
  const message={externalId:'synthetic-message',receivedAt:new Date().toISOString(),hasAttachments:true,attachments:[{externalId:'synthetic-attachment',name:'qa.xml',contentType:'application/xml',size:123,inline:false,kind:'FILE'}]}
  const commit=(job,complete,messages=[message])=>rpc('email_automation_commit_page($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,job.token,job.kind,job.discoveryToken,job.revision,JSON.stringify(messages),complete&&job.kind==='RECONCILIATION'?null:'opaque-protected-cursor',complete&&job.kind==='RECONCILIATION'?null:'qa-version',complete])
  try{
    for(let i=0;i<3;i++){const c=new Client(connection);await c.connect();await c.query('set role service_role');clients.push(c)}
    const races=await Promise.all(clients.map(c=>rpc('email_automation_claim($1)',['DELTA'],c)))
    assert.equal(races.filter(Boolean).length,1);const winner=races.find(Boolean)
    assert.equal(await claim('RECONCILIATION'),null);assert.equal(await claim('SUBSCRIPTION'),null)
    await fail(winner,'PROVIDER_UNAVAILABLE',true,false,60000);checks.push('ONE_INTEGRATION_ONE_JOB_REAL_CONCURRENCY')
    await signal('DELTA');await signal('DELTA')
    assert.equal((await db.query('select signal_version from private.email_automation where integration_id=$1',[id])).rows[0].signal_version,'1')
    assert.equal((await db.query('select count(*)::int n from private.email_wakeups where integration_id=$1',[id])).rows[0].n,1)
    assert.equal(await claim('DELTA'),null,'signals must respect retry delay');await due()
    let job=await claim('DELTA');await commit(job,false)
    const next=await claim('DELTA');assert.equal(next.cursorCiphertext,'opaque-protected-cursor');assert.equal(next.revision,1)
    await assert.rejects(commit(job,true),/EMAIL_LEASE_LOST/);await commit(next,true)
    assert.equal((await db.query('select count(*)::int n from private.email_intake_messages where integration_id=$1',[id])).rows[0].n,1)
    assert.equal((await db.query('select count(*)::int n from private.email_wakeups where integration_id=$1',[id])).rows[0].n,0)
    checks.push('WEBHOOK_REPLAY_COALESCING','PAGE_CHECKPOINT_RESUME_FENCING')
    job=await claim('RECONCILIATION');await commit(job,false,[message,{...message,externalId:'recovered-gap',attachments:[]}]);job=await claim('RECONCILIATION');await commit(job,true,[])
    let state=(await db.query('select reconciliation_result from private.email_automation where integration_id=$1',[id])).rows[0]
    assert.deepEqual(state.reconciliation_result,{scanned:2,missing:1,recovered:1,duplicates:1,errors:0})
    assert.equal((await db.query("select discovery_source from private.email_intake_messages where integration_id=$1 and external_id='recovered-gap'",[id])).rows[0].discovery_source,'RECONCILIATION')
    await due();job=await claim('RECONCILIATION');await commit(job,true,[message]);state=(await db.query('select reconciliation_result from private.email_automation where integration_id=$1',[id])).rows[0]
    assert.equal(state.reconciliation_result.recovered,0);assert.equal(state.reconciliation_result.duplicates,1)
    checks.push('RECONCILIATION_PAGINATED_GAP_COUNTERS_IDEMPOTENT')
    job=await claim('DELTA');await fail(job,'CURSOR_EXPIRED',true,true);await due();job=await claim('DELTA');assert.equal(job.cursorCiphertext,null)
    await fail(job,'THROTTLED',true,false,3600000);await signal('DELTA');assert.equal(await claim('DELTA'),null)
    await due();job=await claim('DELTA');await fail(job,'AUTHENTICATION',false);await due();assert.equal(await claim('DELTA'),null)
    checks.push('CURSOR_INVALIDATION_SAFE_RESET','RETRY_AFTER_NOT_OVERRIDDEN','PERMANENT_FAILURE_NO_INFINITE_RETRY')
    job=await claim('SUBSCRIPTION');assert(job)
    await rpc('email_automation_prepare_subscription($1,$2,$3,$4)',[id,job.token,'encrypted-client-state','qa-version'])
    await rpc('email_automation_complete_subscription($1,$2,$3,$4)',[id,job.token,'qa-subscription',new Date(Date.now()+6*86400000).toISOString()])
    assert.equal(await claim('SUBSCRIPTION'),null)
    await signal('RENEW');job=await claim('SUBSCRIPTION');assert(job)
    await fail(job,'THROTTLED',true,false,3600000);await signal('RECREATE');assert.equal(await claim('SUBSCRIPTION'),null)
    checks.push('SUBSCRIPTION_RENEWAL_MARGIN_LIFECYCLE_RETRY_GUARD')
    const apply=alerts=>rpc('email_automation_apply_health($1,$2,$3)',[id,alerts.length?'DEGRADED':'HEALTHY',alerts])
    await apply(['STALE_SYNC']);await apply(['STALE_SYNC']);await apply([]);await apply(['STALE_SYNC'])
    assert.equal((await db.query("select count(*)::int n from private.email_operational_events where integration_id=$1 and event='EMAIL_ALERT_RAISED'",[id])).rows[0].n,1)
    await db.query("update private.email_operational_alerts set last_notified_at=now()-interval '2 hours' where integration_id=$1",[id]);await apply(['STALE_SYNC'])
    assert.equal((await db.query("select count(*)::int n from private.email_operational_events where integration_id=$1 and event='EMAIL_ALERT_RAISED'",[id])).rows[0].n,2)
    await apply([]);assert.equal((await db.query('select active from private.email_operational_alerts where integration_id=$1',[id])).rows[0].active,false)
    const snapshots=await rpc('email_automation_health_snapshots()');assert.equal(snapshots.find(x=>x.integrationId===id).pendingCount,1)
    checks.push('HEALTH_REAL_BACKLOG','ALERT_COOLDOWN_RESOLUTION')
    for(const role of ['anon','authenticated','service_role'])for(const table of ['email_automation','email_operational_events','email_operational_alerts','email_webhook_receipts','email_webhook_limits'])assert.equal((await db.query('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\') ok',[role,'private.'+table])).rows[0].ok,false)
    await clients[0].query('reset role');await clients[0].query('set role authenticated')
    await clients[0].query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role:'authenticated',aal:'aal1'})])
    await assert.rejects(rpc('email_automation_operator_health($1)',[fund],clients[0]),/EMAIL_ACCESS_DENIED/)
    await assert.rejects(rpc('email_automation_manual_sync($1)',[id],clients[0]),/EMAIL_ACCESS_DENIED/)
    checks.push('PRIVATE_TABLES_NO_BROWSER_GRANTS','OPERATOR_SCOPE_AND_MFA_DENIED')
    const gestor='21000000-0000-4000-8000-000000000004',session=randomUUID(),factor=randomUUID(),otherFund=randomUUID(),otherIntegration=randomUUID()
    await db.query(`insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at)
      values($1,$2,'Disposable EMAIL04','totp','verified',now(),now())`,[factor,gestor])
    await db.query(`insert into auth.sessions(id,user_id,aal,factor_id,created_at,updated_at)
      values($1,$2,'aal2',$3,now(),now())`,[session,gestor,factor])
    await db.query(`insert into public.sessoes_elevadas(user_id,session_id,metodo,factor_id,elevada_em,expira_em)
      values($1,$2,'totp',$3,now(),now()+interval '1 hour')`,[gestor,session,factor])
    await clients[0].query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:gestor,role:'authenticated',aal:'aal2',session_id:session})])
    const operatorRows=await rpc('email_automation_operator_health($1)',[fund],clients[0])
    assert.equal(operatorRows.length,1);assert.equal(operatorRows[0].integrationId,id)
    await db.query("delete from private.email_wakeups where integration_id=$1 and kind='DELTA'",[id])
    assert.equal(await rpc('email_automation_manual_sync($1)',[id],clients[0]),true)
    assert.equal(await rpc('email_automation_manual_sync($1)',[id],clients[0]),false)
    assert.equal((await db.query("select count(*)::int n from public.logs_auditoria where entidade_id=$1 and tipo_evento='EMAIL_MANUAL_SYNC_REQUESTED'",[id])).rows[0].n,1)
    assert.equal(await claim('DELTA'),null,'manual request must not bypass permanent quarantine')
    await db.query(`insert into public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
      select $1,'EMAIL04 other fund','98000000000439',administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,true from public.fundos where id=$2`,[otherFund,fund])
    await db.query(`insert into private.email_integrations(id,fundo_id,name,provider,mailbox_address,enabled,start_at,scope_verified_at,scope_evidence_hash,credential_env_ref,created_by)
      values($1,$2,'EMAIL04 other integration','OUTLOOK_GRAPH','other@example.invalid',true,now(),now(),repeat('b',64),'EMAIL_INTAKE_QA_TEST',$3)`,[otherIntegration,otherFund,gestor])
    await assert.rejects(rpc('email_automation_operator_health($1)',[otherFund],clients[0]),/EMAIL_ACCESS_DENIED/)
    await assert.rejects(rpc('email_automation_manual_sync($1)',[otherIntegration],clients[0]),/EMAIL_ACCESS_DENIED/)
    await db.query('update public.sessoes_elevadas set revogada_em=now() where session_id=$1',[session])
    await assert.rejects(rpc('email_automation_operator_health($1)',[fund],clients[0]),/EMAIL_ACCESS_DENIED/)
    await db.query('update public.sessoes_elevadas set revogada_em=null where session_id=$1',[session])
    await db.query("update public.profiles set role='super_admin' where id=$1",[gestor])
    try{assert.deepEqual(await rpc('email_automation_operator_health($1)',[otherFund],clients[0]),[])}
    finally{await db.query("update public.profiles set role='gestor' where id=$1",[gestor])}
    checks.push('GESTOR_MFA_MANUAL_SYNC_AUDIT_COOLDOWN','CROSS_FUND_DENIED','REVOKED_MFA_DENIED','SUPER_ADMIN_SCOPED_ACCESS')
    checks.push(...await verifySubscriptionRecovery(db,id,rpc))
    return checks
  }finally{
    for(const c of clients)await c.end()
    await db.query('update private.email_automation set enabled=false where integration_id=$1',[id])
    // The following 03 smoke consumes the same local attachment queue.
    await db.query('update private.email_integrations set enabled=false where id=$1',[id])
  }
}
