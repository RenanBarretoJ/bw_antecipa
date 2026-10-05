// Read-only certification, apart from real QA Auth session creation.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { connect, ref, migration } from './preview-runtime.mjs'
import { d, state, id, val, login } from './auth-runtime.mjs'

assert.deepEqual(process.argv.slice(2),['--run'])
const db=await connect(d),checks=[]
try {
  const before=(await db.query("select md5(string_agg(to_jsonb(a)::text,'' order by a.id)) hash from public.sacado_acessos a")).rows[0].hash
  const m=migration()
  const history=(await db.query('select version,name from supabase_migrations.schema_migrations order by version')).rows
  assert.deepEqual(history,[{version:m.version,name:m.name}]);checks.push('ONLY_EXPLICIT_MIGRATION_RECORDED','ORIGINAL_A6_ABSENT')
  const a=await login('sacadoA'),b=await login('sacadoB'),g=await login('gestor'),weak=await login('gestor',false)
  assert.equal(val(await a.rpc('get_user_sacado_context')).length,2)
  assert.equal(val(await b.rpc('get_user_sacado_context')).length,1)
  const badBatch=await a.rpc('processar_aceite_sacado',{p_nota_fiscal_ids:[id('2a',3)],p_acao:'aceitar'})
  assert.equal(badBatch.error?.code,'42501')
  assert.equal(val(await a.from('notas_fiscais').select('id').eq('id',id('2a',4))).length,0)
  const denied=await b.rpc('processar_aceite_sacado',{p_nota_fiscal_ids:[id('2a')],p_acao:'aceitar'})
  assert.equal(denied.error?.code,'42501')
  checks.push('ROOT_CROSS_FUND_AND_UNLINKED_COMPANY_DENIED')
  const args={p_user_id:state.actors.sacadoB.id,p_fundo_id:id('22'),p_cnpj:'11344038002060',p_razao_social:'Empresa QA',p_acao:'revogar',p_nonce_hash:'f'.repeat(64)}
  assert.equal((await weak.rpc('gerenciar_sacado_acesso',args)).error?.code,'42501')
  assert.equal((await g.rpc('gerenciar_sacado_acesso',args)).error?.code,'42501')
  assert.equal((await g.rpc('listar_gestao_sacados',{p_fundo_id:id('22',2)})).error?.code,'42501')
  assert((await a.from('sacado_acessos').update({status:'inativo'}).eq('user_id',state.actors.sacadoA.id)).error)
  assert((await g.from('sacado_acessos').insert({user_id:state.actors.sacadoB.id,sacado_id:val(await b.rpc('get_user_sacado_context'))[0].sacado_id,fundo_id:id('22',2)})).error)
  const anon=createClient(d.SUPABASE_URL,d.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  assert((await anon.rpc('get_user_sacado_context')).error)
  checks.push('REAL_MFA_REQUIRED','NONCE_REQUIRED','GESTOR_OTHER_FUND_DENIED','DIRECT_MEMBERSHIP_WRITES_DENIED','ANONYMOUS_DENIED')
  for(const name of ['cedente','consultor']) {
    const c=await login(name)
    assert.equal(val(await c.from('sacado_acessos').select('id')).length,0)
    assert.equal((await c.rpc('gerenciar_sacado_acesso',args)).error?.code,'42501')
  }
  checks.push('CEDENTE_CONSULTOR_MEMBERSHIP_DENIED')
  assert.equal((await db.query("select md5(string_agg(to_jsonb(a)::text,'' order by a.id)) hash from public.sacado_acessos a")).rows[0].hash,before)
  checks.push('NEGATIVE_TESTS_NO_MUTATION')
  const resources={}
  for(const kind of ['container','volume','network']) {
    const args=kind==='container'?['ps','-a','--filter','label=com.supabase.cli.project=sacado-r2-20261005','--format','{{.ID}}']:[kind,'ls','--filter','label=com.supabase.cli.project=sacado-r2-20261005','--format','{{.Name}}']
    const result=spawnSync('docker',args,{encoding:'utf8',windowsHide:true});assert.equal(result.status,0);assert.equal(result.stdout.trim(),'');resources[kind]=0
  }
  checks.push('DOCKER_TEST_ENV_CLEANUP')
  writeFileSync('rehearsal/reports/SACADO_R2_FINAL_VERIFY.json',JSON.stringify({ref,at:new Date().toISOString(),checks,resources,history,migrationSha256:m.sha256,success:true},null,2))
  console.log(JSON.stringify({success:true,checks}))
} finally { await db.end() }
