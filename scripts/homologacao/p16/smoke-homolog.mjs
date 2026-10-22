import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { database, loadHomologEnv, projectRef } from './homolog-env.mjs'

const { env, connectionString } = loadHomologEnv()
const db = database(connectionString)
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options)
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
const run = randomUUID()
const ids = Object.fromEntries(['fund','cedente','link','policy','version','nf'].map(key=>[key,randomUUID()]))
const name = `QA P16 ${run}`
const checks = []
let userId, seeded = false
const ops = []
function pass(check) { checks.push(check); console.log(`PASS ${check}`) }
function ok(result) { if (result.error) throw new Error(result.error.message); return result.data }
function cnpj() {
  const digits = [...Array(8)].map(()=>Math.floor(Math.random()*10)).concat([0,0,0,1])
  for (const weights of [[5,4,3,2,9,8,7,6,5,4,3,2],[6,5,4,3,2,9,8,7,6,5,4,3,2]]) {
    const mod = digits.reduce((sum,digit,index)=>sum+digit*weights[index],0)%11
    digits.push(mod<2?0:11-mod)
  }
  return digits.join('')
}
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...secret.replace(/=/g,'')].map(char=>alphabet.indexOf(char).toString(2).padStart(5,'0')).join('')
  const key = Buffer.from(bits.match(/.{8}/g).map(byte=>parseInt(byte,2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)))
  const hash = createHmac('sha1',key).update(counter).digest()
  return String((hash.readUInt32BE(hash[19]&15)&0x7fffffff)%1000000).padStart(6,'0')
}
function request() {
  return {
    p_cedente_id:ids.cedente,p_cedente_fundo_id:ids.link,p_politica_operacional_id:ids.policy,
    p_politica_operacional_versao_id:ids.version,p_politica_versao:1,
    p_politica_snapshot:{calculo_financeiro:{metodo:'DIAS_UTEIS_252'}},p_politica_snapshot_hash:`p16-${run}`,
    p_aceite_sacado_exigido:false,p_aceite_sacado_status:'dispensado',p_nota_fiscal_ids:[ids.nf],
    p_valor_bruto_total:100,p_taxa_desconto:1,p_prazo_dias:30,p_valor_liquido_desembolso:99,
    p_data_vencimento:'2027-01-01',p_idempotency_key:randomUUID(),p_parcela_ids:null,
  }
}
async function submit() {
  const result = ok(await client.rpc('solicitar_operacao_antecipacao_atomica',request()))
  ops.push(result.operacao_id)
  return result.operacao_id
}
async function cancel(op) {
  // Mesmas mutacoes de banco da action, pela API com JWT real do Cedente.
  assert.equal(ok(await client.from('operacoes').update({status:'cancelada'}).eq('id',op).select('id')).length,1)
  assert.equal(ok(await client.from('notas_fiscais').update({status:'aprovada',aprovacao_sacado_em:null}).eq('id',ids.nf).select('id')).length,1)
  ok(await client.rpc('liberar_parcelas_operacao_rejeitada',{p_operacao_id:op}))
}
async function seed() {
  const taxId = cnpj()
  await db.query('begin')
  try {
    await db.query("update public.profiles set role='cedente',status='ativo' where id=$1",[userId])
    await db.query(`insert into public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
      values ($1,$2,$3,'QA P16',$3,'QA P16',$3,true)`,[ids.fund,name,cnpj()])
    await db.query("insert into public.cedentes(id,user_id,cnpj,razao_social,status,fundo_id) values ($1,$2,$3,$4,'ativo',$5)",[ids.cedente,userId,taxId,name,ids.fund])
    await db.query("insert into public.cedente_fundos(id,cedente_id,fundo_id,status) values ($1,$2,$3,'ativo')",[ids.link,ids.cedente,ids.fund])
    await db.query("insert into public.politicas_operacionais(id,fundo_id,codigo,nome,status,created_by) values ($1,$2,$3,$3,'ativa',$4)",[ids.policy,ids.fund,name,userId])
    await db.query(`insert into public.politica_operacional_versoes(id,politica_operacional_id,fundo_id,versao,vigente_desde,conteudo_hash,metodo_calculo_financeiro,publicada_por,publicada_em,status)
      values ($1,$2,$3,1,now()-interval '1 day',repeat('a',64),'DIAS_UTEIS_252',$4,now(),'publicada')`,[ids.version,ids.policy,ids.fund,userId])
    await db.query("insert into public.cedente_fundo_politicas(cedente_fundo_id,politica_operacional_id,vigente_desde) values ($1,$2,now()-interval '1 day')",[ids.link,ids.policy])
    await db.query("insert into public.contas_escrow(cedente_id,identificador,status) values ($1,$2,'ativa')",[ids.cedente,name])
    await db.query(`insert into public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,estabelecimento_id,numero_nf,serie,data_emissao,data_vencimento,
      cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,status)
      values ($1,$2,$3,$4,(select id from public.cedente_estabelecimentos where cedente_id=$2 and cnpj=$5),$6,'1',current_date,'2027-01-01',$5,$6,$7,'QA P16 SACADO',100,100,'aprovada')`,
    [ids.nf,ids.cedente,ids.link,ids.fund,taxId,name,cnpj()])
    await db.query('commit')
    seeded = true
  } catch (error) { await db.query('rollback'); throw error }
}
async function cleanup() {
  ok(await client.auth.signOut({scope:'global'}))
  if (seeded) {
    await db.query('begin')
    try {
      assert.equal((await db.query('select nome from public.fundos where id=$1',[ids.fund])).rows[0]?.nome,name)
      const operationIds = (await db.query('select id from public.operacoes where cedente_fundo_id=$1',[ids.link])).rows.map(row=>row.id)
      // Mesmo procedimento homolog-only de central-logistica/cleanup.mjs:
      // suspensao transacional de triggers apenas para apagar a massa QA exata.
      await db.query("set local session_replication_role='replica'")
      await db.query('delete from public.logs_auditoria where usuario_id=$1 and (entidade_id=any($2::uuid[]) or entidade_id=$3)',[userId,operationIds,ids.nf])
      await db.query('delete from public.operacoes_nf_parcelas where operacao_id=any($1::uuid[])',[operationIds])
      await db.query('delete from public.operacoes_nfs where operacao_id=any($1::uuid[]) and nota_fiscal_id=$2',[operationIds,ids.nf])
      await db.query('delete from public.operacoes where id=any($1::uuid[]) and cedente_fundo_id=$2',[operationIds,ids.link])
      // Descoberta de tabelas com fundo_id segue o helper QA existente; o ID e
      // exclusivo desta execucao, conferido acima, e os identificadores sao quoted.
      const tables = (await db.query("select table_name from information_schema.columns where table_schema='public' and column_name='fundo_id' and table_name in (select tablename from pg_tables where schemaname='public')")).rows
      for (const {table_name:table} of tables) await db.query(`delete from public."${table.replaceAll('"','""')}" where fundo_id=$1`,[ids.fund])
      await db.query('delete from public.cedente_fundo_politicas where cedente_fundo_id=$1',[ids.link])
      await db.query('delete from public.contas_escrow where cedente_id=$1',[ids.cedente])
      await db.query('delete from public.cedente_estabelecimentos where cedente_id=$1',[ids.cedente])
      await db.query('delete from public.cedentes where id=$1',[ids.cedente])
      await db.query('delete from public.fundos where id=$1',[ids.fund])
      await db.query('commit')
      const remaining = (await db.query(`select
        (select count(*) from public.operacoes where cedente_fundo_id=$1) +
        (select count(*) from public.notas_fiscais where id=$2) +
        (select count(*) from public.fundos where id=$3) +
        (select count(*) from public.operacoes_nfs where nota_fiscal_id=$2) as n`,[ids.link,ids.nf,ids.fund])).rows[0].n
      assert.equal(Number(remaining),0)
    } catch (error) { await db.query('rollback'); throw error }
  }
  if (userId) ok(await admin.auth.admin.deleteUser(userId))
  pass('qa_cleanup')
}
await db.connect()
try {
  assert.equal((await db.query("select private.operacao_status_reserva_nf('cancelada') as reserves")).rows[0].reserves,false)
  const password = randomBytes(32).toString('base64url')
  const email = `p16-${run}@example.invalid`
  userId = ok(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{nome_completo:name}})).user.id
  writeFileSync('rehearsal/tmp/p16-http-fixture.json',JSON.stringify({projectRef,run,name,userId,ids},null,2))
  await seed()
  ok(await client.auth.signInWithPassword({email,password}))
  const factor = ok(await client.auth.mfa.enroll({factorType:'totp',friendlyName:'P16 QA'}))
  ok(await client.auth.mfa.challengeAndVerify({factorId:factor.id,code:totp(factor.totp.secret)}))
  assert.equal(ok(await client.auth.mfa.getAuthenticatorAssuranceLevel()).currentLevel,'aal2')
  assert.equal(ok(await client.auth.getUser()).user.id,userId)
  pass('real_auth_aal2')
  const first = await submit()
  await cancel(first)
  const second = await submit()
  assert.notEqual(first,second)
  assert.equal(ok(await client.from('operacoes').select('status').eq('id',first).single()).status,'cancelada')
  assert.equal(ok(await client.from('operacoes_nfs').select('operacao_id').eq('nota_fiscal_id',ids.nf)).length,2)
  pass('cancel_reuse_history_http')
  const denied = await client.rpc('solicitar_operacao_antecipacao_atomica',request())
  assert.ok(denied.error)
  assert.match(denied.error.message,/nao estao aprovadas|NF_ALREADY_LINKED_TO_ACTIVE_OPERATION/)
  pass('active_denied_http')
  await cancel(second)
  // Montagem administrativa de historico REPROVADA sintetico, sem simular
  // validacao do fluxo de decisao do Gestor.
  await db.query("update public.operacoes set status='reprovada' where id=$1 and cedente_fundo_id=$2",[first,ids.link])
  const third = await submit()
  pass('reprovada_cancelada_multi_history_http')
  await cancel(third)
  const competing = await Promise.all([client.rpc('solicitar_operacao_antecipacao_atomica',request()),client.rpc('solicitar_operacao_antecipacao_atomica',request())])
  assert.equal(competing.filter(result=>!result.error).length,1)
  assert.equal(competing.filter(result=>result.error).length,1)
  const winner = competing.find(result=>!result.error).data.operacao_id
  ops.push(winner)
  const final = (await db.query(`select
    (select count(*) from public.operacoes_nfs l join public.operacoes o on o.id=l.operacao_id where l.nota_fiscal_id=$1 and private.operacao_status_reserva_nf(o.status)) as active,
    (select count(*) from public.logs_auditoria where entidade_id=$2 and tipo_evento='OPERACAO_SOLICITADA') as audit,
    (select count(*) from public.operacoes_nfs where nota_fiscal_id=$1) as history,
    (select status from public.notas_fiscais where id=$1) as nf_status`,[ids.nf,winner])).rows[0]
  assert.equal(Number(final.active),1)
  assert.equal(Number(final.audit),1)
  assert.equal(Number(final.history),4)
  assert.equal(final.nf_status,'em_antecipacao')
  pass('concurrency_one_winner_one_denied_http')
  pass('exclusive_reservation_and_creation_audit')
} finally {
  try { await cleanup() } finally { await db.end() }
}
writeFileSync('docs/analises/p16-homolog-http-smoke.json',JSON.stringify({projectRef,run,executedAt:new Date().toISOString(),checks,result:'PASS',scope:'Supabase HTTP Auth AAL2 and PostgREST; no browser or Next.js Server Action execution'},null,2)+'\n')
