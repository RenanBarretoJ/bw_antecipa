import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { connect, ref } from './preview-runtime.mjs'
import { d, state, id, val, login } from './auth-runtime.mjs'

assert.deepEqual(process.argv.slice(2),['--run'])
const db=await connect(d),checks=[]
try {
  // Explicit synthetic fixture only: move the cross-fund negative AFTER backfill.
  const r=await db.query('update public.notas_fiscais set fundo_id=$1,cedente_fundo_id=$2 where id=$3 and numero_nf=$4 returning id', [id('22',2),id('24',2),id('2a',4),'C21-CONSULTOR-LIVRE'])
  assert.equal(r.rowCount,1)
  for(const name of ['gestor','sacadoA','sacadoB','cedente','consultor']) {
    const client=await login(name)
    const links=val(await client.from('sacado_acessos').select('user_id,sacado_id,fundo_id,status'))
    if(name==='sacadoA') {
      assert.equal(links.length,1)
      const context=val(await client.rpc('get_user_sacado_context'))
      assert.equal(context.length,1);assert.equal(context[0].cnpj,'11344038002141')
      const nfs=val(await client.from('notas_fiscais').select('id'))
      assert.deepEqual(nfs.map(n=>n.id),[id('2a')])
      const before=(await db.query('select id,status from public.notas_fiscais order by id')).rows
      const bad=await client.rpc('processar_aceite_sacado',{p_nota_fiscal_ids:[id('2a'),id('2a',2)],p_acao:'aceitar',p_motivo:null})
      assert.equal(bad.error?.code,'42501','UNAUTHORIZED_BATCH_MUST_DENY')
      assert.deepEqual((await db.query('select id,status from public.notas_fiscais order by id')).rows,before)
      checks.push('LEGACY_SINGLE_CNPJ','ROOT_AND_CROSS_FUND_DENIED','REAL_JWT_BATCH_ATOMICITY')
    }
    if(['cedente','consultor','sacadoB'].includes(name)) assert.equal(links.length,0)
    if(name!=='gestor') {
      const result=await client.rpc('listar_gestao_sacados',{p_fundo_id:id('22'),p_busca:null,p_pagina:1,p_user_id:null})
      assert(result.error,'ADMIN_RPC_ROLE_DENIED')
    }
    checks.push(`REAL_AUTH_MFA_${name.toUpperCase()}`)
  }
  assert.equal((await db.query('select count(*)::int n from public.sacado_acessos')).rows[0].n,1)
  writeFileSync('rehearsal/reports/SACADO_R2_AUTH_PREFLIGHT.json',JSON.stringify({ref,checks,success:true,actors:Object.keys(state.actors)},null,2))
  console.log(JSON.stringify({success:true,checks}))
} finally { await db.end() }
