WITH inventory AS (
 SELECT n.nspname AS schema,c.relname AS table,t.tgname AS name,t.tgtype::int AS tgtype,
 CASE WHEN (t.tgtype&2)<>0 THEN 'BEFORE' WHEN (t.tgtype&64)<>0 THEN 'INSTEAD OF' ELSE 'AFTER' END timing,
 array_remove(ARRAY[CASE WHEN (t.tgtype&4)<>0 THEN 'INSERT' END,CASE WHEN (t.tgtype&8)<>0 THEN 'DELETE' END,
 CASE WHEN (t.tgtype&16)<>0 THEN 'UPDATE' END,CASE WHEN (t.tgtype&32)<>0 THEN 'TRUNCATE' END],NULL) events,
 t.tgenabled AS enabled,t.tgisinternal AS internal,t.tgconstraint<>0 AS constraint_trigger,
 t.tgdeferrable AS deferrable,t.tginitdeferred AS initially_deferred,
 pn.nspname AS function_schema,p.proname AS function_name,
 pn.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS function_signature,
 pg_get_userbyid(p.proowner) AS function_owner,pg_get_userbyid(c.relowner) AS table_owner,
 pg_get_triggerdef(t.oid) AS definition,
 encode(extensions.digest(pg_get_triggerdef(t.oid),'sha256'),'hex') AS raw_trigger_hash,
 encode(extensions.digest(replace(pg_get_triggerdef(t.oid),chr(13)||chr(10),chr(10)),'sha256'),'hex') AS normalized_diagnostic_hash,
 encode(t.tgargs,'hex') AS args,
 ARRAY(SELECT a.attname FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY x(num,ord)
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=x.num ORDER BY x.ord) AS update_columns,
 CASE WHEN t.tgisinternal OR ex.extname IS NOT NULL THEN 'PLATFORM_MANAGED'
 WHEN pn.nspname IN ('public','private') THEN 'APPLICATION_MANAGED'
 WHEN pn.nspname IN ('auth','storage','pg_catalog','extensions','realtime') THEN 'PLATFORM_MANAGED'
 ELSE 'UNKNOWN' END AS classification,
 ex.extname AS owning_extension,
 ARRAY(SELECT d.deptype::text||':'||pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid)
 FROM pg_depend d WHERE d.classid='pg_trigger'::regclass AND d.objid=t.oid ORDER BY 1) AS dependencies
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
 LEFT JOIN LATERAL (SELECT e.extname FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
 WHERE d.classid='pg_trigger'::regclass AND d.objid=t.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e') ex ON true
 WHERE n.nspname IN ('public','private') OR (n.nspname='storage' AND c.relname='objects')
 OR (n.nspname='auth' AND c.relname='users') OR pn.nspname IN ('public','private')
) SELECT coalesce(jsonb_agg(to_jsonb(inventory) ORDER BY schema,"table",name),'[]'::jsonb) triggers FROM inventory;
