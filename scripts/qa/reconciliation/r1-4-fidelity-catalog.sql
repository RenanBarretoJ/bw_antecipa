SELECT jsonb_build_object(
 'settings',jsonb_build_object('server_version',current_setting('server_version'),'standard_conforming_strings',current_setting('standard_conforming_strings'),'quote_all_identifiers',current_setting('quote_all_identifiers'),'client_encoding',current_setting('client_encoding')),
 'functions',(SELECT jsonb_agg(jsonb_build_object(
  'signature',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
  'rawHash',encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex'),
  'bodyRawHash',encode(extensions.digest(p.prosrc,'sha256'),'hex'),
  'normalizedHash',encode(extensions.digest(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)),'sha256'),'hex'),
  'crlf',position(chr(13)||chr(10) IN p.prosrc)>0) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.prokind='f'),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',con.conname,
  'definition',pg_get_constraintdef(con.oid),'expression',pg_get_expr(con.conbin,con.conrelid),
  'validated',con.convalidated,'deferrable',con.condeferrable,'deferred',con.condeferred,'noinherit',con.connoinherit,
  'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull,'collation',coll.collname) ORDER BY a.attnum)
   FROM pg_attribute a LEFT JOIN pg_collation coll ON coll.oid=a.attcollation WHERE a.attrelid=c.oid AND a.attnum=ANY(con.conkey))) ORDER BY con.conname)
 FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND con.conname IN('comunicacoes_remetente_nome_check','documento_upload_intents_storage_path_check'))
) evidence;
