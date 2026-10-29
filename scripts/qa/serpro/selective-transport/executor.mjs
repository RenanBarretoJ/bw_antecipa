import assert from 'node:assert/strict'
import {buildTransaction,hash,selection,timeoutPolicy,transportVersion,validateSources,validateTarget} from './policy.mjs'

const identitySql="SELECT current_database() database,session_user::text session_user,current_user::text effective_user,current_setting('server_version_num')::integer pg_version,(SELECT identity FROM r46_fixture.instance) fixture,has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT') ledger_insert,has_schema_privilege(current_user,'public','CREATE') public_create,has_schema_privilege(current_user,'private','CREATE') private_create"
const stateSql="SELECT jsonb_build_object('ledger',(SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'actor',created_by,'sourceSha256',encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex'),'statementCount',cardinality(statements),'idempotencyNull',idempotency_key IS NULL,'rollbackNull',rollback IS NULL) ORDER BY version),'[]'::jsonb) FROM supabase_migrations.schema_migrations WHERE version IN ('20261028195850','20261028204436')),'executions',to_regclass('public.nfe_fiscal_execucoes') IS NOT NULL,'httpAttempts',to_regclass('private.nfe_fiscal_http_attempts') IS NOT NULL,'provider',(SELECT jsonb_build_object('mode',coalesce(to_jsonb(p)->>'consumption_mode','OFF_ZERO_BUDGET'),'cutover',to_jsonb(p)->>'cutover_at','capability',capability_state,'circuit',circuit_state,'calls',calls_today) FROM public.nfe_fiscal_provider_state p WHERE provider='SERPRO')) state"

export function classifyError(error) {
  const message=String(error?.message??'')
  const sqlstate=/^[A-Z0-9]{5}$/.test(error?.code??'')?error.code:null
  const reason=message.includes('R46_APPLICATION_BUSY')?'APPLICATION_BUSY':message.includes('R46_VERSION_COLLISION')?'VERSION_COLLISION_STOP_NO_REPLAY':message.includes('lock timeout')?'SERVER_LOCK_TIMEOUT':message.includes('statement timeout')?'SERVER_STATEMENT_TIMEOUT':message.includes('user request')?'SERVER_QUERY_CANCELLED':message.includes('R46_')?'GUARD_REJECTED':sqlstate?'SQL_FAILURE':'CONNECTION_OR_PROCESS_FAILURE'
  return {reason,sqlstate,errorKind:sqlstate?'SQLSTATE':'TRANSPORT'}
}

function verifyIdentity(row,target) {
  assert.equal(row.database,target.database,'R46_DATABASE_IDENTITY_MISMATCH')
  assert.equal(row.session_user,target.sessionUser,'R46_SESSION_USER_MISMATCH')
  assert.equal(row.effective_user,target.role,'R46_EFFECTIVE_ROLE_MISMATCH')
  assert.equal(row.fixture,target.fixture,'R46_INSTANCE_IDENTITY_MISMATCH')
  assert.equal(Math.floor(row.pg_version/10000),17,'R46_PG_MAJOR_MISMATCH')
  assert.ok(row.ledger_insert&&row.public_create&&row.private_create,'R46_REQUIRED_WRITE_CAPABILITY_MISSING')
}

export async function observeLocal(connect,target) {
  validateTarget(target)
  const client=await connect()
  try {
    await client.query("BEGIN READ ONLY; SET LOCAL statement_timeout='1800ms';")
    verifyIdentity((await client.query(identitySql)).rows[0],target)
    const state=(await client.query(stateSql)).rows[0].state
    await client.query('COMMIT')
    return state
  } finally { await client.end() }
}

function verifyState(state,count,target) {
  assert.equal(state.ledger.length,count,'R46_LEDGER_COUNT_MISMATCH')
  assert.equal(state.executions,count>=1,'R46_DDL_AND_HISTORY_NOT_ATOMIC')
  assert.equal(state.httpAttempts,count===2,'R46_SECOND_DDL_AND_HISTORY_NOT_ATOMIC')
  assert.deepEqual(state.provider,{mode:'OFF_ZERO_BUDGET',cutover:null,capability:'UNVERIFIED',circuit:'OPEN',calls:0},'R46_PROVIDER_NOT_OFF')
  for(let i=0;i<count;i++) {
    const expected=selection[i],row=state.ledger[i]
    assert.equal(row.version,expected.version)
    assert.equal(row.name,expected.name)
    assert.equal(row.sourceSha256,expected.sha256)
    assert.equal(row.actor,target.actor)
    assert.equal(row.statementCount,1)
    assert.equal(row.idempotencyNull,true)
    assert.equal(row.rollbackNull,true)
  }
}

