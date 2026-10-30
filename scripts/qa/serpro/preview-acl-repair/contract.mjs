import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const BASELINE_VERSION='20261030205748';
export const BASELINE_SHA256='5ed9df1fa01150fae47990937b15d434409ccf68cff0fd16e0779da6c5f8701c';
export const PROJECT_REF='fgttffyrkabpycmbnppi';
export const BRANCH_ID='5cb53ebc-edf6-43f5-a970-9eb4471c4f17';
export const hash=value=>createHash('sha256').update(value).digest('hex');
const literal=s=>"'"+s.replaceAll("'","''")+"'",identifier=s=>'"'+s.replaceAll('"','""')+'"';
const allowedRights=new Set(['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']);
export function validatePlan(plan){
 const {planSha256,...unsigned}=plan;assert.equal(hash(JSON.stringify(unsigned)),planSha256,'ACL_PLAN_HASH_DRIFT');
 assert.equal(plan.schema,'BW_PREVIEW_ACL_REPAIR_R75_V1');assert.equal(plan.projectRef,PROJECT_REF);assert.equal(plan.branchId,BRANCH_ID);assert.equal(plan.baselineVersion,BASELINE_VERSION);assert.equal(plan.baselineBodySha256,BASELINE_SHA256);assert.equal(plan.operator,'Breno Alvim');assert.equal(plan.auditActor,'Breno Alvim via Codex SQL');
 assert.match(plan.version,/^\d{14}$/);assert.notEqual(plan.version,BASELINE_VERSION);assert.equal(plan.name,'preview_serpro_acl_repair_r75');assert.match(plan.receiptId,/^[a-f0-9-]{36}$/);assert.equal(plan.objects.length,142);const names=new Set();
 for(const object of plan.objects){assert.equal(object.schema,'public');assert.match(object.name,/^[a-z_][a-z0-9_]*$/);assert.ok(!names.has(object.name));names.add(object.name);assert.equal(object.before.owner,'postgres');assert.deepEqual({...object.before,acl:object.after.acl},object.after,'NON_ACL_CHANGE_REFUSED');
  for(const revoke of object.revocations){assert.ok(['anon','authenticated','service_role'].includes(revoke.role));assert.ok(revoke.privileges.length>0&&revoke.privileges.every(p=>allowedRights.has(p)));}
 }
 return planSha256;
}

export const readAclQuery=`SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',(SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a)) ORDER BY n.nspname,c.relname),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private') AND c.relkind IN('r','p','v','m','S') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e');`;

function checkObjects(plan,stage){return `DO $r75_acl_${stage}$ DECLARE item jsonb; actual jsonb; BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(${literal(JSON.stringify(plan.objects))}::jsonb) LOOP
  SELECT jsonb_build_object('kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',(SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(coalesce(c.relacl,acldefault('r',c.relowner))) a)) INTO actual FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=item->>'schema' AND c.relname=item->>'name';
  IF actual IS DISTINCT FROM item->'${stage}' THEN RAISE EXCEPTION 'R75_ACL_${stage.toUpperCase()}_DRIFT:%',item->>'name'; END IF;
 END LOOP;
END $r75_acl_${stage}$;`;}

export function buildRepairBody(plan){
 validatePlan(plan);
 const guard=`DO $r75_scope$ BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres' OR (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'R75_DIRECT_PREVIEW_MAINTENANCE_ACTOR_REQUIRED'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('${PROJECT_REF}:acl-repair-r75',0)) THEN RAISE EXCEPTION 'R75_REPAIR_CONCURRENT'; END IF;
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>1 OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${BASELINE_VERSION}' AND encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex')='${BASELINE_SHA256}') THEN RAISE EXCEPTION 'R75_EXACT_BASELINE_HISTORY_REQUIRED_NO_REAPPLICATION'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.logs_auditoria WHERE id='c17d7c2a-2ee6-4bde-b580-1b8950b717b5'::uuid AND origem='preview_baseline_r73' AND dados_depois->>'intended_project_ref'='${PROJECT_REF}' AND dados_depois->>'intended_branch_id'='${BRANCH_ID}' AND dados_depois->>'body_sha256'='${BASELINE_SHA256}') THEN RAISE EXCEPTION 'R75_PREVIEW_BASELINE_RECEIPT_REQUIRED'; END IF;
 IF (SELECT count(*) FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO' AND capability_state='UNVERIFIED' AND consumption_mode='OFF_ZERO_BUDGET' AND circuit_state='OPEN' AND cutover_at IS NULL AND calls_today=0 AND daily_budget=0 AND oauth_dispatch_count=0 AND get_dispatch_count=0 AND http_response_count=0)<>1 THEN RAISE EXCEPTION 'R75_SERPRO_MUST_REMAIN_OFF'; END IF;
END $r75_scope$;`;
 const revokes=plan.objects.flatMap(o=>o.revocations.map(r=>`REVOKE ${r.privileges.join(', ')} ON TABLE ${identifier(o.schema)}.${identifier(o.name)} FROM ${identifier(r.role)} RESTRICT;`));
 return '-- PREVIEW ONLY: forward-only removal of observed excess object privileges.\n'+guard+'\n'+checkObjects(plan,'before')+'\n'+revokes.join('\n')+'\n'+checkObjects(plan,'after')+'\n';
}

export function buildRepairEnvelope({plan,body,end='COMMIT'}){
 const planSha=validatePlan(plan);assert.equal(body,buildRepairBody(plan),'EXACT_REPAIR_BODY_REQUIRED');assert.ok(['COMMIT','ROLLBACK'].includes(end));const bodySha=hash(body);
 const history=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${literal(plan.version)},${literal(plan.name)},ARRAY[${literal(body)}]);`;
 const audit=`INSERT INTO public.logs_auditoria(id,usuario_id,ator_tipo,ator_identificador,origem,tipo_evento,entidade_tipo,entidade_id,dados_depois) VALUES('${plan.receiptId}'::uuid,NULL,'sistema',${literal(plan.auditActor)},'preview_acl_repair_r75','PREVIEW_ACL_REPAIRED','preview_acl_repair','${plan.receiptId}'::uuid,jsonb_build_object('intended_project_ref','${PROJECT_REF}','intended_branch_id','${BRANCH_ID}','baseline_version','${BASELINE_VERSION}','repair_version',${literal(plan.version)},'body_sha256','${bodySha}','plan_sha256','${planSha}','objects',142,'database_actor',current_user,'session_actor',session_user,'connection_application_name',current_setting('application_name'),'txid',pg_current_xact_id()::text));`;
 const post=`DO $r75_post$ BEGIN IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>2 OR (SELECT count(*) FROM public.logs_auditoria WHERE id='${plan.receiptId}'::uuid)<>1 THEN RAISE EXCEPTION 'R75_ATOMIC_HISTORY_AND_AUDIT_REQUIRED'; END IF;END $r75_post$;`;
 const sql=`BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';SET LOCAL search_path=pg_catalog;\n${body}\n${history}\n${audit}\n${post}\n${end};`;
 return {sql,sha256:hash(sql),bodySha256:bodySha,planSha256:planSha,version:plan.version};
}
