WITH enum_values AS (
 SELECT e.enumtypid, to_jsonb(array_agg(e.enumlabel ORDER BY e.enumsortorder,e.enumlabel)) labels
 FROM pg_enum e GROUP BY e.enumtypid
), rels AS (
 SELECT c.*,n.nspname,pg_get_userbyid(c.relowner) owner_name,
 ARRAY(SELECT a::text FROM unnest(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a ORDER BY a::text) acl_names
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN('public','private','storage','auth')
), objects AS (
 SELECT 'function' kind,n.nspname schema,p.proname::text name,pg_get_function_identity_arguments(p.oid) signature,
 to_jsonb(pg_get_functiondef(p.oid)) definition,pg_get_userbyid(p.proowner) owner,
 to_jsonb(ARRAY(SELECT a::text FROM unnest(coalesce(p.proacl,acldefault('f',p.proowner))) a ORDER BY a::text)) acl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.prokind='f'
 UNION ALL
 SELECT 'constraint',c.nspname,c.relname||'.'||con.conname,'',jsonb_build_object('ddl',pg_get_constraintdef(con.oid),'validated',con.convalidated,'deferred',con.condeferred,'deferrable',con.condeferrable),c.owner_name,to_jsonb(c.acl_names)
 FROM pg_constraint con JOIN rels c ON c.oid=con.conrelid WHERE c.nspname IN('public','private')
 UNION ALL
 SELECT 'column',c.nspname,c.relname||'.'||a.attname,'',jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'collation',coll.collname),c.owner_name,to_jsonb(a.attacl)
 FROM pg_attribute a JOIN rels c ON c.oid=a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum LEFT JOIN pg_collation coll ON coll.oid=a.attcollation
 WHERE c.nspname IN('public','private') AND c.relkind IN('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'relation',c.nspname,c.relname,'',jsonb_build_object('kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'options',c.reloptions,'view',CASE WHEN c.relkind IN('v','m') THEN pg_get_viewdef(c.oid) END),c.owner_name,to_jsonb(c.acl_names)
 FROM rels c WHERE c.nspname IN('public','private') AND c.relkind IN('r','p','v','m','S')
 UNION ALL
 SELECT 'index',c.nspname,c.relname,'',to_jsonb(pg_get_indexdef(c.oid)),c.owner_name,to_jsonb(c.acl_names)
 FROM rels c WHERE c.nspname IN('public','private') AND c.relkind='i'
 UNION ALL
 SELECT 'policy',p.schemaname,p.tablename||'.'||p.policyname,'',jsonb_build_object('permissive',p.permissive,'roles',p.roles,'command',p.cmd,'using',p.qual,'check',p.with_check),c.owner_name,to_jsonb(c.acl_names)
 FROM pg_policies p JOIN rels c ON c.nspname=p.schemaname AND c.relname=p.tablename WHERE p.schemaname IN('public','private','storage')
 UNION ALL
 SELECT 'trigger',c.nspname,c.relname||'.'||t.tgname,'',jsonb_build_object('ddl',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'functionOwner',pg_get_userbyid(p.proowner)),c.owner_name,to_jsonb(c.acl_names)
 FROM pg_trigger t JOIN rels c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
 WHERE NOT t.tgisinternal AND (c.nspname IN('public','private') OR pn.nspname IN('public','private'))
 UNION ALL
 SELECT 'enum',n.nspname,t.typname,'',ev.labels,pg_get_userbyid(t.typowner),to_jsonb(t.typacl)
 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN enum_values ev ON ev.enumtypid=t.oid WHERE n.nspname IN('public','private')
 UNION ALL
 SELECT 'schema',n.nspname,n.nspname,'',jsonb_build_object('schema',n.nspname),pg_get_userbyid(n.nspowner),to_jsonb(ARRAY(SELECT a::text FROM unnest(n.nspacl) a ORDER BY a::text))
 FROM pg_namespace n WHERE n.nspname IN('public','private')
 UNION ALL
 SELECT 'default_acl',n.nspname,pg_get_userbyid(d.defaclrole)||'.'||d.defaclobjtype::text,'',jsonb_build_object('type',d.defaclobjtype),pg_get_userbyid(d.defaclrole),to_jsonb(ARRAY(SELECT a::text FROM unnest(d.defaclacl) a ORDER BY a::text))
 FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname IN('public','private')
)
SELECT * FROM objects ORDER BY kind,schema,name,signature;
