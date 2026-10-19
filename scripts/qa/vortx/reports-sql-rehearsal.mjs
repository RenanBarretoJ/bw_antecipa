import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../../../', import.meta.url))

// Focused SQL/RLS rehearsal, not a substitute for hosted Auth/TOTP E2E.
// Canonical definitions were exported read-only through the authenticated Supabase connector.
// No connection to a remote database and no remote credentials are used by this runner.
const evidence = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-reports-preview-20261019', `sql-${Date.now()}`)
mkdirSync(evidence, { recursive: true })
const migrationPath = 'supabase/migrations/20261019180624_vortx_report_requests_preview.sql'
const migration = readFileSync(resolve(repository, migrationPath), 'utf8')
const sha = value => createHash('sha256').update(value).digest('hex')
function docker(args, allowFailure = false) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 60000 })
  if (!allowFailure) assert.equal(result.status, 0, `DOCKER_${args[0]}_FAILED`)
  return result.stdout.trim()
}
const before = { containers: docker(['ps','-aq']).split(/\s+/).filter(Boolean).sort(), networks: docker(['network','ls','-q']).split(/\s+/).filter(Boolean).sort() }
const { functions } = JSON.parse(readFileSync(new URL('./__fixtures__/report-auth-canonical.json',import.meta.url),'utf8'))
assert.equal(functions.length, 5)
writeFileSync(resolve(evidence,'canonical-functions.json'), JSON.stringify(functions.map(f => ({ name:f.name, sha256:sha(f.definition) })),null,2))
const bootstrap = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema private;
grant usage on schema public,auth,private to authenticated;
create table public.profiles(id uuid primary key,status text not null);
create table public.usuario_papeis(usuario_id uuid,papel text,ativo boolean);
create table public.fundos(id uuid primary key,ativo boolean);
create table public.usuario_fundos(usuario_id uuid,fundo_id uuid,status text);
create table auth.sessions(id uuid primary key,user_id uuid,aal text,not_after timestamptz);
create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);
create table public.sessoes_elevadas(user_id uuid,session_id uuid,elevada_em timestamptz,expira_em timestamptz,revogada_em timestamptz,metodo text,factor_id text);
create table public.autorizacoes_acoes_sensiveis(id uuid primary key,user_id uuid,session_id uuid,action_type text,nonce_hash text,consumida_em timestamptz,revogada_em timestamptz,expira_em timestamptz);
create table public.integracoes_fundo(id uuid primary key,fundo_id uuid,status text);
create table public.integracao_fundo_versoes(id uuid primary key,integracao_fundo_id uuid,ambiente text,status text,adapter_key text,configuracao_nao_sensivel jsonb);
create table public.integracao_fundo_versao_capacidades(integracao_fundo_versao_id uuid,fundo_id uuid,ambiente text,capability text,disponivel_desde timestamptz,disponivel_ate timestamptz);
create table public.seguranca_eventos(id uuid default gen_random_uuid(),tipo_evento text,ator_usuario_id uuid,ator_tipo text,origem text,severidade text,entidade_tipo text,entidade_id uuid,dados jsonb);
`
const report = { scope:'LOCAL_FOCUSED_SQL_RLS_ONLY', migration:migrationPath, migrationSha256:sha(migration), canonicalFunctions:functions.map(f=>({name:f.name,sha256:sha(f.definition)})), stacks:[], DOCKER_TEST_ENV_CLEANUP:false, error:null }
try {
  for (let iteration=1; iteration<=2; iteration++) {
    const scope = `bw-vortx-reports-${Date.now()}-${iteration}`
    let createdContainer = false; let createdNetwork = false; let db
    const stack = { iteration, tests:[], cleanup:false }; report.stacks.push(stack)
    try {
      docker(['network','create','--label',`bw.qa.scope=${scope}`,'--opt','com.docker.network.bridge.enable_icc=false',scope]); createdNetwork=true
      const password = randomBytes(32).toString('hex')
      docker(['run','-d','--name',scope,'--label',`bw.qa.scope=${scope}`,'--network',scope,'-p','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data','-e',`POSTGRES_PASSWORD=${password}`,'postgres:17-alpine']); createdContainer=true
      const mapping = docker(['port',scope,'5432/tcp'])
      assert.match(mapping,/^127\.0\.0\.1:\d+$/)
      const port = Number(mapping.split(':')[1])
      const config = { host:'127.0.0.1',port,user:'postgres',password,database:'postgres',connectionTimeoutMillis:3000 }
      for (let attempt=0; attempt<40; attempt++) {
        db = new pg.Client(config)
        try { await db.connect(); break } catch { await db.end().catch(()=>{}); db=null; await new Promise(r=>setTimeout(r,500)) }
      }
      assert(db,'LOCAL_POSTGRES_UNAVAILABLE')
      await db.query(bootstrap)
      for (const f of functions) await db.query(f.definition)
      await db.query(migration)
      stack.tests.push('migration_from_focused_baseline')
      const fund=randomUUID(), otherFund=randomUUID(), version=randomUUID(), otherVersion=randomUUID(), integration=randomUUID(), otherIntegration=randomUUID()
      await db.query('insert into fundos values($1,true),($2,true)',[fund,otherFund])
      await db.query("insert into integracoes_fundo values($1,$2,'ativa'),($3,$4,'ativa')",[integration,fund,otherIntegration,otherFund])
      for (const [v,i] of [[version,integration],[otherVersion,otherIntegration]]) await db.query("insert into integracao_fundo_versoes values($1,$2,'producao','publicada','vortx_vrs',$3)",[v,i,{codigo_carteira:'qa-carteira-sintetica'}])
      for (const capability of ['ESTOQUE','AQUISICOES','LIQUIDACOES']) await db.query("insert into integracao_fundo_versao_capacidades values($1,$2,'producao',$3,now()-interval '1 day',null)",[version,fund,capability])
      async function actor({superAdmin=true,bound=fund,active=true}={}) {
        const a={id:randomUUID(),session:randomUUID(),factor:randomUUID()}
        await db.query('insert into profiles values($1,$2)',[a.id,active?'ativo':'inativo'])
        if(superAdmin)await db.query("insert into usuario_papeis values($1,'super_admin',true)",[a.id])
        if(bound)await db.query("insert into usuario_fundos values($1,$2,'ativo')",[a.id,bound])
        await db.query("insert into auth.sessions values($1,$2,'aal2',null)",[a.session,a.id])
        await db.query("insert into auth.mfa_factors values($1,$2,'verified')",[a.factor,a.id])
        await db.query("insert into sessoes_elevadas values($1,$2,now(),now()+interval '1 hour',null,'totp',$3)",[a.id,a.session,a.factor])
        return a
      }
      const admin=await actor(), ordinary=await actor({superAdmin:false}), cross=await actor({bound:otherFund}), unlinked=await actor({bound:null}), inactive=await actor({active:false})
      async function nonce(a) {
        const hash=sha(randomUUID())
        await db.query("insert into autorizacoes_acoes_sensiveis values($1,$2,$3,'testar_conexao_vortx_vrs',$4,null,null,now()+interval '2 minutes')",[randomUUID(),a.id,a.session,hash]); return hash
      }
      async function asActor(a, sql, params=[], {role='authenticated',claims={}}={}) {
        await db.query('begin')
        try {
          await db.query(`set local role ${role}`)
          await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:a?.id,session_id:a?.session,aal:'aal2',role,...claims})])
          const result=await db.query(sql,params); await db.query('commit'); return result
        } catch(error) { await db.query('rollback'); throw error }
      }
      const day='2026-10-01',end='2026-10-16',lease=randomBytes(32).toString('hex')
      const reserveSql='select public.admin_reservar_relatorio_vortx($1,$2,$3,$4,$5,$6,$7,$8,$9) as r'
      const args=(hash,changes={})=>Object.values({fund,version,type:'PosicaoParcela',start:day,end,reference:end,extension:2,hash,lease:sha(lease),...changes})
      const first=(await asActor(admin,reserveSql,args(await nonce(admin)))).rows[0].r
      assert.equal(first.criada,true); assert(!('lease_hash' in first.solicitacao)); assert(!('session_id' in first.solicitacao))
      const id=first.solicitacao.id
      stack.tests.push('canonical_mfa_nonce_reservation_no_secret_return')
      const second=(await asActor(admin,reserveSql,args(await nonce(admin)))).rows[0].r
      assert.equal(second.criada,false); assert.equal(second.solicitacao.id,id)
      stack.tests.push('identical_payload_reserves_once')
      for(const [label,a] of [['ordinary_gestor',ordinary],['other_fund',cross],['unlinked',unlinked],['inactive_profile',inactive]]) {
        assert.equal((await asActor(a,'select admin_listar_relatorios_vortx($1,1) as r',[fund])).rows[0].r.total,0)
        await assert.rejects(asActor(a,reserveSql,args(await nonce(a))),{code:'42501'}); stack.tests.push(`rls_${label}`)
      }
      await assert.rejects(asActor(null,'select admin_listar_relatorios_vortx($1,1)',[fund],{role:'anon'}),{code:'42501'}); stack.tests.push('anon_rpc_denied')
      const identity=(await asActor(admin,'select current_user as actor,(select rolbypassrls from pg_roles where rolname=current_user) as bypass')).rows[0]
      assert.deepEqual(identity,{actor:'authenticated',bypass:false}); stack.tests.push('authenticated_non_owner_non_bypass_actor')
      for(const [label,claims] of [['aal1',{aal:'aal1'}],['missing_session',{session_id:null}]]) {
        await assert.rejects(asActor(admin,reserveSql,args(await nonce(admin)),{claims}),{code:'42501'}); stack.tests.push(label)
      }
      for(const [label,change,restore] of [
        ['mfa_expired',"update sessoes_elevadas set expira_em=now()-interval '1 second' where user_id=$1","update sessoes_elevadas set expira_em=now()+interval '1 hour' where user_id=$1"],
        ['mfa_revoked','update sessoes_elevadas set revogada_em=now() where user_id=$1','update sessoes_elevadas set revogada_em=null where user_id=$1'],
        ['factor_unverified',"update auth.mfa_factors set status='unverified' where user_id=$1","update auth.mfa_factors set status='verified' where user_id=$1"],
      ]) {
        await db.query(change,[admin.id]); await assert.rejects(asActor(admin,reserveSql,args(await nonce(admin))),{code:'42501'}); await db.query(restore,[admin.id]); stack.tests.push(label)
      }
      const used=await nonce(admin); await asActor(admin,reserveSql,args(used)); await assert.rejects(asActor(admin,reserveSql,args(used)),{code:'42501'})
      await assert.rejects(asActor(admin,reserveSql,args(sha('nonexistent'))),{code:'42501'}); stack.tests.push('nonce_missing_and_reused_denied')
      for(const [label,change,code] of [['cross_version',{version:otherVersion},'42501'],['invalid_type',{type:'Consolidado'},'22023'],['future',{end:'2999-01-01'},'22023'],['same_day',{end:day},'22023'],['invalid_extension',{extension:3},'22023']]) {
        await assert.rejects(asActor(admin,reserveSql,args(await nonce(admin),change)),{code}); stack.tests.push(label)
      }
      await db.query("update integracao_fundo_versao_capacidades set disponivel_ate=now()-interval '1 second' where capability='ESTOQUE'")
      await assert.rejects(asActor(admin,reserveSql,args(await nonce(admin))),{code:'42501'})
      await db.query('update integracao_fundo_versao_capacidades set disponivel_ate=null'); stack.tests.push('inactive_capability_denied')
      for(const sql of ['select lease_hash from vortx_relatorio_solicitacoes','select session_id from vortx_relatorio_solicitacoes',"update vortx_relatorio_solicitacoes set estado='aceita'",'delete from vortx_relatorio_solicitacoes']) await assert.rejects(asActor(admin,sql),{code:'42501'})
      stack.tests.push('no_direct_dml_or_lease_session_read')
      const transition='select admin_transicionar_relatorio_vortx($1,$2,$3,$4,$5) as r'
      await assert.rejects(asActor(admin,transition,[id,'0'.repeat(64),'enviando',null,null]),{code:'42501'})
      await assert.rejects(asActor(cross,transition,[id,lease,'enviando',null,null]),{code:'42501'})
      await assert.rejects(asActor(admin,transition,[id,lease,'aceita',randomUUID(),200]),{code:'23514'})
      await db.query("update integracao_fundo_versoes set status='desativada' where id=$1",[version])
      await assert.rejects(asActor(admin,transition,[id,lease,'enviando',null,null]),{code:'42501'})
      await db.query("update integracao_fundo_versoes set status='publicada' where id=$1",[version])
      stack.tests.push('integration_revocation_between_reservation_and_post_denied')
      await asActor(admin,transition,[id,lease,'enviando',null,null])
      await assert.rejects(asActor(admin,transition,[id,lease,'aceita',null,200]),{code:'23514'})
      await assert.rejects(asActor(admin,transition,[id,lease,'aceita',randomUUID(),null]),{code:'23514'})
      await assert.rejects(asActor(admin,transition,[id,lease,'recusada',null,null]),{code:'23514'})
      const protocol=randomUUID(); const accepted=(await asActor(admin,transition,[id,lease,'aceita',protocol,200])).rows[0].r
      assert.equal(accepted.protocolo_externo,protocol)
      await assert.rejects(asActor(admin,transition,[id,lease,'enviando',null,null]),{code:'23514'})
      stack.tests.push('lease_scope_transitions_and_protocol_constraints')
      const unknown=(await asActor(admin,reserveSql,args(await nonce(admin),{type:'Inclusao'}))).rows[0].r
      await asActor(admin,transition,[unknown.solicitacao.id,lease,'enviando',null,null]); await asActor(admin,transition,[unknown.solicitacao.id,lease,'indeterminada',null,null])
      assert.equal((await asActor(admin,reserveSql,args(await nonce(admin),{type:'Inclusao'}))).rows[0].r.criada,false); stack.tests.push('unknown_never_automatically_resends')
      const raceNonces=[await nonce(admin),await nonce(admin)]
      const clients=await Promise.all(raceNonces.map(async()=>{const c=new pg.Client(config);await c.connect();return c}))
      try {
        const race=await Promise.all(clients.map(async(c,index)=>{
          await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:admin.id,session_id:admin.session,aal:'aal2',role:'authenticated'})])
          const r=(await c.query(reserveSql,args(raceNonces[index],{type:'Exclusao'}))).rows[0].r;await c.query('commit');return r
        }))
        assert.equal(race.filter(r=>r.criada).length,1); assert.equal(race[0].solicitacao.id,race[1].solicitacao.id)
      } finally { await Promise.all(clients.map(c=>c.end())) }
      stack.tests.push('concurrent_reservations_one_winner')
      const audits=(await db.query("select count(*)::int as n from seguranca_eventos where tipo_evento='AUTORIZACAO_SENSIVEL_CONSUMIDA'")).rows[0].n
      assert(audits>=5);stack.tests.push('atomic_nonce_and_security_audit')
      const grants=(await db.query("select relrowsecurity from pg_class where oid='public.vortx_relatorio_solicitacoes'::regclass")).rows[0]
      assert.equal(grants.relrowsecurity,true)
    } finally {
      if(db)await db.end()
      if(createdContainer) {
        assert.equal(docker(['inspect','--format','{{index .Config.Labels "bw.qa.scope"}}',scope]),scope)
        docker(['rm','-f',scope]); assert.equal(docker(['ps','-aq','--filter',`name=^/${scope}$`]),'')
      }
      if(createdNetwork) { assert.equal(docker(['network','inspect','--format','{{index .Labels "bw.qa.scope"}}',scope]),scope);docker(['network','rm',scope]) }
      stack.cleanup=true
    }
  }
} catch(error) { report.error={name:error.name,code:error.code||null,message:error.message?.slice(0,200)}; process.exitCode=1 }
finally {
  const after={containers:docker(['ps','-aq']).split(/\s+/).filter(Boolean).sort(),networks:docker(['network','ls','-q']).split(/\s+/).filter(Boolean).sort()}
  report.DOCKER_TEST_ENV_CLEANUP=JSON.stringify(before)===JSON.stringify(after) && report.stacks.every(s=>s.cleanup)
  writeFileSync(resolve(evidence,'REPORT.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({evidence,passed:!report.error,stacks:report.stacks.map(s=>({iteration:s.iteration,checks:s.tests.length,cleanup:s.cleanup})),error:report.error,DOCKER_TEST_ENV_CLEANUP:report.DOCKER_TEST_ENV_CLEANUP}))
}
