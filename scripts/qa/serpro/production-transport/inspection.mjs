import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {hash,selection,assertPlan} from './contract.mjs'
import {assertConnection} from './connection.mjs'

const catalogSql=readFileSync(new URL('./catalog.sql',import.meta.url),'utf8')
const canonical=v=>Array.isArray(v)?v.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
export const fingerprint=v=>hash(JSON.stringify(canonical(v)))
export const identitySql=`SELECT current_database() AS database,session_user::text AS session_user,current_user::text AS effective_role,
 (SELECT oid::bigint::text FROM pg_database WHERE datname=current_database()) AS database_oid,
 current_setting('server_version_num')::integer/10000 AS pg_major,
 (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl,
 has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT') AS ledger_insert,
 has_table_privilege(current_user,'supabase_migrations.schema_migrations','SELECT') AS ledger_select,
 has_schema_privilege(current_user,'public','CREATE') AS public_create,
 has_schema_privilege(current_user,'private','CREATE') AS private_create,
 (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.nfe_fiscal_provider_state'::regclass) AS provider_owner`

// Only hashes/metadata and aggregates cross the connection boundary. Existing
// row payloads and migration statement bodies are never returned or journaled.
export const stateSql=`SELECT jsonb_build_object(
 'ledger',(SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'actor',created_by,'sourceSha256',encode(sha256(convert_to(array_to_string(statements,E'\n'),'UTF8')),'hex'),'statementCount',cardinality(statements),'idempotencyNull',idempotency_key IS NULL,'rollbackNull',rollback IS NULL) ORDER BY version),'[]'::jsonb) FROM supabase_migrations.schema_migrations WHERE version IN ('20261028195850','20261028204436')),
 'baselineLedgerSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(h) ORDER BY version),'[]'::jsonb)::text,'UTF8')),'hex') FROM supabase_migrations.schema_migrations h WHERE version NOT IN ('20261028195850','20261028204436')),
 'pilots',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20261028140420','20261028173558')),
 'ledgerContract',jsonb_build_object(
   'columns',(SELECT jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations'),
   'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid,true) ORDER BY pg_get_constraintdef(oid,true)) FROM pg_constraint WHERE conrelid='supabase_migrations.schema_migrations'::regclass),
   'owner',(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='supabase_migrations.schema_migrations'::regclass),
   'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='supabase_migrations.schema_migrations'::regclass),
   'force_rls',(SELECT relforcerowsecurity FROM pg_class WHERE oid='supabase_migrations.schema_migrations'::regclass),
   'triggers',(SELECT count(*) FROM pg_trigger WHERE tgrelid='supabase_migrations.schema_migrations'::regclass AND NOT tgisinternal),
   'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',a.grantee::regrole::text,'grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type) FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='supabase_migrations.schema_migrations'::regclass)),
 'cohort',(SELECT jsonb_build_object('count',count(*),'hash',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(q)-'latest_execution_id' ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex'),'effects',count(*) FILTER(WHERE tentativas<>0 OR lease_token IS NOT NULL OR ultima_chamada_em IS NOT NULL)) FROM public.nfe_fiscal_consultas q WHERE criado_em<=$1::timestamptz),
 'provider',(SELECT jsonb_build_object('capability',capability_state,'circuit',circuit_state,'budget',daily_budget,'calls',calls_today,'mode',coalesce(to_jsonb(p)->>'consumption_mode','OFF_ZERO_BUDGET'),'cutover',to_jsonb(p)->>'cutover_at','oauth',coalesce((to_jsonb(p)->>'oauth_dispatch_count')::bigint,0),'get',coalesce((to_jsonb(p)->>'get_dispatch_count')::bigint,0)) FROM public.nfe_fiscal_provider_state p WHERE provider='SERPRO'),
 'addedTables',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',n.nspname||'.'||c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) ORDER BY c.relname),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname||'.'||c.relname IN ('public.nfe_fiscal_execucoes','public.nfe_fiscal_execucao_eventos','private.nfe_fiscal_http_attempts')),
 'addedFunctions',(SELECT coalesce(jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'sourceSha256',encode(sha256(convert_to(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),'UTF8')),'hex'),'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE')) ORDER BY p.oid::regprocedure::text),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'nfe_fiscal_operational_%' OR p.proname IN ('nfe_fiscal_execution_identity_valid','nfe_fiscal_http_history_guard','nfe_fiscal_execution_terminal_guard','nfe_fiscal_note_deleted','nfe_fiscal_execucao_eventos_immutable','nfe_fiscal_record_execution_event','solicitar_reconsulta_nfe_fiscal_operacional')))
 ) AS state`

export async function verifyConnectionIdentity(connection,plan) {
  assertPlan(plan);assertConnection(connection,plan)
  const id=(await connection.query(identitySql)).rows[0]
  assert.equal(id.database,plan.endpoint.database,'R48_DATABASE_MISMATCH')
  assert.equal(Number(id.database_oid),plan.databaseOid,'R48_DATABASE_OID_MISMATCH')
  assert.equal(id.session_user,plan.sessionUser,'R48_SESSION_ACTOR_MISMATCH')
  assert.equal(id.effective_role,plan.effectiveRole,'R48_EFFECTIVE_ACTOR_MISMATCH')
  assert.equal(id.pg_major,17);assert.equal(id.ssl,true)
  assert.ok(id.ledger_insert&&id.ledger_select&&id.public_create&&id.private_create,'R48_PRIVILEGE_MISSING')
  assert.equal(id.provider_owner,plan.effectiveRole,'R48_OBJECT_OWNER_MISMATCH')
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
