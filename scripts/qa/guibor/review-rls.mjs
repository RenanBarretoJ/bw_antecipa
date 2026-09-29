import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ref, phase, homolog } from './review-target.mjs'
assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref)
// In homolog B owns isolated QA roles/fund; A is the protected pre-existing cedente.
const [a,b]=(homolog?['B','A']:['A','B']).map(l=>JSON.parse(readFileSync(`rehearsal/reports/GUIBOR_${phase}_${l}.json`,'utf8')))
assert([a,b].every(r=>r.target===ref&&r.success&&r.nfId))
const report={target:ref,checks:[],success:false},clients=[]
const result=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js','projects','api-keys','--project-ref',ref,'--output','json'],{encoding:'utf8',windowsHide:true,timeout:60000})
assert.equal(result.status,0,'QA_KEYS_UNAVAILABLE')
const keys=JSON.parse(result.stdout),anon=keys.find(k=>k.name==='anon').api_key
const admin=createClient(`https://${ref}.supabase.co`,keys.find(k=>k.name==='service_role').api_key,{auth:{persistSession:false,autoRefreshToken:false}})
const val=r=>{if(r.error)throw new Error(r.error.message);return r.data}
function totp(secret){
 const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
 const bits=[...secret.replace(/=/g,'').toUpperCase()].map(c=>chars.indexOf(c).toString(2).padStart(5,'0')).join('')
 const bytes=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)))
 const ctr=Buffer.alloc(8);ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)))
 const digest=createHmac('sha1',bytes).update(ctr).digest(),offset=digest[19]&15
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0')
}
async function login(r,role){
 const user=val(await admin.auth.admin.getUserById(r.users[role])).user
 assert.equal(user.email,`guibor-${r.run}-${role}@example.invalid`,'QA_IDENTITY_GUARD')
 const factors=val(await admin.auth.admin.mfa.listFactors({userId:user.id})).factors
 for(const factor of factors){
  assert(/^(GUIBOR |R3 RLS )/.test(factor.friendly_name),'UNEXPECTED_QA_FACTOR_STOP')
  val(await admin.auth.admin.mfa.deleteFactor({userId:user.id,id:factor.id}))
 }
 // Generates an OTP without sending email. Tokens remain in memory only.
 const link=val(await admin.auth.admin.generateLink({type:'magiclink',email:user.email}))
 const client=createClient(`https://${ref}.supabase.co`,anon,{auth:{persistSession:false,autoRefreshToken:false}})
 val(await client.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'magiclink'}));clients.push(client)
 const factor=val(await client.auth.mfa.enroll({factorType:'totp',friendlyName:`R3 RLS ${Date.now()}`}))
 const challenge=val(await client.auth.mfa.challenge({factorId:factor.id}))
 val(await client.auth.mfa.verify({factorId:factor.id,challengeId:challenge.id,code:totp(factor.totp.secret)}))
 val(await client.rpc('registrar_sessao_mfa_atual',{p_factor_id:factor.id}))
 assert.equal(val(await client.auth.mfa.getAuthenticatorAssuranceLevel()).currentLevel,'aal2')
 return client
}
async function read(client,nf,expected,name){
 const rows=val(await client.from('notas_fiscais').select('id').eq('id',nf))
 assert.equal(rows.length,expected,name);report.checks.push(name)
}
async function write(client,r,allowed,name){
 const response=await client.from('notas_fiscais').update({data_vencimento:r.due}).eq('id',r.nfId).select('id')
 if(allowed){assert(!response.error,name);assert.equal(response.data.length,1,name)}
 else assert(response.error||response.data.length===0,name)
 report.checks.push(name)
}
try{
 const cedente=await login(a,'cedente'),consultor=await login(a,'consultor'),leitor=await login(a,'leitor'),gestor=await login(a,'gestor')
 await read(cedente,a.nfId,1,'CEDENTE_OWN_READ');await write(cedente,a,true,'CEDENTE_OWN_WRITE')
 await read(cedente,b.nfId,0,'CEDENTE_OTHER_READ_DENIED');await write(cedente,b,false,'CEDENTE_OTHER_WRITE_DENIED')
 for(const papel of ['OWNER','ADMIN','OPERADOR']){
  val(await admin.from('consultor_usuarios').update({papel}).eq('consultor_id',a.fixtures.org).eq('user_id',a.users.consultor))
  await read(consultor,a.nfId,1,`${papel}_OWN_READ`);await write(consultor,a,true,`${papel}_OWN_WRITE`)
  await read(consultor,b.nfId,0,`${papel}_CROSS_ORG_READ_DENIED`);await write(consultor,b,false,`${papel}_CROSS_ORG_WRITE_DENIED`)
 }
 await write(leitor,a,false,'LEITOR_WRITE_DENIED')
 await read(gestor,a.nfId,1,'GESTOR_OWN_FUND_READ');await read(gestor,b.nfId,0,'GESTOR_OTHER_FUND_READ_DENIED')
 val(await admin.from('consultor_fundos').update({status:'inativo'}).eq('consultor_id',a.fixtures.org).eq('fundo_id',a.fixtures.fund))
 await write(consultor,a,false,'CONSULTOR_REVOKED_FUND_WRITE_DENIED')
 val(await admin.from('consultor_fundos').update({status:'ativo'}).eq('consultor_id',a.fixtures.org).eq('fundo_id',a.fixtures.fund))
 for(const client of [cedente,consultor,leitor,gestor]){
  const receipt=await client.from('nfse_review_intents').select('id').limit(1)
  assert(receipt.error,'RECEIPTS_SERVER_ONLY')
 }
 report.checks.push('RECEIPTS_SERVER_ONLY','REAL_AUTH_MFA_ALL_ACTORS');report.success=true
}catch(error){report.error=error.message;process.exitCode=1}
finally{
 val(await admin.from('consultor_usuarios').update({papel:'OPERADOR'}).eq('consultor_id',a.fixtures.org).eq('user_id',a.users.consultor))
 val(await admin.from('consultor_fundos').update({status:'ativo'}).eq('consultor_id',a.fixtures.org).eq('fundo_id',a.fixtures.fund))
 for(const client of clients)await client.auth.signOut().catch(()=>{})
 writeFileSync(`rehearsal/reports/GUIBOR_${phase}_RLS.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
