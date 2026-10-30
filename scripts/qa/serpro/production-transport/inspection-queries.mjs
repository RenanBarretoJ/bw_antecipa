import {readFileSync} from 'node:fs'

export const catalogSql=readFileSync(new URL('./catalog.sql',import.meta.url),'utf8')
export const readOnlyBeginSql="BEGIN READ ONLY; SET LOCAL statement_timeout='1800ms'; SET LOCAL lock_timeout='300ms'; SET LOCAL idle_in_transaction_session_timeout='5000ms'; SET LOCAL search_path=pg_catalog;"
export const identitySql=`SELECT current_database() AS database,session_user::text AS session_user,current_user::text AS effective_role,
 current_setting('transaction_read_only') AS read_only,current_setting('default_transaction_read_only') AS default_read_only,
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
