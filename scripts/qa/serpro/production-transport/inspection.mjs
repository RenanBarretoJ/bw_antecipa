import assert from 'node:assert/strict'
import {hash,selection,assertPlan,assertConnectionPlan,isReadOnlyPlan} from './contract.mjs'
import {assertConnection} from './connection.mjs'

import {identitySql,stateSql,catalogSql} from './inspection-queries.mjs'
export {identitySql,stateSql} from './inspection-queries.mjs'
const canonical=v=>Array.isArray(v)?v.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
export const fingerprint=v=>hash(JSON.stringify(canonical(v)))

export async function verifyConnectionIdentity(connection,plan) {
  assertConnectionPlan(plan);assertConnection(connection,plan)
  const id=(await connection.query(identitySql)).rows[0]
  assert.equal(id.database,plan.endpoint.database,'R48_DATABASE_MISMATCH')
  assert.equal(Number(id.database_oid),plan.databaseOid,'R48_DATABASE_OID_MISMATCH')
  assert.equal(id.session_user,plan.sessionUser,'R48_SESSION_ACTOR_MISMATCH')
  assert.equal(id.effective_role,plan.effectiveRole,'R48_EFFECTIVE_ACTOR_MISMATCH')
  assert.equal(id.pg_major,17);assert.equal(id.ssl,true)
  assert.ok(id.ledger_insert&&id.ledger_select&&id.public_create&&id.private_create,'R48_PRIVILEGE_MISSING')
  assert.equal(id.provider_owner,plan.effectiveRole,'R48_OBJECT_OWNER_MISMATCH')
  if(isReadOnlyPlan(plan)){
    assert.equal(id.read_only,'on','R53_READ_ONLY_TRANSACTION_REQUIRED')
    assert.equal(id.default_read_only,'on','R53_READ_ONLY_SESSION_REQUIRED')
  }
  return id
}

export async function inspect(connection,plan) {
  await verifyConnectionIdentity(connection,plan)
  const state=(await connection.query(stateSql,[plan.evidence.cutoff])).rows[0].state
  const catalog=(await connection.query(catalogSql)).rows[0].catalog
  delete catalog.observed_at_utc;delete catalog.database;delete catalog.read_only
  const result={...state,ledgerContractSha256:fingerprint(state.ledgerContract),catalogStageSha256:fingerprint({catalog,addedTables:state.addedTables,addedFunctions:state.addedFunctions})}
  delete result.ledgerContract;delete result.addedFunctions
  return result
}

export function verifySnapshot(state,stage,plan,cohort) {
  assertPlan(plan)
  assert.equal(state.ledger.length,stage,'R48_LEDGER_COUNT_MISMATCH')
  assert.equal(state.baselineLedgerSha256,plan.evidence.ledgerSha256,'R48_BASELINE_HISTORY_DRIFT')
  assert.equal(state.ledgerContractSha256,plan.evidence.ledgerContractSha256,'R48_NATIVE_LEDGER_CONTRACT_DRIFT')
  assert.equal(state.catalogStageSha256,plan.evidence.catalogStages[stage],'R48_CATALOG_DRIFT')
  assert.equal(Number(state.pilots),0,'R48_PILOT_PRESENT')
  assert.deepEqual(state.provider,{capability:'UNVERIFIED',circuit:'OPEN',budget:0,calls:0,mode:'OFF_ZERO_BUDGET',cutover:null,oauth:0,get:0},'R48_PROVIDER_NOT_OFF')
  assert.equal(state.cohort.effects,0,'R48_S1_EFFECTS')
  assert.deepEqual(state.cohort,plan.evidence.cohort,'R48_PREFLIGHT_COHORT_DRIFT')
  if(cohort)assert.deepEqual(state.cohort,cohort,'R48_HISTORICAL_COHORT_DRIFT')
  assert.equal(state.addedTables.length,stage===0?0:stage===1?2:3,'R48_PARTIAL_SCHEMA')
  assert.ok(state.addedTables.every(t=>t.owner===plan.effectiveRole&&t.rls&&t.force_rls),'R48_NEW_TABLE_SECURITY')
  for(let i=0;i<stage;i++){
    const row=state.ledger[i],expected=selection[i]
    assert.equal(row.version,expected.version);assert.equal(row.name,expected.name);assert.equal(row.actor,plan.actor)
    assert.equal(row.sourceSha256,expected.sha256);assert.equal(row.statementCount,1)
    assert.equal(row.idempotencyNull,true);assert.equal(row.rollbackNull,true)
  }
}
