// SQL-only guard tests in the pinned disposable Docker; always rollback.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import {captureWebhooks} from './concurrent-webhooks.mjs'
import {fingerprints} from './production-runtime.mjs'
test('concurrent webhook exception preserves existing and fiscal records',async t=>{
 const db=new pg.Client({host:'127.0.0.1',port:59422,user:'postgres',password:'postgres',database:'postgres'})
 await db.connect()
 try{
  await db.query("BEGIN; SET LOCAL session_replication_role='replica'")
  await db.query(readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql','utf8'))
  const emptyFund=randomUUID(),otherFund=randomUUID(),integration=randomUUID()
  for(const [i,id] of [emptyFund,otherFund].entries())await db.query("INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj) VALUES($1,'QA Guard',$2,'QA','98000000000277','QA','98000000000358')",[id,'9812345678900'+i])
  async function event({fund=emptyFund,linked=null,status='NAO_IDENTIFICADO',raw=true}={}){
   const id=randomUUID(),object=randomUUID(),path=raw?`webhooks-transportadora/${integration}/${id}/qa.pdf`:`fiscal/${id}/qa.pdf`
   await db.query("INSERT INTO public.integracao_logistica_webhook_eventos(id,integracao_id,fundo_id,provider,idempotency_key,payload_hash,status,nota_fiscal_venda_id,bucket,path) VALUES($1::uuid,$2,$3,'QA',$1::uuid::text,'QA',$4,$5,'documentos', $6)",[id,integration,fund,status,linked,path])
   await db.query("INSERT INTO storage.objects(id,bucket_id,name) VALUES($1,'documentos',$2)",[object,path])
   return {id,object}
  }
  const old=await event(),concurrency=await captureWebhooks(db),before=await fingerprints(db)
  assert.deepEqual(concurrency.fundIds,[emptyFund])
  async function scenario(name,mutate,allowed){await t.test(name,async()=>{await db.query('SAVEPOINT scenario');try{await mutate();const after=await fingerprints(db,{concurrency});if(allowed)assert.deepEqual(after,before);else assert.notDeepEqual(after,before)}finally{await db.query('ROLLBACK TO SAVEPOINT scenario')}})}
  await scenario('new unmatched event and exact raw evidence are allowed',()=>event(),true)
  await scenario('fund with NFs cannot be excepted',()=>event({fund:'22000000-0000-4000-8000-000000000001'}),false)
  await scenario('unapproved empty fund cannot be excepted',()=>event({fund:otherFund}),false)
  await scenario('linked NF cannot be excepted',()=>event({linked:'2a000000-0000-4000-8000-000000000001'}),false)
  await scenario('processed event cannot be excepted',()=>event({status:'PROCESSADO'}),false)
  await scenario('fiscal path cannot be excepted',()=>event({raw:false}),false)
  await scenario('existing event update is detected',()=>db.query("UPDATE public.integracao_logistica_webhook_eventos SET erro_codigo='QA_CHANGED' WHERE id=$1",[old.id]),false)
  await scenario('existing Storage update is detected',()=>db.query("UPDATE storage.objects SET metadata='{\"qa\":true}' WHERE id=$1",[old.object]),false)
  await scenario('existing Storage delete is detected',()=>db.query('DELETE FROM storage.objects WHERE id=$1',[old.object]),false)
  await scenario('unmatched new Storage is detected',()=>db.query("INSERT INTO storage.objects(id,bucket_id,name) VALUES($1,'documentos','fiscal/new-qa.pdf')",[randomUUID()]),false)
  await scenario('financial change is detected',()=>db.query('UPDATE public.notas_fiscais SET valor_bruto=valor_bruto+1'),false)
  await scenario('deletion of an existing event is detected',()=>db.query('DELETE FROM public.integracao_logistica_webhook_eventos WHERE id=$1',[old.id]),false)
 }finally{await db.query('ROLLBACK');await db.end()}
})