/** No connection construction, env reader, remote mode, CLI or retry path.
 * connect is supplied solely by the contained synthetic harness; both session
 * identity and in-transaction instance guards are mandatory, not config proof.
 */
export async function executeLocal({target,sources,connect,journal}) {
  target=validateTarget(target)
  const items=validateSources(sources)
  assert.equal(journal.snapshot().records.length,0,'R46_FRESH_JOURNAL_REQUIRED_NO_RESUME')
  const results=[]
  for(let index=0;index<items.length;index++) {
    const item=items[index],prepared=buildTransaction(item,target)
    const common={version:item.version,transportVersion,sourceSha256:item.sha256,sqlSha256:prepared.sqlSha256,commitSha256:prepared.commitSha256,fixture:target.fixture,database:target.database,actor:target.actor}
    journal.append({...common,state:'PREPARED'})
    let client,commitSent=false,commitAcknowledged=false
    try {
      client=await connect()
      verifyIdentity((await client.query(identitySql)).rows[0],target)
      // Reserve the session before the independent observer can wait on DDL
      // locks held by another executor. The transactional guard remains intact.
      // Closing this dedicated session releases both lock scopes on every path.
      const reservation=(await client.query('SELECT pg_try_advisory_lock(1942046,20261029) locked')).rows[0]
      if(!reservation.locked) throw new Error('R46_APPLICATION_BUSY')
      const before=await observeLocal(connect,target)
      if(index===0&&before.ledger.length) throw new Error('R46_VERSION_COLLISION_STOP_NO_REPLAY')
      verifyState(before,index,target)
      journal.append({version:item.version,state:'IN_PROGRESS',phase:'BEFORE_SQL'})
      await client.query(prepared.sql)
      const settings=(await client.query("SELECT current_setting('lock_timeout') lock_timeout,current_setting('statement_timeout') statement_timeout,current_setting('idle_in_transaction_session_timeout') idle_transaction_timeout")).rows[0]
      assert.deepEqual(settings,{lock_timeout:timeoutPolicy.lockMs+'ms',statement_timeout:timeoutPolicy.statementMs+'ms',idle_transaction_timeout:timeoutPolicy.idleTransactionMs/1000+'s'})
      // Post-DDL checks inside this same transaction; no COMMIT on drift.
      verifyState((await client.query(stateSql)).rows[0].state,index+1,target)
      journal.append({version:item.version,state:'IN_PROGRESS',phase:'COMMIT_INTENT_FSYNCED',settings})
      commitSent=true
      await client.query('COMMIT')
      commitAcknowledged=true
      await client.end();client=null
      const observed=await observeLocal(connect,target)
      verifyState(observed,index+1,target)
      journal.append({version:item.version,state:'COMMIT_CONFIRMED',observationSha256:hash(JSON.stringify(observed))})
      results.push({version:item.version,state:'COMMIT_CONFIRMED',independentObservation:true,settings})
    } catch(error) {
      const failure=classifyError(error)
      if(client) {
        if(!commitSent&&journal.states.get(item.version)==='IN_PROGRESS') { try{await client.query('ROLLBACK')}catch{/* Observation below is authoritative, not rollback ack. */} }
        try{await client.end()}catch{/* Broken connection never authorizes replay. */}
      }
      let observation
      try{observation=await observeLocal(connect,target)}catch{/* Unknown observation remains a STOP. */}
      let state='FAILED'
      if(commitSent) state='COMMIT_OUTCOME_UNKNOWN'
      else if(observation) {
        try{verifyState(observation,index,target);state='ROLLED_BACK'}catch{/* Failed proof remains FAILED. */}
      }
      // A pre-transaction identity/collision failure has no IN_PROGRESS state.
      if(journal.states.get(item.version)==='PREPARED') state='FAILED'
      journal.append({version:item.version,state,phase:commitAcknowledged?'ACK_WITHOUT_POSTCHECK':commitSent?'COMMIT_ACK_NOT_CONFIRMED':'NO_COMMIT_SENT',...failure,...(observation?{observationSha256:hash(JSON.stringify(observation))}:{})})
      return {status:'STOP',results,version:item.version,state,...failure,commitAcknowledged,observation:observation??null,automaticRetries:0,nextFileAttempted:false}
    }
  }
  return {status:'LOCAL_PAIR_CONFIRMED',results,automaticRetries:0,remoteSqlAuthorized:false}
}
