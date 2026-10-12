import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'

/** Disposable local fixture only; operational SQL runs through the real service RPCs. */
export async function verifySubscriptionRecovery(db,id,rpc) {
  const checks=[]
  const signal=(event,kind)=>rpc('email_automation_signal($1)',[JSON.stringify([{integrationId:id,kind,lifecycleEvent:event,dedupeKey:randomBytes(32).toString('hex')}])])
  const pending=async()=>(await rpc('email_automation_health_snapshots()')).find(s=>s.integrationId===id).lifecyclePending
  const events=async event=>(await db.query('select count(*)::int n from private.email_operational_events where integration_id=$1 and event=$2',[id,event])).rows[0].n
  const complete=async name=>{
    const job=await rpc('email_automation_claim($1)',['SUBSCRIPTION']);assert(job)
    await rpc('email_automation_complete_subscription($1,$2,$3,$4)',[id,job.token,name,new Date(Date.now()+6*86400000).toISOString()])
  }
  await db.query("update private.email_automation set blocked_modes='{}',subscription_error=null,subscription_failures=0,health_status='HEALTHY',subscription_next_at=now() where integration_id=$1",[id])
  await signal('reauthorizationRequired','RENEW');assert.equal(await pending(),true)
  assert.equal((await db.query('select health_status from private.email_automation where integration_id=$1',[id])).rows[0].health_status,'DEGRADED')
  await complete('qa-subscription');assert.equal(await pending(),false)
  assert.equal(await rpc('email_automation_claim($1)',['SUBSCRIPTION']),null,'renewal margin')
  await assert.rejects(signal('missed','RENEW'),/EMAIL_INVALID_SIGNAL/)
  checks.push('LIFECYCLE_HEALTH_UNTIL_RENEWAL_SUCCESS')
  const recoveredBefore=await events('EMAIL_SUBSCRIPTION_RECOVERED')

  await db.query("update private.email_integrations set subscription_expires_at=now()-interval '1 minute' where id=$1",[id])
  await rpc('email_automation_apply_health($1,$2,$3)',[id,'DEGRADED',['SUBSCRIPTION_CRITICAL']])
  await rpc('email_automation_apply_health($1,$2,$3)',[id,'DEGRADED',['SUBSCRIPTION_CRITICAL']])
  assert.equal(await events('EMAIL_SUBSCRIPTION_EXPIRED'),1)
  const before=(await db.query('select cursor_ciphertext,revision from private.email_sync_state where integration_id=$1 and mode=\'DELTA\'',[id])).rows[0]
  await db.query('update private.email_automation set subscription_next_at=now() where integration_id=$1',[id])
  await complete('replacement-subscription')
  assert.equal(await events('EMAIL_SUBSCRIPTION_RECOVERED'),recoveredBefore+1,'one additional expiry recovery')
  assert.equal(await events('EMAIL_SUBSCRIPTION_EXPIRED'),1)
  assert.deepEqual((await db.query('select cursor_ciphertext,revision from private.email_sync_state where integration_id=$1 and mode=\'DELTA\'',[id])).rows[0],before)
  assert.equal((await db.query("select count(*)::int n from private.email_wakeups where integration_id=$1 and kind='DELTA'",[id])).rows[0].n,1)
  checks.push('SUBSCRIPTION_EXPIRY_EVENT_DEDUPED','SUBSCRIPTION_RECOVERY_PRESERVES_CURSOR_REQUESTS_DELTA')

  await signal('reauthorizationRequired','RENEW')
  await signal('missed','DELTA');assert.equal(await pending(),true)
  // A subscription success cannot hide a still-pending missed-message recovery.
  await complete('replacement-subscription')
  assert.equal(await pending(),true)
  await db.query('update private.email_sync_state set next_run_at=now(),last_error_code=null where integration_id=$1',[id])
  const job=await rpc('email_automation_claim($1)',['DELTA']);assert(job)
  await rpc('email_automation_commit_page($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,job.token,'DELTA',job.discoveryToken,job.revision,'[]','new-encrypted-delta','qa-version',true])
  assert.equal(await pending(),false)
  checks.push('MISSED_LIFECYCLE_ONLY_RESOLVES_AFTER_DELTA')

  await signal('subscriptionRemoved','RECREATE');assert.equal(await pending(),true)
  await complete('second-replacement');assert.equal(await pending(),false)
  assert.equal(await events('EMAIL_SUBSCRIPTION_RECOVERED'),recoveredBefore+2,'one additional removal recovery')
  for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'private.email_observe_subscription_expiry(uuid)','EXECUTE') ok",[role])).rows[0].ok,false)
  checks.push('REMOVED_LIFECYCLE_RECOVERY','EXPIRY_HELPER_NOT_CLIENT_CALLABLE')
  return checks
}
