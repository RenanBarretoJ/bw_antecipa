with objects as (
select 'function' kind,n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' name,
 md5(row(pg_get_functiondef(p.oid),ARRAY(select a::text from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) a order by a::text),p.proowner::regrole)::text) hash
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'
union all
select 'policy',schemaname||'.'||tablename||'.'||policyname,md5(row(permissive,roles,cmd,qual,with_check)::text) from pg_policies where schemaname in ('public','private','storage')
union all
select 'constraint',n.nspname||'.'||c.relname||'.'||con.conname,md5(pg_get_constraintdef(con.oid)) from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private')
union all
select 'column',table_schema||'.'||table_name||'.'||column_name,md5(row(udt_name,is_nullable,column_default,identity_generation)::text) from information_schema.columns where table_schema in ('public','private')
union all
select 'relation',n.nspname||'.'||c.relname,md5(row(c.relkind,c.relrowsecurity,c.relforcerowsecurity,ARRAY(select a::text from unnest(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) a order by a::text),c.relowner::regrole,c.reloptions)::text) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S')
union all
select 'index',schemaname||'.'||indexname,md5(indexdef) from pg_indexes where schemaname in ('public','private')
union all
select 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,md5(row(pg_get_triggerdef(t.oid),t.tgenabled)::text) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace where not t.tgisinternal and (n.nspname in ('public','private') or (n.nspname='auth' and pn.nspname in ('public','private')))
union all
select 'enum',n.nspname||'.'||t.typname,md5(string_agg(e.enumlabel,',' order by e.enumsortorder)) from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','private') group by n.nspname,t.typname
union all
select 'schema',n.nspname,md5(row(n.nspacl,n.nspowner::regrole)::text) from pg_namespace n where n.nspname in ('public','private')
union all
select 'default_acl',n.nspname||'.'||d.defaclrole::regrole||'.'||d.defaclobjtype::text,md5(ARRAY(select a::text from unnest(d.defaclacl) a order by a::text)::text) from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname in ('public','private')
)
select jsonb_agg(to_jsonb(objects) order by kind,name) as objects from objects
