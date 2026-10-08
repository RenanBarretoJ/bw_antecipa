import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Client } from 'pg'
import { verifyNfeCompanions } from '../../email-intake/companion-db.mjs'
import { storageTrace } from './r1-6-storage-trace.mjs'

// Real PostgreSQL functions/roles, not replacements or repository mocks.
export async function verifyMunicipalCompatibility(admin, connection, storage, onCheck = () => {}, onTrace = () => {}) {
  assert.equal(connection.host, '127.0.0.1'); assert([57842,57942].includes(connection.port),'LOCAL_REHEARSAL_PORT_REQUIRED')
  const checks = []
  const passed = name => { checks.push(name); onCheck(name); console.log(JSON.stringify({ sqlCheck: name, result: 'PASS' })) }
  const fixture = await readFile('supabase/tests/c2_1_r2_fluxo_taxa.test.sql', 'utf8')
  const setup = fixture.match(/DO \$setup\$[\s\S]*?\$setup\$;/)?.[0]
  assert(setup); const boundary = setup.indexOf('  INSERT INTO public.notas_fiscais ('); assert(boundary > 0)
  await admin.query(setup.slice(0, boundary) + 'END;\n$setup$;')
  const userId = '21000000-0000-4000-8000-000000000003', fundId = '22000000-0000-4000-8000-000000000001'
  const cedenteId = '23000000-0000-4000-8000-000000000001', linkId = '24000000-0000-4000-8000-000000000001'
  const establishment = (await admin.query("select id from public.cedente_estabelecimentos where cedente_id=$1 and tipo='matriz'", [cedenteId])).rows[0].id
  const sessionId = randomUUID(), factorId = randomUUID()
  await admin.query("insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values($1,$2,'R1.1 synthetic','totp','verified',now(),now())", [factorId,userId])
  await admin.query("insert into auth.sessions(id,user_id,aal,factor_id,created_at,updated_at) values($1,$2,'aal2',$3,now(),now())", [sessionId,userId,factorId])
  await admin.query("insert into public.sessoes_elevadas(user_id,session_id,metodo,factor_id,elevada_em,expira_em) values($1,$2,'totp',$3,now(),now()+interval '1 hour')", [userId,sessionId,factorId])
  const integrationId = randomUUID()
  await admin.query(`insert into private.email_integrations(id,fundo_id,name,provider,mailbox_address,routing_mode,enabled,start_at,scope_verified_at,scope_evidence_hash,credential_env_ref,created_by)
    values($1,$2,'R1.1 synthetic','OUTLOOK_GRAPH','qa@example.invalid','ALL_ACTIVE_CEDENTES',true,now()-interval '1 day',now(),repeat('a',64),'EMAIL_INTAKE_QA_SYNTHETIC',$3)`, [integrationId,fundId,userId])
  const human = { type: 'HUMAN', userId }
  async function system() {
    const messageId=randomUUID(),attachmentId=randomUUID(),attachmentToken=randomUUID()
    await admin.query('insert into private.email_intake_messages(id,integration_id,external_id,received_at) values($1,$2,$3,now())', [messageId,integrationId,randomUUID()])
    await admin.query(`insert into private.email_intake_attachments(id,message_id,external_id,file_name,content_type,size_bytes,kind,status,lease_token,lease_expires_at)
      values($1,$2,$3,'synthetic.pdf','application/pdf',100,'FILE','PROCESSING',$4,now()+interval '1 hour')`, [attachmentId,messageId,randomUUID(),attachmentToken])
    return {type:'SYSTEM',source:'EMAIL_INTAKE',integrationId,messageId,attachmentId,attachmentToken}
  }
  const clients = [new Client(connection), new Client(connection), new Client(connection)]
  const claims = {sub:userId,role:'authenticated',aal:'aal2',session_id:sessionId}
  for (let i=0;i<clients.length;i++) {
    await clients[i].connect()
    await clients[i].query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(i===0?claims:{role:'service_role'})])
    await clients[i].query(i===0?'set role authenticated':'set role service_role')
  }
  const rpc = async (index,name,args) => (await clients[index].query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`, args)).rows[0].result
  const fence = r => [r.id,r.token,r.generation]
  const reserve = (actor,type,key,sha=storage.sha256) => rpc(actor.type==='HUMAN'?0:1,'fiscal_intake_reserve',[actor,fundId,linkId,establishment,type,key,sha])
  const authority='PREFEITURA MUNICIPAL DE CIDADE QA', cnpj='98100000000168'
  const municipal = number => JSON.stringify(['NFSE_MUNICIPAL',cnpj,authority,String(number)])
  const dates=(await admin.query('select current_date::text issued,(current_date+30)::text due')).rows[0]
  let sequence=980000
  function nfeKey() {
    const material='35'+dates.issued.slice(2,7).replace('-','')+cnpj+'55'+'001'+String(++sequence).padStart(9,'0')+'1'+String(sequence).padStart(8,'0')
    assert.equal(material.length,43); let sum=0,weight=2
    for(let i=42;i>=0;i--){sum+=Number(material[i])*weight;weight=weight===9?2:weight+1}
    return material+(sum%11<2?0:11-sum%11)
  }
  const facts = (kind,key,number) => ({tipo_documento_fiscal:kind==='NFE'?'NFE':'NFSE',numero_nf:kind==='NFE'?String(Number(key.slice(25,34))):String(number),serie:'1',chave_acesso:kind==='MUNICIPAL'?null:key,
    cnpj_emitente:cnpj,razao_social_emitente:'SYNTHETIC ISSUER QA',cnpj_destinatario:'11222333000181',razao_social_destinatario:'SYNTHETIC DEBTOR QA',
    valor_bruto:100,valor_liquido:90,valor_icms:0,valor_iss:0,valor_pis:0,valor_cofins:0,valor_ipi:0,data_emissao:dates.issued,data_vencimento:dates.due,
    ...(kind==='NFE'?{fiscal_proveniencia:{strategy:'xml',sha256:storage.sha256}}:{valor_liquido_origem:'DOCUMENTO_EXPLICITO',vencimento_origem:'DOCUMENT',fiscal_proveniencia:{strategy:kind==='MUNICIPAL'?'nfse_municipal_visual':'danfse_v2_labels',
      source:kind==='MUNICIPAL'?'PDF_VISUAL_FALLBACK':'PDF_TEXT_NATIVE',sha256:storage.sha256,competencia:null,vencimento_documento:dates.due,
      ...(kind==='MUNICIPAL'?{orgao_emissor:authority,codigo_verificacao:'QA-1234'}:{})}})})
  const stage = (claim,values) => {
    const xml=values.fiscal_proveniencia?.strategy==='xml'
    const parcelas=values.tipo_documento_fiscal==='NFSE'?[]:[{numero_parcela:1,valor_nominal:100,data_vencimento:values.data_vencimento}]
    return rpc(1,'fiscal_intake_stage',[...fence(claim),values,JSON.stringify(parcelas),xml?'synthetic.xml':'synthetic.pdf',xml?'application/xml':'application/pdf',100,xml?'nf_xml':'nf_danfe_pdf'])
  }
  const put = intent => storage.put(intent)
  async function cleanup(claim,intent) {
    const step=storageTrace(claim.id,intent,onTrace)
    await step('COMPENSATION_REQUEST',{},()=>rpc(1,'fiscal_intake_abort',fence(claim)))
    const owner=await rpc(1,'fiscal_intake_claim_cleanup',[claim.id])
    await step('COMPENSATION_DB_STATE_OBJECT_REMAINS',{reject:/FISCAL_CLEANUP_OBJECT_REMAINS/,code:'P0001'},()=>rpc(1,'fiscal_intake_settle_cleanup',[owner.id,owner.token,true]))
    await step('COMPENSATION_PHYSICAL_DELETE',{},()=>storage.remove(intent))
    await rpc(1,'fiscal_intake_settle_cleanup',[owner.id,owner.token,true])
    await step('COMPENSATION_DB_STATE',{},async()=>{
      assert.equal((await admin.query('select state from private.fiscal_identity_reservations where id=$1',[claim.id])).rows[0].state,'RELEASED')
      assert.equal((await admin.query('select count(*)::int n from storage.objects where bucket_id=$1 and name=$2',[intent.bucket,intent.path])).rows[0].n,0)
    })
    await step('COMPENSATION_PHYSICAL_STATE',{},async()=>assert.equal(await storage.physicalCount(claim.id),0,'ORPHAN_PHYSICAL_STORAGE'))
    await step('LATE_REUPLOAD_ATTEMPT',{reject:/FISCAL_STORAGE_FENCE_LOST/},()=>put(intent))
    await step('LATE_DB_INSERT_ATTEMPT',{reject:/FISCAL_STORAGE_FENCE_LOST/,code:'42501'},()=>admin.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[intent.bucket,intent.path,{size:100,mimetype:'application/pdf'}]))
    await step('FINAL_ASSERTIONS',{},async()=>{
      assert.equal(await storage.physicalCount(claim.id),0,'ORPHAN_PHYSICAL_STORAGE')
      assert.equal((await admin.query('select count(*)::int n from storage.objects where bucket_id=$1 and name=$2',[intent.bucket,intent.path])).rows[0].n,0)
    })
  }
  async function persist(actor,claim,values) {
    await stage(claim,values)
    const index=actor.type==='HUMAN'?0:1
    const intent=await rpc(index,'fiscal_intake_prepare_storage',fence(claim)); await put(intent)
    const result=await rpc(index,'fiscal_intake_commit',[...fence(claim),intent.id])
    assert(result.nfId)
    await storage.verify(intent)
    assert.equal((await admin.query('select count(*)::int n from public.nota_fiscal_parcelas where nota_fiscal_id=$1',[result.nfId])).rows[0].n,values.tipo_documento_fiscal==='NFSE'?0:1)
    return {...result,intent}
  }
  try {
    // Missing mandatory type must still block. This synthetic deletion is rolled back.
    const guardKey=nfeKey(), guardClaim=await reserve(human,'NFE',guardKey)
    await stage(guardClaim,facts('NFE',guardKey,++sequence))
    await clients[0].query('BEGIN')
    await admin.query('BEGIN')
    try {
      // Same transaction/connection as the guarded RPC, so no uncommitted-data illusion.
      await admin.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)])
      await admin.query("delete from public.documento_tipos where codigo='nf_xml'")
      await admin.query('SAVEPOINT missing_type')
      await assert.rejects(admin.query('select public.fiscal_intake_prepare_storage($1,$2,$3)',fence(guardClaim)),/FISCAL_DOCUMENT_INVALID/)
      await admin.query('ROLLBACK TO SAVEPOINT missing_type')
    } finally {await admin.query('ROLLBACK');await clients[0].query('ROLLBACK')}
    await rpc(1,'fiscal_intake_abort',fence(guardClaim))
    passed('NEGATIVE_DOCUMENT_GUARD_PRESERVED')
    // Invalid identity never creates a reservation and cannot bypass normalization.
    for(const [type,key] of [['NFE',null],['NFE','1'.repeat(43)],['NFE','1'.repeat(45)],['NFSE','1'.repeat(50)],['NFSE','2'.repeat(49)],
      ['NFSE',JSON.stringify(['NFSE_MUNICIPAL',cnpj,authority,'0001'])],['NFSE',JSON.stringify(['NFSE_MUNICIPAL',cnpj,'Prefeitura QA','1'])],
      ['NFSE',JSON.stringify(['NFSE_MUNICIPAL',cnpj,authority,'1','extra'])],['NFSE',JSON.stringify(['NFSE_MUNICIPAL','00000000000000',authority,'1'])],['NFSE',municipal(1).replaceAll(',',', ')]]) {
      await assert.rejects(reserve(human,type,key), /FISCAL_IDENTITY_INVALID/)
    }
    passed('STRICT_IDENTITY_MATRIX')
    for(const kind of ['NFE','NATIONAL','MUNICIPAL']) for(const actorType of ['HUMAN','SYSTEM']) {
      const number=++sequence, actor=actorType==='HUMAN'?human:await system()
      const key=kind==='NFE'?nfeKey():kind==='MUNICIPAL'?municipal(number):('1234567890'.repeat(4)+String(number).padStart(10,'0'))
      const type=kind==='NFE'?'NFE':'NFSE', values=facts(kind,key,number)
      const claim=await reserve(actor,type,key); assert.equal(claim.status,'RESERVED')
      const stored=(await admin.query('select identity_sha256 from private.fiscal_identity_reservations where id=$1',[claim.id])).rows[0]
      assert.equal(stored.identity_sha256,createHash('sha256').update(key).digest('hex'))
      const swaps=kind==='MUNICIPAL'?[{...values,numero_nf:String(number+1000)}, {...values,cnpj_emitente:'11222333000181'},
        {...values,fiscal_proveniencia:{...values.fiscal_proveniencia,orgao_emissor:'PREFEITURA OUTRA CIDADE QA'}},
        {...values,fiscal_proveniencia:{...values.fiscal_proveniencia,strategy:'UNKNOWN'}}, {...values,chave_acesso:'1234567890'.repeat(5)}]
        :[{...values,chave_acesso:kind==='NFE'?nfeKey():'2345678901'.repeat(5)}]
      for(const bad of swaps) await assert.rejects(stage(claim,bad), /FISCAL_FACTS_INVALID|FISCAL_IDENTITY_INVALID/)
      const imported=await persist(actor,claim,values)
      const nf=(await admin.query('select * from public.notas_fiscais where id=$1',[imported.nfId])).rows[0]
      assert.equal(nf.chave_acesso,values.chave_acesso)
      assert.equal(Number(nf.valor_liquido),90)
      assert.equal(nf.source_channel,actorType==='HUMAN'?'MANUAL_UPLOAD':'EMAIL_INTAKE')
      const audit=(await admin.query("select usuario_id,ator_tipo,dados_depois from public.logs_auditoria where entidade_id=$1 and origem='fiscal_intake'",[imported.nfId])).rows
      assert.equal(audit.length,1)
      assert.equal(audit[0].usuario_id,actorType==='HUMAN'?userId:null)
      assert.equal(audit[0].ator_tipo,actorType==='HUMAN'?'usuario':'sistema')
      assert.equal(audit[0].dados_depois.ingest_actor.type,actorType)
      assert.equal((await reserve(actorType==='HUMAN'?await system():human,type,key,'b'.repeat(64))).status,'DUPLICATE')
      assert.equal((await admin.query('select count(*)::int n from public.notas_fiscais where fiscal_reservation_id=$1',[claim.id])).rows[0].n,1)
      await storage.verify(imported.intent)
      if(kind==='MUNICIPAL')assert.equal(nf.tipo_documento_fiscal,'NFSE')
      // The actual private assertion is exercised positively and with an exchanged identity,
      // all in a rolled-back synthetic transaction. Frozen facts are never disabled.
      await admin.query('BEGIN')
      try {
        await admin.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(actorType==='HUMAN'?claims:{role:'service_role'})])
        // A completed SYSTEM receipt no longer owns its attachment; restore only test state.
        if(actorType==='SYSTEM') await admin.query("update private.email_intake_attachments set status='PROCESSING',lease_token=$2,lease_expires_at=now()+interval '1 hour' where id=$1",[actor.attachmentId,actor.attachmentToken])
        await admin.query("update private.fiscal_identity_reservations set state='RESERVED' where id=$1",[claim.id])
        await admin.query('select private.fiscal_assert_nf($1,$2,$3,$4)',[imported.nfId,...fence(claim)])
        await admin.query('SAVEPOINT wrong_identity')
        await admin.query("update private.fiscal_identity_reservations set identity_sha256=repeat('e',64) where id=$1",[claim.id])
        await assert.rejects(admin.query('select private.fiscal_assert_nf($1,$2,$3,$4)',[imported.nfId,...fence(claim)]), /FISCAL_SCOPE_DENIED/)
      } finally { await admin.query('ROLLBACK') }
      if(kind!=='NFE') await assert.rejects(clients[0].query('update public.notas_fiscais set valor_liquido=1 where id=$1',[imported.nfId]), /NFSE_FISCAL_FACTS_IMMUTABLE/)
      passed(`${kind}_${actorType}_RESERVE_STAGE_COMMIT_ASSERT_DEDUPE`)
    }
    // Concurrency, both directions, observed at the real PostgreSQL advisory lock.
    for(const winner of [0,1]) {
      const actors=[human,await system()],key=municipal(++sequence),loser=1-winner
      await clients[winner].query('BEGIN')
      const first=await reserve(actors[winner],'NFSE',key); assert.equal(first.status,'RESERVED')
      let settled=false; const competing=reserve(actors[loser],'NFSE',key).finally(()=>{settled=true})
      let blocked=false
      for(let i=0;i<40;i++) { if((await admin.query("select 1 from pg_stat_activity where wait_event_type='Lock' and query like 'select public.fiscal_intake_reserve%'")).rowCount){blocked=true;break} await new Promise(r=>setTimeout(r,25)) }
      assert(blocked);assert.equal(settled,false);await clients[winner].query('COMMIT')
      assert.equal((await competing).status,'IN_PROGRESS')
      passed(winner===0?'MUNICIPAL_HUMAN_SYSTEM_CONCURRENCY':'MUNICIPAL_SYSTEM_HUMAN_CONCURRENCY')
    }
    const key=municipal(++sequence),old=await reserve(await system(),'NFSE',key)
    await admin.query("update private.fiscal_identity_reservations set lease_expires_at=now()-interval '1 second' where id=$1",[old.id])
    const fresh=await reserve(human,'NFSE',key);assert.equal(fresh.generation,old.generation+1);assert.notEqual(fresh.token,old.token)
    await assert.rejects(stage(old,facts('MUNICIPAL',key,sequence)), /FISCAL_LEASE_LOST/)
    await assert.rejects(rpc(1,'fiscal_intake_prepare_storage',fence(old)), /FISCAL_LEASE_LOST/)
    await persist(human,fresh,facts('MUNICIPAL',key,sequence))
    passed('MUNICIPAL_EXPIRED_OWNER_FENCED')
    const reviewActor=await system(),reviewKey=municipal(++sequence),reviewClaim=await reserve(reviewActor,'NFSE',reviewKey)
    const review=await rpc(1,'fiscal_intake_open_review',[...fence(reviewClaim),'b'.repeat(64)])
    assert.equal((await admin.query('select count(*)::int n from private.fiscal_storage_intents where reservation_id=$1',[reviewClaim.id])).rows[0].n,0)
    assert.equal((await reserve(human,'NFSE',reviewKey)).status,'IN_PROGRESS')
    await assert.rejects(rpc(0,'fiscal_intake_resume_review',[review,fundId,linkId,'c'.repeat(64),'b'.repeat(64),reviewKey]),/NFSE_REVIEW_DRIFT/)
    const resumed=await rpc(0,'fiscal_intake_resume_review',[review,fundId,linkId,storage.sha256,'b'.repeat(64),reviewKey])
    const reviewValues=facts('MUNICIPAL',reviewKey,sequence);reviewValues.vencimento_origem='MANUAL';reviewValues.fiscal_proveniencia.vencimento_documento=null
    await assert.rejects(stage(reviewClaim,reviewValues),/FISCAL_LEASE_LOST/)
    const reviewed=await persist(human,resumed,reviewValues)
    assert.equal((await admin.query('select state from public.nfse_review_intents where id=$1',[review])).rows[0].state,'COMPLETED')
    assert.equal((await admin.query('select source_channel from public.notas_fiscais where id=$1',[reviewed.nfId])).rows[0].source_channel,'EMAIL_INTAKE')
    assert.equal((await reserve(await system(),'NFSE',reviewKey)).status,'DUPLICATE')
    const reviewAudit=(await admin.query("select dados_depois from public.logs_auditoria where entidade_id=$1 and origem='fiscal_intake'",[reviewed.nfId])).rows[0].dados_depois
    assert.equal(reviewAudit.ingest_actor.type,'SYSTEM');assert.equal(reviewAudit.review_actor.type,'HUMAN');assert.equal(reviewAudit.review_actor.userId,userId)
    passed('MUNICIPAL_SYSTEM_REVIEW_HUMAN_RESUME_COMMIT')
    // A failed atomic commit leaves no partial NF/parcel and forces Storage compensation.
    const failedKey=municipal(++sequence),failedClaim=await reserve(human,'NFSE',failedKey)
    const invalid=facts('MUNICIPAL',failedKey,sequence);invalid.valor_liquido=101
    await stage(failedClaim,invalid)
    const prepareTrace=storageTrace(failedClaim.id,{path:'synthetic-intent-not-created-yet'},onTrace)
    const intent=await prepareTrace('STORAGE_PREPARE',{},()=>rpc(0,'fiscal_intake_prepare_storage',fence(failedClaim)))
    const step=storageTrace(failedClaim.id,intent,onTrace)
    await step('STORAGE_UPLOAD',{},()=>put(intent))
    await step('STORAGE_AUTHORIZED_UPDATE',{},async()=>assert.equal((await admin.query('update storage.objects set metadata=metadata where bucket_id=$1 and name=$2',[intent.bucket,intent.path])).rowCount,1))
    await step('FISCAL_COMMIT',{reject:/nfse_fatos_check/,code:'23514'},()=>rpc(0,'fiscal_intake_commit',[...fence(failedClaim),intent.id]))
    assert.equal((await admin.query('select count(*)::int n from public.notas_fiscais where fiscal_reservation_id=$1',[failedClaim.id])).rows[0].n,0)
    await cleanup(failedClaim,intent)
    passed('MUNICIPAL_FAILED_COMMIT_PHYSICAL_STORAGE_COMPENSATION_AND_LATE_INSERT_FENCE')
    for(const role of ['anon','authenticated','service_role']) {
      const privileges=(await admin.query("select has_function_privilege($1,'private.fiscal_identity_material(text,text)','EXECUTE') a,has_function_privilege($1,'private.fiscal_identity_from_values(jsonb)','EXECUTE') b",[role])).rows[0]
      assert.deepEqual(privileges,{a:false,b:false})
    }
    passed('IDENTITY_HELPERS_NOT_EXPOSED')
    for(const test of ['nfse_submit_frozen.assert.sql','nfse_calculated_net.assert.sql']) {
      await admin.query('BEGIN')
      try {await admin.query(await readFile('supabase/tests/'+test,'utf8'))} finally {await admin.query('ROLLBACK')}
      passed(test)
    }
    const otherIntegration=randomUUID()
    await admin.query(`insert into private.email_integrations(id,fundo_id,name,provider,mailbox_address,routing_mode,enabled,start_at,scope_verified_at,scope_evidence_hash,credential_env_ref,created_by)
      select $1,fundo_id,'Other synthetic QA',provider,'other@example.invalid',routing_mode,enabled,start_at,scope_verified_at,scope_evidence_hash,credential_env_ref,created_by from private.email_integrations where id=$2`,[otherIntegration,integrationId])
    const companionActor=await system()
    for(const check of await verifyNfeCompanions({admin,clients,connection,fundId,linkId,establishment,
      actors:[human,companionActor,{...companionActor,integrationId:otherIntegration}],storageFixtures:storage}))passed(check)
    return checks
  } finally {
    for(const client of clients){await client.query('ROLLBACK').catch(()=>{});await client.end()}
  }
}
