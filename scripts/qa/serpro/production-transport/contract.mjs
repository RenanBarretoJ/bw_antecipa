import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {selection, hash, validateSources, timeoutPolicy, futureProjectRef} from '../selective-transport/policy.mjs'

export {selection, hash, validateSources, timeoutPolicy}
export const version='R48_DEDICATED_PG_V1'
export const adapterFiles=Object.freeze(['contract.mjs','connection.mjs','journal.mjs','inspection.mjs','catalog.sql','executor.mjs'])
export const adapterFingerprint=()=>hash(JSON.stringify(adapterFiles.map(path=>({path,sha256:hash(readFileSync(new URL('./'+path,import.meta.url)))}))))
const plans=new WeakSet()
const exact=(o,keys)=>assert.deepEqual(Object.keys(o).sort(),[...keys].sort(),'R48_EXACT_FIELDS_REQUIRED')
const digest=v=>assert.match(v,/^[a-f0-9]{64}$/,'R48_SHA256_REQUIRED')
const freeze=o=>{for(const v of Object.values(o))if(v&&typeof v==='object')freeze(v);return Object.freeze(o)}

/** Explicit caller-supplied approval and evidence, not an authorization service.
 * No env reader, CLI, credential lookup, remote call or implicit GO exists here.
 * A production invocation still requires a separate operator GO and certification.
 */
export function preparePlan(input,now=Date.now()) {
  const p=structuredClone(input)
  exact(p,['version','adapterSha256','kind','runId','projectRef','branch','endpoint','actor','sessionUser','effectiveRole','databaseOid','caSha256','approval','evidence'])
  assert.equal(p.version,version)
  assert.equal(p.adapterSha256,adapterFingerprint(),'R48_ADAPTER_SOURCE_DRIFT')
  assert.ok(['LOCAL_CERTIFICATION','PRODUCTION_SELECTIVE_SQL'].includes(p.kind),'R48_KIND_REQUIRED')
  assert.match(p.runId,/^[a-zA-Z0-9-]{12,80}$/)
  assert.equal(p.branch,'main','R48_MAIN_REQUIRED')
  assert.equal(p.sessionUser,'postgres');assert.equal(p.effectiveRole,'postgres')
  assert.ok(Number.isSafeInteger(p.databaseOid)&&p.databaseOid>0,'R48_DATABASE_OID_REQUIRED')
  assert.match(p.actor,/^[a-zA-Z0-9][a-zA-Z0-9 @._-]{2,120}$/,'R48_DECLARED_ACTOR_REQUIRED')
  exact(p.endpoint,['host','serverName','port','database'])
  assert.ok(Number.isInteger(p.endpoint.port)&&p.endpoint.port>0&&p.endpoint.port<65536)
  if(p.kind==='PRODUCTION_SELECTIVE_SQL') {
    assert.equal(p.projectRef,futureProjectRef,'R48_WRONG_PROJECT')
    assert.equal(p.endpoint.host,'db.'+futureProjectRef+'.supabase.co','R48_EXACT_DIRECT_HOST_REQUIRED')
    assert.equal(p.endpoint.serverName,p.endpoint.host,'R48_TLS_HOST_REQUIRED')
    assert.equal(p.endpoint.database,'postgres');assert.equal(p.endpoint.port,5432)
    assert.ok(!/r4[68][- ]local|synthetic|example[.]invalid/i.test(p.actor),'R48_REAL_ACTOR_REQUIRED')
  } else {
    assert.equal(p.projectRef,'r48-synthetic-project','R48_SYNTHETIC_PROJECT_REQUIRED')
    assert.ok(['r48-db.test.invalid','127.0.0.1'].includes(p.endpoint.host),'R48_LOCAL_HOST_REQUIRED')
    assert.equal(p.endpoint.serverName,'r48-db.test.invalid','R48_SYNTHETIC_TLS_HOST_REQUIRED')
    assert.match(p.endpoint.database,/^r48_[a-z0-9_]{1,48}$/)
    assert.match(p.actor,/^r48-local-[a-z0-9-]+$/)
  }
  digest(p.caSha256)
  exact(p.approval,['kind','reference','textSha256','acceptedAt','expiresAt'])
  assert.equal(p.approval.kind,p.kind,'R48_APPROVAL_KIND_MISMATCH')
  assert.match(p.approval.reference,/^[A-Za-z0-9_-]{8,100}$/)
  digest(p.approval.textSha256)
  const accepted=Date.parse(p.approval.acceptedAt),expires=Date.parse(p.approval.expiresAt)
  assert.ok(Number.isFinite(accepted)&&Number.isFinite(expires)&&accepted<=now&&now<expires&&expires-accepted<=15*60_000,'R48_FRESH_APPROVAL_REQUIRED')
  exact(p.evidence,['observedAt','cutoff','cohort','ledgerSha256','ledgerContractSha256','catalogStages','runtimeOff','projectIdentitySha256'])
  const observed=Date.parse(p.evidence.observedAt),cutoff=Date.parse(p.evidence.cutoff)
  assert.ok(Number.isFinite(observed)&&Number.isFinite(cutoff)&&observed<=now&&now-observed<=10*60_000&&cutoff<=observed,'R48_FRESH_PREFLIGHT_REQUIRED')
  digest(p.evidence.ledgerSha256);digest(p.evidence.ledgerContractSha256);digest(p.evidence.projectIdentitySha256)
  assert.equal(p.evidence.catalogStages.length,3)
  for(const stage of p.evidence.catalogStages)digest(stage)
  assert.deepEqual(p.evidence.runtimeOff,{worker:false,query:false,contract:false})
  exact(p.evidence.cohort,['count','hash','effects'])
  assert.ok(Number.isSafeInteger(p.evidence.cohort.count)&&p.evidence.cohort.count>=0)
  digest(p.evidence.cohort.hash);assert.equal(p.evidence.cohort.effects,0,'R48_COHORT_MUST_HAVE_NO_EFFECTS')
  p.digest=hash(JSON.stringify(p))
  freeze(p);plans.add(p);return p
}

