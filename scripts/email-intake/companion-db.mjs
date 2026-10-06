import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'

/** Runs only in the clean-room's real disposable Postgres/Storage, never a remote database. */
export async function verifyNfeCompanions({admin,clients,connection,fundId,linkId,establishment,actors,storageFixtures}) {
  assert.equal(connection.host,'127.0.0.1');assert.equal(connection.port,57842)
  const checks=[],integration=actors[1].integrationId
  let sequence=970000
  const dates=(await admin.query('select current_date::text issued,(current_date+30)::text due')).rows[0]
  const rpc=async(name,args,index=1)=>{
    try{return (await clients[index].query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args.map(value=>Array.isArray(value)?JSON.stringify(value):value))).rows[0].result}
    catch(error){throw new Error(`COMPANION_${name}:${error.message}`)}
  }
  function key(){const first='35'+dates.issued.slice(2,7).replace('-','')+'98100000000168'+'55'+'001'+String(++sequence).padStart(9,'0')+'1'+String(sequence).padStart(8,'0');assert.equal(first.length,43);let sum=0,w=2;for(let i=42;i>=0;i--){sum+=Number(first[i])*w;w=w===9?2:w+1}return first+(sum%11<2?0:11-sum%11)}
  const facts=k=>({tipo_documento_fiscal:'NFE',numero_nf:String(Number(k.slice(25,34))),serie:'1',chave_acesso:k,
    cnpj_emitente:'98100000000168',razao_social_emitente:'Cedente QA',cnpj_destinatario:'11222333000181',razao_social_destinatario:'Sacado QA',
    valor_bruto:100,valor_liquido:100,data_emissao:dates.issued,data_vencimento:dates.due,valor_icms:0,valor_iss:0,valor_pis:0,valor_cofins:0,valor_ipi:0,
    fiscal_proveniencia:{strategy:'xml',sha256:'a'.repeat(64)}})
  async function message(){const id=randomUUID();await admin.query('insert into private.email_intake_messages(id,integration_id,external_id,received_at) values($1,$2,$3,clock_timestamp())',[id,integration,randomUUID()]);return id}
  async function attachment(code,msg=undefined){const messageId=msg??await message(),id=randomUUID(),token=randomUUID();await admin.query(`insert into private.email_intake_attachments(id,message_id,external_id,file_name,content_type,size_bytes,kind,status,lease_token,lease_expires_at)
    values($1,$2,$3,$4,$5,100,'FILE','PROCESSING',$6,clock_timestamp()+interval '1 hour')`,[id,messageId,randomUUID(),code==='nf_xml'?'unrelated-name.xml':'different-name.pdf',code==='nf_xml'?'application/xml':'application/pdf',token]);return {type:'SYSTEM',source:'EMAIL_INTAKE',integrationId:integration,messageId,attachmentId:id,attachmentToken:token}}
  const prep=(actor,k,code,sha='b'.repeat(64),extra={})=>rpc('fiscal_intake_prepare_companion',[actor,fundId,linkId,establishment,k,sha,code,{...facts(k),...extra},'synthetic.'+(code==='nf_xml'?'xml':'pdf'),100])
  const fence=c=>[c.id,c.token,c.generation]
  const put=async intent=>{if(storageFixtures)await storageFixtures.put(intent);else await admin.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[intent.bucket,intent.path,{size:100}])}
  async function importNf(actor,k,code='nf_xml',existingClaim=undefined){
    if(!existingClaim)assert.equal((await prep(actor,k,code,'a'.repeat(64))).status,'CREATE_NF')
    const claim=existingClaim??await rpc('fiscal_intake_reserve',[actor,fundId,linkId,establishment,'NFE',k,'a'.repeat(64)])
    assert.equal(claim.status,'RESERVED')
    const values=facts(k);values.fiscal_proveniencia.strategy=code==='nf_xml'?'xml':'pdf'
    await rpc('fiscal_intake_stage',[...fence(claim),values,[{numero_parcela:1,valor_nominal:100,data_vencimento:dates.due}],'synthetic.'+(code==='nf_xml'?'xml':'pdf'),code==='nf_xml'?'application/xml':'application/pdf',100,code])
    const intent=await rpc('fiscal_intake_prepare_storage',fence(claim));await put(intent)
    const imported=await rpc('fiscal_intake_commit',[...fence(claim),intent.id])
    return {...imported,claim,intent}
  }
  async function snapshot(id){return (await admin.query('select md5(to_jsonb(n)::text) as hash from public.notas_fiscais n where id=$1',[id])).rows[0].hash}
  async function counts(id){return (await admin.query(`select (select count(*)::int from public.notas_fiscais where id=$1) nf,
    count(distinct d.id)::int documents,count(distinct v.id)::int versions from public.documento_vinculos l join public.documentos_repositorio d on d.id=l.documento_id join public.documento_versoes v on v.documento_id=d.id where l.nota_fiscal_id=$1`,[id])).rows[0]}
  async function policy(codes){
    const po=randomUUID(),version=randomUUID()
    await admin.query("update public.cedente_fundo_politicas set status='encerrada',vigente_ate=clock_timestamp() where cedente_fundo_id=$1 and status='ativa'",[linkId])
    await admin.query(`insert into public.politicas_operacionais(id,codigo,nome,status,created_by,fundo_id,padrao) select $1,$2,'Companion policy QA','ativa',created_by,fundo_id,false from public.politicas_operacionais where id='26000000-0000-4000-8000-000000000001'`,[po,'COMPANION_'+po])
    await admin.query(`insert into public.politica_operacional_versoes select (jsonb_populate_record(null::public.politica_operacional_versoes,to_jsonb(v)||jsonb_build_object('id',$1::text,'politica_operacional_id',$2::text,'versao',1,'status','rascunho','publicada_em',null))).* from public.politica_operacional_versoes v where id='27000000-0000-4000-8000-000000000001'`,[version,po])
    for(const code of codes)await admin.query(`insert into public.politica_requisitos_documentais(politica_operacional_versao_id,politica_operacional_id,fundo_id,codigo,escopo,momento_obrigatorio,tipo_documento_codigo,formatos_aceitos,nivel_validacao,responsavel_upload,responsavel_aprovacao)
      values($1,$2,$3,$4,'nf_pre_cessao','nf_pre_cessao',$4,$5,$6,'cedente',$7)`,[version,po,fundId,code,[code==='nf_xml'?'xml':'pdf'],code==='nf_xml'?'estrutural':'manual',code==='nf_xml'?'sistema':'gestor'])
    await admin.query("update public.politica_operacional_versoes set status='publicada',publicada_em=clock_timestamp() where id=$1",[version])
    await admin.query(`insert into public.cedente_fundo_politicas(cedente_fundo_id,politica_operacional_id,status,vigente_desde,atribuido_por) select $1,$2,'ativa',clock_timestamp()-interval '1 second',created_by from public.politicas_operacionais where id=$2`,[linkId,po])
  }
  for(const codes of [[],['nf_xml'],['nf_danfe_pdf'],['nf_xml','nf_danfe_pdf']]){
    await policy(codes)
    const k=key(),msg=await message(),xml=await attachment('nf_xml',msg),pdf=await attachment('nf_danfe_pdf',msg)
    assert.equal((await prep(pdf,k,'nf_danfe_pdf')).status,'WAITING_CANONICAL_XML')
    await rpc('email_intake_settle_attachment',[pdf.attachmentId,pdf.attachmentToken,'WAITING_CANONICAL_XML',1000])
    const waited=(await admin.query('select status,attempts,last_error_code from private.email_intake_attachments where id=$1',[pdf.attachmentId])).rows[0]
    assert.equal(waited.status,'RETRY');assert.equal(waited.last_error_code,'WAITING_CANONICAL_XML');assert.equal(waited.attempts,0)
    const imported=await importNf(xml,k),before=await snapshot(imported.nfId)
    const requirements=(await admin.query('select tipo_documento_codigo_snapshot,documento_id,status from public.documento_requisito_instancias where nota_fiscal_id=$1',[imported.nfId])).rows
    assert.equal(requirements.length,codes.length)
    if(codes.includes('nf_danfe_pdf'))assert.equal(requirements.find(r=>r.tipo_documento_codigo_snapshot==='nf_danfe_pdf').documento_id,null)
    pdf.attachmentToken=randomUUID();await admin.query("update private.email_intake_attachments set status='PROCESSING',lease_token=$2,lease_expires_at=clock_timestamp()+interval '1 hour' where id=$1",[pdf.attachmentId,pdf.attachmentToken])
    const document=await prep(pdf,k,'nf_danfe_pdf');assert.equal(document.status,'DOCUMENT')
    await put(document.intent)
    const linked=await rpc('fiscal_intake_commit_companion',fence(document.claim));assert.equal(linked.nfId,imported.nfId);assert.equal(linked.status,'COMPANION_LINKED')
    assert.deepEqual(await rpc('fiscal_intake_commit_companion',fence(document.claim)),linked)
    assert.equal(await snapshot(imported.nfId),before,'Companion must preserve every NF fact/provenance field')
    assert.deepEqual(await counts(imported.nfId),{nf:1,documents:2,versions:2})
    if(codes.includes('nf_danfe_pdf')){
      const req=(await admin.query("select documento_id,status,versao_aprovada_id,nivel_validacao_snapshot,responsavel_aprovacao_snapshot from public.documento_requisito_instancias where nota_fiscal_id=$1 and tipo_documento_codigo_snapshot='nf_danfe_pdf'",[imported.nfId])).rows[0]
      assert(req.documento_id);assert.equal(req.status,'pendente');assert.equal(req.versao_aprovada_id,null);assert.equal(req.nivel_validacao_snapshot,'manual');assert.equal(req.responsavel_aprovacao_snapshot,'gestor')
    }
    const replay=await attachment('nf_danfe_pdf');assert.equal((await prep(replay,k,'nf_danfe_pdf')).status,'COMPANION_LINKED')
    assert.deepEqual(await counts(imported.nfId),{nf:1,documents:2,versions:2})
    const state=(await admin.query('select state,generation,owner_token from private.fiscal_identity_reservations where id=$1',[imported.claim.id])).rows[0]
    assert.equal(state.state,'COMPLETED');assert.equal(Number(state.generation),imported.claim.generation);assert.equal(state.owner_token,imported.claim.token)
    checks.push('POLICY_'+(codes.length?codes.join('_AND_'):'NO_BASE_REQUIREMENTS')+'_ONE_NF_TWO_DOCUMENTS')
  }
  checks.push('XML_PRIORITY_DURABLE_WAIT_NO_ATTEMPT_EXHAUSTION','XML_ONLY_PDF_REQUIREMENT_PENDING','MANUAL_DANFE_APPROVAL_PRESERVED','COMPANION_REPLAY_NO_NEW_DOCUMENT_VERSION','NF_PROVENANCE_AND_RESERVATION_UNCHANGED')
  await policy([])
  const lateKey=key(),earlyPdf=await attachment('nf_danfe_pdf'),early=await importNf(earlyPdf,lateKey,'nf_danfe_pdf')
  const lateXml=await attachment('nf_xml'),late=await prep(lateXml,lateKey,'nf_xml','c'.repeat(64));assert.equal(late.status,'DOCUMENT')
  const old=await snapshot(early.nfId);await put(late.intent);assert.equal((await rpc('fiscal_intake_commit_companion',fence(late.claim))).nfId,early.nfId);assert.equal(await snapshot(early.nfId),old)
  checks.push('DANFE_ONLY_LATE_XML_ONE_NF_NO_FACT_OVERWRITE')
  const mismatch=await attachment('nf_danfe_pdf');assert.equal((await prep(mismatch,lateKey,'nf_danfe_pdf','d'.repeat(64),{valor_bruto:200})).status,'AMBIGUOUS')
  const different=await attachment('nf_danfe_pdf',lateXml.messageId);assert.equal((await prep(different,key(),'nf_danfe_pdf')).status,'AMBIGUOUS')
  const invalidMessage=await message(),invalidXml=await attachment('nf_xml',invalidMessage),validPdf=await attachment('nf_danfe_pdf',invalidMessage)
  await rpc('email_intake_settle_attachment',[invalidXml.attachmentId,invalidXml.attachmentToken,'INVALID',1000]);assert.equal((await prep(validPdf,key(),'nf_danfe_pdf')).status,'AMBIGUOUS')
  const foreign=await attachment('nf_danfe_pdf');foreign.integrationId=actors[2].integrationId
  await assert.rejects(prep(foreign,lateKey,'nf_danfe_pdf'),/FISCAL_LEASE_LOST/)
  const revoked=await attachment('nf_danfe_pdf');revoked.attachmentToken=randomUUID();await assert.rejects(prep(revoked,lateKey,'nf_danfe_pdf'),/FISCAL_LEASE_LOST/)
  checks.push('DIFFERENT_KEY_AND_MATERIAL_MISMATCH_DENIED','INVALID_XML_NO_SILENT_PDF_FALLBACK','FOREIGN_INTEGRATION_AND_STALE_LEASE_DENIED')
  // Hold canonical reservation open and prove the concurrent PDF waits durably, not a second NF.
  const concurrentKey=key(),same=await message(),xmlActor=await attachment('nf_xml',same),pdfActor=await attachment('nf_danfe_pdf',same)
  await clients[1].query('begin');assert.equal((await prep(xmlActor,concurrentKey,'nf_xml')).status,'CREATE_NF')
  const reservation=await rpc('fiscal_intake_reserve',[xmlActor,fundId,linkId,establishment,'NFE',concurrentKey,'a'.repeat(64)])
  let settled=false;const rival=rpc('fiscal_intake_prepare_companion',[pdfActor,fundId,linkId,establishment,concurrentKey,'b'.repeat(64),'nf_danfe_pdf',facts(concurrentKey),'qa.pdf',100],2).finally(()=>{settled=true})
  let blocked=false;for(let i=0;i<40;i++){if((await admin.query("select 1 from pg_stat_activity where wait_event_type='Lock' and query like 'select public.fiscal_intake_prepare_companion%'")).rowCount){blocked=true;break}await new Promise(r=>setTimeout(r,25))}
  assert(blocked);assert.equal(settled,false);await clients[1].query('commit');assert.equal((await rival).status,'WAITING_CANONICAL_XML');assert(reservation.id)
  const concurrentNf=await importNf(xmlActor,concurrentKey,'nf_xml',reservation)
  const concurrentPdf=await prep(pdfActor,concurrentKey,'nf_danfe_pdf');assert.equal(concurrentPdf.status,'DOCUMENT')
  await put(concurrentPdf.intent);assert.equal((await rpc('fiscal_intake_commit_companion',fence(concurrentPdf.claim))).nfId,concurrentNf.nfId)
  assert.deepEqual(await counts(concurrentNf.nfId),{nf:1,documents:2,versions:2})
  checks.push('REAL_XML_PDF_CONCURRENCY_CANONICAL_LOCK_ONE_RESERVATION')
  const retryActor=await attachment('nf_danfe_pdf'),retrySha='e'.repeat(64)
  const interrupted=await prep(retryActor,concurrentKey,'nf_danfe_pdf',retrySha)
  assert.equal(interrupted.status,'DOCUMENT')
  await assert.rejects(rpc('fiscal_intake_commit_companion',fence(interrupted.claim)),/FISCAL_STORAGE_UNCONFIRMED/)
  assert.equal((await prep(retryActor,concurrentKey,'nf_danfe_pdf',retrySha)).status,'IN_PROGRESS')
  await admin.query("update private.fiscal_document_claims set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[interrupted.claim.id])
  assert.equal((await prep(retryActor,concurrentKey,'nf_danfe_pdf',retrySha)).status,'CLEANUP_PENDING')
  const cleanup=await rpc('fiscal_intake_claim_cleanup',[concurrentNf.claim.id])
  assert.equal(cleanup.id,interrupted.intent.id)
  if(storageFixtures)await storageFixtures.remove(cleanup)
  else await admin.query('delete from storage.objects where bucket_id=$1 and name=$2',[cleanup.bucket,cleanup.path])
  await rpc('fiscal_intake_settle_cleanup',[cleanup.id,cleanup.token,true])
  const recovered=await prep(retryActor,concurrentKey,'nf_danfe_pdf',retrySha)
  assert.equal(recovered.status,'DOCUMENT');assert.equal(recovered.claim.generation,2)
  await assert.rejects(rpc('fiscal_intake_commit_companion',fence(interrupted.claim)),/FISCAL_LEASE_LOST/)
  const originalFacts=await snapshot(concurrentNf.nfId)
  await put(recovered.intent);await rpc('fiscal_intake_commit_companion',fence(recovered.claim))
  assert.equal(await snapshot(concurrentNf.nfId),originalFacts)
  const retained=(await admin.query("select id,bucket,path from private.fiscal_storage_intents where reservation_id=$1 and state='RETAINED'",[concurrentNf.claim.id])).rows
  await clients[0].query('select public.excluir_notas_fiscais_rascunho_cedente($1)',[[concurrentNf.nfId]])
  for(const intent of retained)assert.equal((await admin.query('select state from private.fiscal_storage_intents where id=$1',[intent.id])).rows[0].state,'DELETE_PENDING')
  for(let index=0;index<retained.length;index++){
    const owned=await rpc('fiscal_intake_claim_cleanup',[concurrentNf.claim.id])
    assert(owned)
    if(storageFixtures)await storageFixtures.remove(owned)
    else await admin.query('delete from storage.objects where bucket_id=$1 and name=$2',[owned.bucket,owned.path])
    await rpc('fiscal_intake_settle_cleanup',[owned.id,owned.token,true])
  }
  assert.equal((await admin.query('select state from private.fiscal_identity_reservations where id=$1',[concurrentNf.claim.id])).rows[0].state,'RELEASED')
  checks.push('COMPANION_STORAGE_FAILURE_CLEANUP_GENERATION_RECOVERY','OLD_DOCUMENT_FENCE_DENIED','OFFICIAL_DRAFT_DELETE_COMPANION_GENERATIONS_CLEANED')
  for(const role of ['anon','authenticated','service_role'])assert.equal((await admin.query("select has_table_privilege($1,'private.fiscal_document_claims','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false)
  for(const role of ['anon','authenticated'])assert.equal((await admin.query("select has_function_privilege($1,'public.fiscal_intake_commit_companion(uuid,uuid,bigint)','EXECUTE') allowed",[role])).rows[0].allowed,false)
  checks.push('COMPANION_PRIVATE_RLS_NO_BROWSER_GRANTS')
  return checks
}
