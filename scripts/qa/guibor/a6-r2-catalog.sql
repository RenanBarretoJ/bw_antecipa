-- Read-only schema evidence; set search_path identically on both targets.
SET search_path='';
with objects as (
select 'function' kind,n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' name,md5(replace(pg_get_functiondef(p.oid),chr(13),'')) hash
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'
union all
select 'policy',schemaname||'.'||tablename||'.'||policyname,md5(row(permissive,roles,cmd,qual,with_check)::text) from pg_policies where schemaname in ('public','private','storage')
union all
select 'constraint',n.nspname||'.'||c.relname||'.'||con.conname,md5(pg_get_constraintdef(con.oid)) from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private')
union all
select 'column',table_schema||'.'||table_name||'.'||column_name,md5(row(udt_name,is_nullable,column_default)::text) from information_schema.columns where table_schema in ('public','private')
)
select jsonb_agg(to_jsonb(objects) order by kind,name) as objects from objects;
