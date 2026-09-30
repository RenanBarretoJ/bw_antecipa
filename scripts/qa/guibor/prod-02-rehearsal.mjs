// Creates a NEW schema-only Docker database; never restores customer records.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { container, db, local, run, migrations, noC5Sql, historySql, save } from './prod-02-control.mjs'
import { applicationTransaction } from './prod-02-transaction.mjs'
const pre=JSON.parse(readFileSync('rehearsal/reports/GUIBOR_PROD_02_PREFLIGHT.json','utf8'))
assert.equal(pre.target,'wwsndnuvnjuabpbjwlck')
const catalogSql=readFileSync('scripts/qa/guibor/a6-r2-catalog.sql','utf8')
const quote=s=>'"'+s.replaceAll('"','""')+'"'
if(process.argv.includes('--prepare')) {
  assert.equal(local(`select count(*) from pg_database where datname='${db}'`,'postgres'),'0','DATABASE_ALREADY_EXISTS_STOP')
  const schema=run('docker',['exec',container,'pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--no-owner'])
  run('docker',['exec',container,'createdb','-U','supabase_admin','-O','postgres',db])
  // Supabase schema dump must retain extension-owner privileges during restore.
  run('docker',['exec','-i',container,'psql','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1','-q'],schema)
}
if(process.argv.includes('--prepare') || process.argv.includes('--resume-baseline')) {
  assert.equal(local(`select count(*) from auth.users`),'0')
  run('docker',['exec','-i',container,'psql','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1','-q'],`DO $owners$ DECLARE r record; BEGIN
    FOR r IN SELECT c.relname,n.nspname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private') AND c.relkind IN('r','p','v','m') LOOP
      EXECUTE format('ALTER %s %I.%I OWNER TO postgres',CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,r.nspname,r.relname);
    END LOOP;
    FOR r IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.prokind='f' LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',r.sig); END LOOP;
  END $owners$; ALTER SCHEMA public OWNER TO pg_database_owner; ALTER SCHEMA private OWNER TO postgres;
  ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres;`)
  for(const version of ['20260928120000','20260928183000','20260928185439','20260928193000','20260929141740']) {
    const directory=version==='20260928185439'?'../bw_antecipa_guibor_a6_r2/supabase/migrations':'supabase/migrations'
    const file=readdirSync(directory).find(f=>f.startsWith(version+'_'))
    assert(file,'BASELINE_FILE_MISSING')
    const source=readFileSync(`${directory}/${file}`,'utf8').replace(/\r\n/g,'\n')
    const recorded=pre.history.find(r=>r.version===version).hash
    // The three deployed C2.1 history rows contain no statements. Verify their
    // resulting objects with the full live production catalog below, not a fake hash.
    const emptyHistory=['20260928120000','20260928183000','20260928193000'].includes(version)
      && recorded==='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    if(!emptyHistory) assert.equal(createHash('sha256').update(source).digest('hex'),recorded,'BASELINE_HASH_MISMATCH')
    local(source)
  }
}
if(['--prepare','--resume-baseline','--resume-catalog'].some(arg=>process.argv.includes(arg))) {
  const existing=JSON.parse(local(`select coalesce(jsonb_agg(policyname),'[]') from pg_policies where schemaname='storage'`))
  for(const p of pre.policies.filter(p=>!existing.includes(p.policyname))) {
    const roleNames=Array.isArray(p.roles)?p.roles:p.roles.replace(/^\{|\}$/g,'').split(',')
    assert(roleNames.every(r=>/^[a-z_]+$/.test(r)),'UNEXPECTED_ROLE_FORMAT')
    const roles=roleNames.map(r=>r==='public'?'PUBLIC':quote(r)).join(',')
    local(`CREATE POLICY ${quote(p.policyname)} ON storage.${quote(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${roles}${p.qual?` USING (${p.qual})`:''}${p.with_check?` WITH CHECK (${p.with_check})`:''};`)
  }
  for(const r of pre.repairs) local(r.definition)
}
const report={target:db,startedAt:new Date().toISOString(),migrations:migrations.map(({file,version,name,hash})=>({file,version,name,hash})),tests:{},success:false}
assert.equal(local('select count(*) from auth.users'),'0')
assert.equal(local('select count(*) from public.operacoes'),'0')
assert.deepEqual(JSON.parse(local(noC5Sql)),{helper:null,history:0,oldA6:0})
if(!process.argv.includes('--tests-only')) {
const current=JSON.parse(local(catalogSql))
const deparser=new Set(['public.comunicacoes.comunicacoes_remetente_nome_check','public.documento_upload_intents.documento_upload_intents_storage_path_check'])
const mismatches=pre.catalog.filter(o=>!current.some(a=>a.kind===o.kind&&a.name===o.name&&a.hash===o.hash))
report.baselineMismatches=mismatches
save('REHEARSAL',report)
assert.deepEqual(mismatches.filter(o=>!(o.kind==='constraint'&&deparser.has(o.name))),[],'PRODUCTION_BASELINE_DRIFT_STOP')
assert.equal(local(`select count(*) from information_schema.columns where table_schema='public' and column_name in ('fiscal_proveniencia','base_antecipacao_snapshot','comissao_habilitada')`),'0','FRESH_BASELINE_REQUIRED')
// First dry application rolls back: validates whole-chain transactional behavior.
local(applicationTransaction(migrations,'ROLLBACK'))
assert.equal(local(`select to_regclass('public.nfse_review_intents') is null`),'t')
local(applicationTransaction(migrations))
} else {
  const prior=JSON.parse(readFileSync('rehearsal/reports/GUIBOR_PROD_02_REHEARSAL.json','utf8'))
  assert.equal(prior.target,db)
  report.baselineMismatches=prior.baselineMismatches
  assert.equal(report.baselineMismatches.length,2)
}
const recorded=JSON.parse(local(`select jsonb_agg(h) from (${historySql}) h`))
for(const m of migrations) assert(recorded.some(r=>r.version===m.version&&r.hash===m.hash),'APPLIED_HASH_MISMATCH')
local('CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;')
for(const name of ['guibor_a5_base','guibor_a6_comissao','guibor_a6_r2_analytics_scope','c1_1_organizacao_consultora','c2_1_r2_fluxo_taxa']) {
  const source=readFileSync(`supabase/tests/${name}.test.sql`,'utf8').replace(/^\\set.*$/mg,'')
    .replace(/^\\ir (.+)$/mg,(_,f)=>readFileSync(`supabase/tests/${f.trim()}`,'utf8'))
  const output=local(source)
  assert(!/^not ok|Looks like you failed|Looks like you planned/m.test(output),output)
  report.tests[name]=output.split('\n').filter(s=>s.startsWith('ok ')).length
  console.log(name+': '+report.tests[name]+' PASS')
}
let fixture=readFileSync('supabase/tests/c2_1_r2_fluxo_taxa.test.sql','utf8').match(/DO \$setup\$[\s\S]*?\$setup\$;/)[0]
fixture=fixture.slice(0,fixture.indexOf('INSERT INTO public.notas_fiscais'))+'END; $setup$;'
assert(fixture.includes('INSERT INTO public.consultor_usuarios'))
const receipt=local(`BEGIN;${fixture}\n${readFileSync('supabase/tests/guibor_nfse_review_intents.assert.sql','utf8')}\nROLLBACK;`)
assert(receipt.includes('GUIBOR_REVIEW_LOCAL_SQL_PASS'))
report.tests.reviewReceipt=true
assert.deepEqual(JSON.parse(local(noC5Sql)),{helper:null,history:0,oldA6:0})
assert.equal(local('select count(*) from auth.users'),'0')
assert.equal(local('select count(*) from public.operacoes'),'0')
report.success=true;report.finishedAt=new Date().toISOString();save('REHEARSAL',report)
console.log('GUIBOR_PROD_02_REHEARSAL_PASS')
