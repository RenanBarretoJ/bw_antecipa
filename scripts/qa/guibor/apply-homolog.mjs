// R2: repairs ONLY history text. Never executes migration DDL.
// Default is read-only. --repair requires all local/live guards to pass.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { normalizeSql, sqlLiteral } from './history-envelope.mjs'
const ref = 'fhgkmggthxikfpogrvaa'
const version = '20260929154656'
const badHash = 'baf58d462397d739f1370c0ea13d7d348936bb52671bcf125ab52f6cb696c69a'
const goodHash = '6764965cb3be144ff3604f7aa294aafc62e90270a72d2a4d7104689571e31d76'
// Fresh Docker baseline: ordered name:pg_get_constraintdef joined with |.
const constraintsHash = 'c62c506267327e76b806bf6bf3137538'
const hash = value => createHash('sha256').update(value).digest('hex')
const assert = (condition, code) => { if (!condition) throw new Error(code) }
assert(readFileSync('supabase/.temp/project-ref', 'utf8').trim() === ref, 'HOMOLOG_LINK_REQUIRED')
const source = normalizeSql(readFileSync(`supabase/migrations/${version}_guibor_nfse_fiscal_provenance.sql`, 'utf8'))
assert(hash(source) === goodHash, 'LOCAL_SOURCE_HASH_MISMATCH')
const snapshot = `select jsonb_build_object(
 'historyCount',(select count(*) from supabase_migrations.schema_migrations where version='${version}'),
 'history',(select statements from supabase_migrations.schema_migrations where version='${version}'),
 'metadata',(select to_jsonb(m)-'statements' from supabase_migrations.schema_migrations m where version='${version}'),
 'otherHistory',(select md5(coalesce(string_agg(to_jsonb(m)::text,'' order by version),'')) from supabase_migrations.schema_migrations m where version<>'${version}'),
 'p17',(select count(*)=1 from supabase_migrations.schema_migrations where version='20260929141740'),
 'functions',(select jsonb_object_agg(proname,prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and proname in ('guibor_proteger_fatos_nfse','guibor_auditar_vencimento_nfse')),
 'constraintsHash',(select md5(string_agg(conname||':'||pg_get_constraintdef(oid),'|' order by conname)) from pg_constraint where conrelid='public.notas_fiscais'::regclass and conname in ('nf_tipo_fiscal_check','nf_liquido_origem_check','nf_vencimento_origem_check','nfse_fatos_check')),
 'constraintsCount',(select count(*) from pg_constraint where conrelid='public.notas_fiscais'::regclass and conname in ('nf_tipo_fiscal_check','nf_liquido_origem_check','nf_vencimento_origem_check','nfse_fatos_check')),
 'dueNotNull',(select attnotnull from pg_attribute where attrelid='public.notas_fiscais'::regclass and attname='data_vencimento'),
 'nfseRows',(select count(*) from public.notas_fiscais where tipo_documento_fiscal='NFSE'),
 'rows',jsonb_build_object('notes',(select count(*) from public.notas_fiscais),'operations',(select count(*) from public.operacoes),'audit',(select count(*) from public.logs_auditoria)),
 'dataHash',jsonb_build_object(
  'notes',(select md5(coalesce(string_agg(to_jsonb(n)::text,'' order by id),'')) from public.notas_fiscais n),
  'operations',(select md5(coalesce(string_agg(to_jsonb(o)::text,'' order by id),'')) from public.operacoes o),
  'audit',(select md5(coalesce(string_agg(to_jsonb(a)::text,'' order by id),'')) from public.logs_auditoria a)),
 'schemaHash',jsonb_build_object(
  'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'|' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'),
  'constraints',(select md5(string_agg(conrelid::text||conname||pg_get_constraintdef(oid),'|' order by oid)) from pg_constraint where connamespace in ('public'::regnamespace,'private'::regnamespace)),
  'columns',(select md5(string_agg(to_jsonb(a)::text,'|' order by a.attrelid,a.attnum)) from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace in ('public'::regnamespace,'private'::regnamespace)),
  'triggers',(select md5(string_agg(pg_get_triggerdef(t.oid),'|' order by t.oid)) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace in ('public'::regnamespace,'private'::regnamespace)),
  'policies',(select md5(string_agg(to_jsonb(p)::text,'|' order by p.oid)) from pg_policy p))
) as state`
function query(sql, name) {
  assert(readFileSync('supabase/.temp/project-ref', 'utf8').trim() === ref, 'HOMOLOG_LINK_CHANGED')
  const file = `rehearsal/tmp/guibor-history-${name}.sql`
  writeFileSync(file, sql)
  const result = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js','db','query','--linked','--file',file,'--output','json'], { encoding:'utf8',windowsHide:true,timeout:60000 })
  if (result.status !== 0) {
    writeFileSync(`rehearsal/reports/GUIBOR_HISTORY_${name}_ERROR.txt`, result.stderr || 'CLI failed')
    throw new Error(`HISTORY_${name}_QUERY_FAILED_SEE_LOCAL_REPORT`)
  }
  return JSON.parse(result.stdout).rows[0].state
}
function validate(state, expected) {
  assert(state.historyCount === 1 && state.history.length === 1, 'HISTORY_TARGET_NOT_ONE')
  assert(hash(state.history[0]) === expected, 'HISTORY_HASH_MISMATCH_STOP')
  assert(state.p17 && state.dueNotNull && state.nfseRows === 0, 'BASELINE_DRIFT_STOP')
  assert(state.constraintsCount === 4 && state.constraintsHash === constraintsHash, 'CONSTRAINT_DRIFT_STOP')
  const bodies = [...source.matchAll(/create function private\.(\w+)\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/g)]
  assert(bodies.length === 2 && Object.keys(state.functions).length === 2, 'FUNCTION_COUNT_DRIFT_STOP')
  for (const [, name, body] of bodies) assert(state.functions[name] === body, 'FUNCTION_BODY_DRIFT_STOP')
}
const before = query(snapshot, 'PRECHECK')
const summary = state => ({ target:ref,version,historyHash:hash(state.history[0]),constraintsHash:state.constraintsHash,rows:state.rows,schemaHash:state.schemaHash,dataHash:state.dataHash,p17:state.p17,dueNotNull:state.dueNotNull,nfseRows:state.nfseRows })
writeFileSync('rehearsal/reports/GUIBOR_HISTORY_PRECHECK.json', JSON.stringify(summary(before),null,2))
console.log(JSON.stringify(summary(before)))
validate(before, badHash)
if (process.argv.includes('--repair')) {
  const invariant = { ...before }; delete invariant.history
  const sql = `begin; set local lock_timeout='5s'; set local statement_timeout='25s';
do $repair$ declare current_state jsonb; changed integer; begin
 perform 1 from supabase_migrations.schema_migrations where version='${version}' for update;
 ${snapshot.replace(' as state', '')} into current_state;
 if (current_state-'history') is distinct from ${sqlLiteral(JSON.stringify(invariant))}::jsonb
    or encode(extensions.digest(current_state->'history'->>0,'sha256'),'hex') <> '${badHash}'
 then raise exception 'GUIBOR precheck changed; rollback'; end if;
 update supabase_migrations.schema_migrations
 set statements=array[${sqlLiteral(source)}]
 where version='${version}' and array_length(statements,1)=1
 and encode(extensions.digest(statements[1],'sha256'),'hex')='${badHash}';
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'GUIBOR target rowcount mismatch'; end if;
 ${snapshot.replace(' as state', '')} into current_state;
 if (current_state-'history') is distinct from ${sqlLiteral(JSON.stringify(invariant))}::jsonb
    or encode(extensions.digest(current_state->'history'->>0,'sha256'),'hex') <> '${goodHash}'
 then raise exception 'GUIBOR postcheck failed; rollback'; end if;
end $repair$;
commit;
${snapshot};`
  const after = query(sql,'REPAIR')
  validate(after,goodHash)
  const afterInvariant = { ...after }; delete afterInvariant.history
  assert(JSON.stringify(afterInvariant) === JSON.stringify(invariant), 'POSTCHECK_INVARIANT_MISMATCH_STOP')
  assert(after.history[0] === source, 'POSTCHECK_SOURCE_MISMATCH_STOP')
  const report = { ...summary(after),repair:'PASS',schemaUnchanged:true,operationalDml:'ZERO',productionChanged:false }
  writeFileSync('rehearsal/reports/GUIBOR_HISTORY_REPAIR.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
} else console.log('READ_ONLY_PRECHECK_PASS')