export function assertPlan(plan,now=Date.now()) {
  assert.ok(plans.has(plan),'R48_PREPARED_PLAN_REQUIRED')
  assert.ok(now<Date.parse(plan.approval.expiresAt)&&now-Date.parse(plan.evidence.observedAt)<=10*60_000,'R48_APPROVAL_OR_PREFLIGHT_EXPIRED')
}

export function sourceEnvelope(entries,index,plan) {
  assertPlan(plan)
  const item=validateSources(entries)[index]
  assert.ok(item,'R48_SOURCE_INDEX_REQUIRED')
  const begin=/^BEGIN;\r?$/m.exec(item.source),end=/\r?\nCOMMIT;\s*$/.exec(item.source)
  const quote=s=>"'"+s.replaceAll("'","''")+"'"
  const marker='$r48_original_source$'
  assert.ok(!item.source.includes(marker))
  const guard=`BEGIN;
SET LOCAL lock_timeout='${timeoutPolicy.lockMs}ms';
SET LOCAL statement_timeout='${timeoutPolicy.statementMs}ms';
SET LOCAL idle_in_transaction_session_timeout='${timeoutPolicy.idleTransactionMs}ms';
SET LOCAL search_path=pg_catalog;
DO $r48_guard$ BEGIN
 IF current_database()<>${quote(plan.endpoint.database)} OR session_user::text<>${quote(plan.sessionUser)} OR current_user::text<>${quote(plan.effectiveRole)} THEN RAISE EXCEPTION 'R48_DATABASE_OR_ACTOR_MISMATCH'; END IF;
 IF (SELECT oid::bigint FROM pg_database WHERE datname=current_database())<>${plan.databaseOid} OR current_setting('server_version_num')::integer/10000<>17 THEN RAISE EXCEPTION 'R48_INSTANCE_MISMATCH'; END IF;
 IF NOT pg_try_advisory_xact_lock(1942046,20261029) THEN RAISE EXCEPTION 'R48_APPLICATION_BUSY'; END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('20261028140420','20261028173558')) THEN RAISE EXCEPTION 'R48_EXCLUDED_PILOT_PRESENT'; END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(item.version)}) THEN RAISE EXCEPTION 'R48_VERSION_COLLISION'; END IF;
END $r48_guard$;`
  const payload=item.source.slice(begin.index+begin[0].length,end.index)+
    '\nINSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by) VALUES ('+
    quote(item.version)+',ARRAY['+marker+item.source+marker+']::text[],'+quote(item.name)+','+quote(plan.actor)+');'
  return {guard,payload,version:item.version,sourceSha256:item.sha256,sqlSha256:hash(guard+'\n'+payload),commitSha256:hash('COMMIT')}
}
