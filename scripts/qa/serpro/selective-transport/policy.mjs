import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {lstatSync,readFileSync,realpathSync} from 'node:fs'
import {resolve,sep} from 'node:path'

export const transportVersion='R46_LOCAL_SIMULATED_V1'
export const futureProjectRef='wwsndnuvnjuabpbjwlck'
export const selection=Object.freeze([
  Object.freeze({path:'supabase/migrations/20261028195850_s2_2_serpro_operational_queue_history.sql',version:'20261028195850',name:'s2_2_serpro_operational_queue_history',sha256:'20ec5dc8ca746ed9af2ce9132ed56ec4b2c3032bf34f237289423afb18a1b2f7'}),
  Object.freeze({path:'supabase/migrations/20261028204436_s2_2r_serpro_outbound_fencing_recovery.sql',version:'20261028204436',name:'s2_2r_serpro_outbound_fencing_recovery',sha256:'4fc2a0c34c1e6acee330a71622b1f44fa0b57ca6f55528cf18d87b591645d7d5'}),
])
export const excludedVersions=Object.freeze(['20261028140420','20261028173558'])
export const timeoutPolicy=Object.freeze({lockMs:300,statementMs:1800,idleTransactionMs:5000,processMs:15000})
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex')

export function validateTarget(target) {
  assert.equal(target.mode,'LOCAL_SIMULATED','PRODUCTION_GO_NOT_AUTHORIZED')
  assert.deepEqual(Object.keys(target).sort(),['actor','branch','database','fixture','futureProjectRef','host','mode','role','sessionUser'].sort(),'EXACT_TARGET_FIELDS_REQUIRED')
  assert.equal(target.futureProjectRef,futureProjectRef,'WRONG_FUTURE_PROJECT_EXPECTATION')
  assert.equal(target.host,'r46-db','NON_LOCAL_DESTINATION_REFUSED')
  assert.equal(target.branch,'synthetic-r46','NON_LOCAL_BRANCH_REFUSED')
  assert.match(target.database,/^r46_[a-z0-9_]{1,48}$/,'OWNED_LOCAL_DATABASE_REQUIRED')
  assert.match(target.fixture,/^r46-synthetic-[a-f0-9]{32}$/,'SYNTHETIC_INSTANCE_REQUIRED')
  assert.match(target.actor,/^r46-local-[a-z0-9-]{1,64}$/,'DECLARED_SYNTHETIC_ACTOR_REQUIRED')
  assert.equal(target.sessionUser,'postgres','UNEXPECTED_SESSION_USER')
  assert.equal(target.role,'postgres','UNEXPECTED_EFFECTIVE_ROLE')
  return Object.freeze({...target})
}

export function validateSources(entries) {
  assert.equal(entries.length,selection.length,'EXACT_TWO_FILES_REQUIRED')
  return entries.map((entry,index)=>{
    const expected=selection[index]
    assert.equal(entry.path,expected.path,'EXACT_PATH_AND_ORDER_REQUIRED')
    assert.ok(Buffer.isBuffer(entry.bytes),'RAW_BYTES_REQUIRED')
    assert.equal(hash(entry.bytes),expected.sha256,'EXACT_RAW_SOURCE_HASH_REQUIRED')
    const source=entry.bytes.toString('utf8')
    assert.ok(Buffer.from(source,'utf8').equals(entry.bytes),'EXACT_UTF8_REQUIRED')
    assert.match(source,/^BEGIN;\r?$/m)
    assert.match(source,/\r?\nCOMMIT;\s*$/)
    return Object.freeze({...expected,source})
  })
}

export function loadSources(repo) {
  const root=realpathSync(repo)
  const entries=selection.map(item=>{
    const path=resolve(root,item.path)
    assert.ok(path.startsWith(root+sep),'PATH_OUTSIDE_REPOSITORY')
    assert.equal(lstatSync(path).isSymbolicLink(),false,'SOURCE_SYMLINK_REFUSED')
    assert.equal(realpathSync(path),path,'PATH_ALIAS_REFUSED')
    return {path:item.path,bytes:readFileSync(path)}
  })
  return validateSources(entries)
}

// This is a new envelope. R42 guards and source files are never modified.
export function buildTransaction(item,target) {
  validateTarget(target)
  assert.ok(selection.some(s=>s.path===item.path&&s.sha256===hash(Buffer.from(item.source,'utf8'))),'SEALED_SOURCE_REQUIRED')
  const quote=value=>"'"+value.replaceAll("'","''")+"'"
  const begin=/^BEGIN;\r?$/m.exec(item.source),end=/\r?\nCOMMIT;\s*$/.exec(item.source)
  const marker='$r46_original_source$'
  assert.ok(!item.source.includes(marker),'SOURCE_DELIMITER_COLLISION')
  const guard=[
    'BEGIN;',
    "SET LOCAL lock_timeout='"+timeoutPolicy.lockMs+"ms';",
    "SET LOCAL statement_timeout='"+timeoutPolicy.statementMs+"ms';",
    "SET LOCAL idle_in_transaction_session_timeout='"+timeoutPolicy.idleTransactionMs+"ms';",
    'DO $r46_guard$ BEGIN',
    'IF current_database()<>'+quote(target.database)+" OR session_user<>'postgres' OR current_user<>'postgres' THEN RAISE EXCEPTION 'R46_DESTINATION_OR_ACTOR_MISMATCH'; END IF;",
    "IF current_setting('server_version_num')::integer/10000<>17 THEN RAISE EXCEPTION 'R46_PG_MAJOR_REQUIRED'; END IF;",
    "IF (SELECT identity FROM r46_fixture.instance) IS DISTINCT FROM "+quote(target.fixture)+" THEN RAISE EXCEPTION 'R46_INSTANCE_MISMATCH'; END IF;",
    "IF NOT pg_try_advisory_xact_lock(1942046,20261029) THEN RAISE EXCEPTION 'R46_APPLICATION_BUSY'; END IF;",
    "IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('20261028140420','20261028173558')) THEN RAISE EXCEPTION 'R46_EXCLUDED_PILOT_PRESENT'; END IF;",
    'IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='+quote(item.version)+") THEN RAISE EXCEPTION 'R46_VERSION_COLLISION_STOP_NO_REPLAY'; END IF;",
    item.version===selection[1].version?"IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='"+selection[0].version+"' AND name='"+selection[0].name+"' AND encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex')='"+selection[0].sha256+"') THEN RAISE EXCEPTION 'R46_PREDECESSOR_REQUIRED'; END IF;":'',
    "IF NOT EXISTS (SELECT 1 FROM public.nfe_fiscal_provider_state p WHERE provider='SERPRO' AND capability_state='UNVERIFIED' AND circuit_state='OPEN' AND daily_budget=0 AND calls_today=0 AND coalesce(to_jsonb(p)->>'consumption_mode','OFF_ZERO_BUDGET')='OFF_ZERO_BUDGET' AND (to_jsonb(p)->>'cutover_at') IS NULL) THEN RAISE EXCEPTION 'R46_PROVIDER_OFF_REQUIRED'; END IF;",
    'END $r46_guard$;',
  ].join('\n')
  const body=item.source.slice(begin.index+begin[0].length,end.index)
  const history='INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by) VALUES ('+quote(item.version)+', ARRAY['+marker+item.source+marker+']::text[], '+quote(item.name)+', '+quote(target.actor)+');'
  const sql=guard+'\n'+body+'\n'+history
  return {sql,sqlSha256:hash(sql),sourceSha256:item.sha256,commitSha256:hash('COMMIT'),version:item.version}
}
