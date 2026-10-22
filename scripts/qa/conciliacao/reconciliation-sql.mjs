import assert from 'node:assert/strict'
import { randomBytes,createHash } from 'node:crypto'
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { checkReconciliation } from './reconciliation-checks.mjs'

// Focused exact schema/functions rehearsal, not native Auth/Storage E2E.
assert.deepEqual(process.argv.slice(2),['--local-only'])
assert(!process.env.DOCKER_HOST || /^(npipe:|unix:)/.test(process.env.DOCKER_HOST),'REMOTE_DOCKER_REFUSED')
const read=path=>readFileSync(new URL(`../../../${path}`,import.meta.url),'utf8').replaceAll('\r\n','\n')
const catalog=JSON.parse(read('scripts/qa/vortx/__fixtures__/native-stock-catalog.json'))
const fiscal=JSON.parse(read('scripts/qa/vortx/__fixtures__/native-stock-fiscal-helper.json'))
const oldFunctions=JSON.parse(read('scripts/qa/vortx/__fixtures__/native-stock-functions-baseline.json')).functions
const baseline=JSON.parse(read('scripts/qa/conciliacao/__fixtures__/persistir-v1.json'))
const path='supabase/migrations/20261022174904_financial_reconciliation_conditional_movements.sql', migration=read(path)
const sha=value=>createHash('sha256').update(value).digest('hex')
const q=value=>'"'+value.replaceAll('"','""')+'"'
const output=resolve(process.env.LOCALAPPDATA || process.env.TMPDIR || '/tmp','bw-antecipa-evidence',`reconciliation-v2-${Date.now()}`)
mkdirSync(output,{recursive:true})
const docker=(args,optional=false)=>{
  const result=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4*1024*1024})
  if(!optional)assert.equal(result.status,0,`DOCKER_${args[0]}_FAILED`)
  return result.stdout.trim()
}
const inventory=()=>Object.fromEntries([['containers',['ps','-aq']],['networks',['network','ls','-q']],['volumes',['volume','ls','-q']]].map(([key,args])=>[key,docker(args).split(/\s+/).filter(Boolean).sort()]))
const before=inventory(), report={scope:'LOCAL_RECONCILIATION_V2_SQL_RLS',migration:path,sha256:sha(migration),baselineSha256:sha(baseline.definition),stacks:[],remoteChanges:false,DOCKER_TEST_ENV_CLEANUP:false}
try {
  for(let iteration=1;iteration<=2;iteration++) {
    const name=`bw-recon-v2-${Date.now()}-${iteration}`, stack={iteration,tests:[],cleanup:false}; report.stacks.push(stack)
    let db,container=false,network=false
    try {
      docker(['network','create','--label',`bw.qa.scope=${name}`,name]);network=true
      const password=randomBytes(32).toString('hex')
      docker(['run','-d','--name',name,'--label',`bw.qa.scope=${name}`,'--network',name,'-p','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data','-e',`POSTGRES_PASSWORD=${password}`,'postgres:17-alpine']);container=true
      const mapping=docker(['port',name,'5432/tcp']);assert.match(mapping,/^127\.0\.0\.1:\d+$/)
      const config={host:'127.0.0.1',port:Number(mapping.split(':')[1]),user:'postgres',password,database:'postgres',connectionTimeoutMillis:3000}
      for(let i=0;i<40;i++) {db=new pg.Client(config);try{await db.connect();break}catch{await db.end().catch(()=>{});db=null;await new Promise(r=>setTimeout(r,500))}}
      assert(db,'LOCAL_POSTGRES_UNAVAILABLE')
      await db.query(`create schema auth;create schema private;create role anon nologin;create role authenticated nologin;create role service_role nologin;
        grant usage on schema public,private,auth to authenticated,service_role;
        create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
        create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;`)
      for(const e of catalog.enums)await db.query(`create type public.${q(e.name)} as enum (${e.labels.map(x=>`'${x.replaceAll("'","''")}'`).join(',')})`)
      for(const t of catalog.tables)await db.query(`create table public.${q(t.name)} (${t.columns})`)
      for(const f of fiscal)await db.query(f.definition)
      for(const foreign of [false,true])for(const c of catalog.constraints)if(c.definition.startsWith('FOREIGN KEY')===foreign)await db.query(`alter table public.${q(c.table)} add constraint ${q(c.name)} ${c.definition}`)
      const dependencyOrder=['gestor_tem_acesso_fundo_operacional','usuario_e_super_admin','financeiro_chamada_service_role']
      for(const f of [...catalog.functions].sort((a,b)=>(dependencyOrder.includes(a.name)?dependencyOrder.indexOf(a.name):100)-(dependencyOrder.includes(b.name)?dependencyOrder.indexOf(b.name):100)))await db.query(f.definition)
      for(const f of oldFunctions)await db.query(f.definition)
      await db.query(`create unique index importacoes_publicada_unica_idx on importacoes_financeiras(fundo_id,tipo_base,data_referencia) where status='PUBLICADA';
        alter table estoque_posicoes enable row level security;alter table importacoes_financeiras enable row level security;
        grant select on estoque_posicoes,importacoes_financeiras to authenticated;
        create policy legacy_stock_read on estoque_posicoes for select to authenticated using(private.financeiro_gestor_tem_acesso_fundo(fundo_id));
        create policy metadata_read on importacoes_financeiras for select to authenticated using(private.financeiro_gestor_tem_acesso_fundo(fundo_id));`)
      await db.query(read('supabase/migrations/20261019192624_vortx_native_stock.sql'))
      const calendar=read('supabase/migrations/20260805160000_metodos_calculo_financeiro_operacao.sql')
      await db.query(calendar.slice(calendar.indexOf('CREATE OR REPLACE FUNCTION private.pascoa_gregoriana'),calendar.indexOf('CREATE OR REPLACE FUNCTION private.calcular_memoria_financeira_nf')))
      await db.query('REVOKE ALL ON FUNCTION private.eh_dia_util_anbima(date),private.pascoa_gregoriana(integer) FROM PUBLIC,anon,authenticated')
      await db.query(baseline.definition)
      await db.query('REVOKE ALL ON FUNCTION public.persistir_conciliacao_execucao(jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.persistir_conciliacao_execucao(jsonb) TO service_role')
      const acl=(await db.query("select proacl::text acl from pg_proc where oid='public.persistir_conciliacao_execucao(jsonb)'::regprocedure")).rows[0].acl
      await db.query('begin');await db.query(migration);await db.query('rollback')
      assert.equal((await db.query("select to_regprocedure('public.diagnosticar_variacao_estoques(uuid,uuid,uuid)') r")).rows[0].r,null)
      assert.equal((await db.query("select pg_get_functiondef('public.persistir_conciliacao_execucao(jsonb)'::regprocedure) d")).rows[0].d,baseline.definition)
      stack.tests.push('forward_rollback_preserves_exact_v1_function')
      await db.query(migration)
      assert.equal((await db.query("select proacl::text acl from pg_proc where oid='public.persistir_conciliacao_execucao(jsonb)'::regprocedure")).rows[0].acl,acl)
      assert.equal((await db.query("select prosecdef from pg_proc where oid='public.diagnosticar_variacao_estoques(uuid,uuid,uuid)'::regprocedure")).rows[0].prosecdef,false)
      stack.tests.push('existing_acl_preserved_and_new_read_rpc_is_rls_invoker')
      async function asRole(role,sql,params=[],user=null) {
        assert(['authenticated','anon','service_role'].includes(role));await db.query('begin')
        try {await db.query(`set local role ${role}`);await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role,sub:user,aal:'aal2'})]);const result=await db.query(sql,params);await db.query('commit');return result}
        catch(error){await db.query('rollback');throw error}
      }
      await checkReconciliation({db,asRole,stack,config})
    } finally {
      await db?.end().catch(()=>{})
      if(container)docker(['rm','-f',name],true)
      if(network)docker(['network','rm',name],true)
      stack.cleanup=!docker(['ps','-aq','--filter',`label=bw.qa.scope=${name}`])&&!docker(['network','ls','-q','--filter',`label=bw.qa.scope=${name}`])
      assert(stack.cleanup,'OWNED_RESOURCES_NOT_CLEANED')
    }
  }
  report.passed=true
}catch(error){report.passed=false;report.error={message:String(error.message).slice(0,500),code:error.code??null};process.exitCode=1}
finally {
  const after=inventory();report.DOCKER_TEST_ENV_CLEANUP=JSON.stringify(before)===JSON.stringify(after)&&report.stacks.every(s=>s.cleanup)
  if(!report.DOCKER_TEST_ENV_CLEANUP)process.exitCode=1
  writeFileSync(resolve(output,'REPORT.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({output,passed:report.passed,stacks:report.stacks.map(s=>({iteration:s.iteration,checks:s.tests.length,cleanup:s.cleanup})),error:report.error??null,DOCKER_TEST_ENV_CLEANUP:report.DOCKER_TEST_ENV_CLEANUP}))
}
