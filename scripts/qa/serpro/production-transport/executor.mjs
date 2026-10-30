import assert from 'node:assert/strict'
import {assertPlan,validateSources,sourceEnvelope,selection,timeoutPolicy,hash} from './contract.mjs'
import {assertFactory} from './connection.mjs'
import {assertJournal} from './journal.mjs'
import {inspect,verifySnapshot,verifyConnectionIdentity} from './inspection.mjs'
import {classifyError as classifyR46} from '../selective-transport/executor.mjs'

export function classifyFailure(error){
  const code=String(error?.code??'')
  if(/CERT|TLS|SSL|UNABLE_TO_VERIFY_LEAF_SIGNATURE/.test(code))return {reason:'TLS_VERIFICATION_FAILED',sqlstate:null,errorKind:'TRANSPORT'}
  if(String(error?.message??'').includes('R48_'))return {reason:String(error.message).match(/R48_[A-Z_]+/)?.[0]??'R48_GUARD_REJECTED',sqlstate:/^[A-Z0-9]{5}$/.test(code)?code:null,errorKind:'GUARD'}
  return classifyR46(error)
}

export async function observe(plan,factory) {
  assertFactory(factory,plan)
  const c=await factory.connect()
  try {
    await c.query("BEGIN READ ONLY; SET LOCAL statement_timeout='1800ms'; SET LOCAL search_path=pg_catalog;")
    const state=await inspect(c,plan)
    await c.query('ROLLBACK');return state
  }finally{await c.close()}
}

/** Library only. Caller authority is not inferred from env or plan file presence.
 * No CLI, remote secret reader, application route or scheduler imports this.
 */
export async function executeApprovedPlan({plan,sources,factory,journal}) {
  assertPlan(plan);validateSources(sources);assertFactory(factory,plan);assertJournal(journal,plan)
  const results=[]
  let cohort
  for(let index=0;index<selection.length;index++) {
    assertPlan(plan)
    const prepared=sourceEnvelope(sources,index,plan)
    journal.append({version:prepared.version,state:'PREPARED',sourceSha256:prepared.sourceSha256,sqlSha256:prepared.sqlSha256,commitSha256:prepared.commitSha256,database:plan.endpoint.database,actor:plan.actor})
    let c,commitSent=false,commitAcknowledged=false,timer,timedOut=false
    try {
      c=await factory.connect()
      timer=setTimeout(()=>{timedOut=true;c?.abort()},timeoutPolicy.processMs)
      await verifyConnectionIdentity(c,plan)
      const reservation=(await c.query('SELECT pg_try_advisory_lock(1942046,20261029) AS locked')).rows[0]
      assert.ok(reservation.locked,'R48_APPLICATION_BUSY')
      const before=await observe(plan,factory)
      verifySnapshot(before,index,plan,cohort);cohort??=before.cohort
      journal.append({version:prepared.version,state:'IN_PROGRESS',phase:'BEFORE_SQL'})
      await c.query(prepared.guard)
      // Same-session preconditions inside the transaction, before original DDL.
      verifySnapshot(await inspect(c,plan),index,plan,cohort)
      await c.query(prepared.payload)
      verifySnapshot(await inspect(c,plan),index+1,plan,cohort)
      const settings=(await c.query("SELECT current_setting('lock_timeout') AS lock_timeout,current_setting('statement_timeout') AS statement_timeout,current_setting('idle_in_transaction_session_timeout') AS idle_transaction_timeout")).rows[0]
      assert.deepEqual(settings,{lock_timeout:'300ms',statement_timeout:'1800ms',idle_transaction_timeout:'5s'})
      journal.append({version:prepared.version,state:'IN_PROGRESS',phase:'COMMIT_INTENT_FSYNCED',settings})
      commitSent=true
      const ack=await c.query('COMMIT')
      assert.equal(ack.command,'COMMIT','R48_COMMIT_ACK_REQUIRED');commitAcknowledged=true
      clearTimeout(timer);await c.close();c=null
      const after=await observe(plan,factory);verifySnapshot(after,index+1,plan,cohort)
      journal.append({version:prepared.version,state:'COMMIT_CONFIRMED',observationSha256:hash(JSON.stringify(after))})
      results.push({version:prepared.version,state:'COMMIT_CONFIRMED',tlsVerified:true,independentObservation:true})
    }catch(error){
      clearTimeout(timer)
      if(c){if(!commitSent){try{await c.query('ROLLBACK')}catch{/* observer is authoritative */}}try{await c.close()}catch{/* no retry */}}
      let observation=null
      try{observation=await observe(plan,factory)}catch{/* cannot prove state */}
      let state=commitSent?'COMMIT_OUTCOME_UNKNOWN':'FAILED'
      if(!commitSent&&observation&&journal.snapshot().states.get(prepared.version)==='IN_PROGRESS'){
        try{verifySnapshot(observation,index,plan,cohort);state='ROLLED_BACK'}catch{/* no rollback claim on drift */}
      }
      const failure=timedOut?{reason:'PROCESS_DEADLINE',sqlstate:null,errorKind:'TRANSPORT'}:classifyFailure(error)
      journal.append({version:prepared.version,state,phase:commitAcknowledged?'ACK_WITHOUT_POSTCHECK':commitSent?'COMMIT_ACK_NOT_CONFIRMED':'NO_COMMIT_SENT',...failure,...(observation?{observationSha256:hash(JSON.stringify(observation))}:{})})
      return {status:'STOP',results,version:prepared.version,state,commitAcknowledged,...failure,observation,automaticRetries:0,nextFileAttempted:false}
    }finally{clearTimeout(timer)}
  }
  return {status:'PAIR_CONFIRMED',scope:plan.kind,planSha256:plan.digest,results,automaticRetries:0}
}
