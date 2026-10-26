import assert from 'node:assert/strict'
import {randomUUID,randomBytes,randomInt,createHmac,createHash} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {Client} from 'pg'
import {createClient} from '@supabase/supabase-js'
import {importFiscalFile} from '@/lib/fiscal-intake/service.server'
import {createFiscalImportRepository} from '@/lib/fiscal-intake/repository.server'
import {createFiscalStorage} from '@/lib/fiscal-intake/storage.server'
import {nfeFixtureKey} from '../../scripts/email-intake/nfe-fixture-key.mjs'
import {syntheticDanfePdf} from './synthetic-danfe-pdf.mjs'

const fund='22000000-0000-4000-8000-000000000003',cedente='23000000-0000-4000-8000-000000000003',link='24000000-0000-4000-8000-000000000003',consultoria='29000000-0000-4000-8000-000000000001'
function totp(secret){const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',bits=[...secret.replace(/=/g,'').toUpperCase()].map(c=>chars.indexOf(c).toString(2).padStart(5,'0')).join(''),bytes=Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',bytes).update(counter).digest(),o=h[19]&15;return String((h.readUInt32BE(o)&0x7fffffff)%1000000).padStart(6,'0')}
const value=(r,stage)=>{assert.ok(!r.error,stage+':'+(r.error?.code??'UNKNOWN'));return r.data}

/** @param {'NO_DUP'|'INVALID_SUM'|'ORDER_FANOUT'|'ATOMIC_ROLLBACK'|'ISSUER_SCOPE'|'DANFE_DRAFT'} mode */
export async function verifyLocalContract(mode){
 assert.equal(process.env.EMAIL_INTAKE_DISPOSABLE_SMOKE,'true','Explicit disposable QA required; never skip or use fake success')
 assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:57861')
 const reportRoot=process.env.EMAIL03_LOCAL_CONTRACT_REPORT;assert.ok(reportRoot?.startsWith('/reports/'))
 const db=new Client({host:'127.0.0.1',port:57862,user:'postgres',password:process.env.LOCAL_QA_PG_PASSWORD,database:'postgres'})
 const opts={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,opts),human=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,opts)
 const result={mode,status:'IN_PROGRESS',checks:[],nativeAuth:true,source:'Real approved service/repository/parser/native DB/Auth/Storage; QA fixture only',rpcFailures:[]}
 let userId,establishment,originalEstablishmentStatus,originalEstablishmentReason,originalSuspendedAt,originalSuspendedBy
 try{
  await db.connect();assert.equal((await db.query('select current_database() db')).rows[0].db,'postgres')
  const dates=(await db.query('select current_date::text issued,(current_date+30)::text due')).rows[0]
  const email='contract-'+randomUUID()+'@example.invalid',password='QA!A1'+randomBytes(24).toString('base64url')
  const {user}=value(await admin.auth.admin.createUser({email,password,email_confirm:true}),'NATIVE_CREATE');userId=user.id
  const role=mode==='ISSUER_SCOPE'?'consultor':'cedente'
  await db.query("update public.profiles set role=$2,status='ativo' where id=$1",[userId,role])
  if(role==='cedente')await db.query("insert into public.cedente_acessos(cedente_id,user_id,perfil,status,ativo,aceito_em) values($1,$2,'OPERACIONAL','ATIVO',true,now())",[cedente,userId])
  else await db.query("insert into public.consultor_usuarios(consultor_id,user_id,papel,status,ativado_em) values($1,$2,'ADMIN','ativo',now())",[consultoria,userId])
  value(await human.auth.signInWithPassword({email,password}),'NATIVE_LOGIN')
  const factor=value(await human.auth.mfa.enroll({factorType:'totp',friendlyName:'Local contract'}),'NATIVE_FACTOR'),challenge=value(await human.auth.mfa.challenge({factorId:factor.id}),'NATIVE_CHALLENGE')
  value(await human.auth.mfa.verify({factorId:factor.id,challengeId:challenge.id,code:totp(factor.totp.secret)}),'NATIVE_TOTP')
  value(await human.rpc('registrar_sessao_mfa_atual',{p_factor_id:factor.id}),'CANONICAL_MFA')
  result.checks.push('NATIVE_PASSWORD_TOTP_CANONICAL_SESSION')
  const observed=new Proxy(human,{get(target,key){if(key!=='rpc')return Reflect.get(target,key);return async(name,args)=>{const r=await target.rpc(name,args);if(r.error)result.rpcFailures.push({function:name,code:r.error.code,domain:/^FISCAL_[A-Z_]+$/.test(r.error.message)?r.error.message:'SANITIZED'});return r}}})
  const repo=createFiscalImportRepository(observed),storage=createFiscalStorage()
  function make(kind='VALID',issuer='98300000000101'){
   const number=randomInt(61000000,79000000),key=nfeFixtureKey({issuer,number,issued:dates.issued})
   const amounts=kind==='NO_DUP'?[]:kind==='INVALID_SUM'?[99]:[50,50]
   const duplicates=amounts.map((amount,i)=>'<dup><nDup>'+((kind==='DUPLICATE_PARCEL')?1:i+1)+'</nDup><dVenc>'+dates.due+'</dVenc><vDup>'+amount+'.00</vDup></dup>').join('')
   const xml='<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe'+key+'"><ide><serie>1</serie><nNF>'+number+'</nNF><dhEmi>'+dates.issued+'T10:00:00-03:00</dhEmi></ide><emit><CNPJ>'+issuer+'</CNPJ><xNome>QA SEM VALOR FISCAL</xNome></emit><dest><CNPJ>11222333000181</CNPJ><xNome>SACADO QA</xNome></dest><total><ICMSTot><vNF>100.00</vNF></ICMSTot></total><cobr><fat><vOrig>100.00</vOrig><vLiq>100.00</vLiq></fat>'+duplicates+'</cobr></infNFe></NFe></nfeProc>'
   return{number,key,file:new File([xml],'qa-'+number+'.xml',{type:'application/xml'}),xml}
  }
  const run=async(f,dependencies={repository:repo,storage},extra={})=>importFiscalFile({actor:{type:'HUMAN',userId},fundoId:fund,cedenteFundoId:link,file:f.file,...extra},dependencies)
  const notes=async f=>(await db.query('select id,status,valor_bruto,valor_liquido,data_emissao::text,data_vencimento::text from public.notas_fiscais where chave_acesso=$1',[f.key])).rows
  const empty=async f=>{assert.equal((await notes(f)).length,0);const rows=(await db.query('select id,state from private.fiscal_identity_reservations where file_sha256=$1',[createHash('sha256').update(f.xml).digest('hex')])).rows;for(const row of rows){assert.ok(['RELEASED','CLEANUP_PENDING'].includes(row.state));assert.equal((await db.query('select count(*)::int n from storage.objects where name like $1',[row.id+'/%'])).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from public.notas_fiscais where fiscal_reservation_id=$1',[row.id])).rows[0].n,0)};return rows.map(r=>r.state)}
  if(mode==='DANFE_DRAFT'){
   const number=randomInt(61000000,79000000),key=nfeFixtureKey({issuer:'98300000000101',number,issued:dates.issued})
   const issued=dates.issued.split('-').reverse().join('/')
   const bytes=syntheticDanfePdf(['DANFE','IDENTIFICACAO DO EMITENTE','CNPJ/CPF','98.300.000/0001-01',
    'CHAVE DE ACESSO',key,`NF-e No ${number}`,'SERIE 1','DATA DA EMISSAO '+issued,
    'DESTINATARIO/REMETENTE','SACADO QA 11.222.333/0001-81','FATURA','CALCULODOIMPOSTO','V.TOTALDANOTA',
    '1.234,56','TRANSPORTADOR','DADOS DOS PRODUTOS','ITEM A 100,00','ITEM B 1.134,56',
    'INFORMACOES COMPLEMENTARES','PAGAMENTO DA FATURA: 60 DIAS'])
   const f={key,file:new File([bytes],'synthetic-danfe.pdf',{type:'application/pdf'}),xml:bytes}
   const pending=await run(f);assert.equal(pending.status,'DUE_DATE_REQUIRED');assert.equal(pending.review.bruto,1234.56)
   assert.equal((await notes(f)).length,0);assert.equal((await db.query('select count(*)::int n from private.fiscal_identity_reservations where file_sha256=$1',[createHash('sha256').update(bytes).digest('hex')])).rows[0].n,0)
   result.checks.push('REAL_PDF_PARSE_COMPACT_LABEL','NO_RESERVATION_OR_NOTE_BEFORE_HUMAN_DUE')
   assert.ok(['ROUTING_DENIED','UNKNOWN_CEDENTE','INVALID'].includes((await run(f,undefined,{fundoId:randomUUID(),danfeManualDue:dates.due})).status))
   assert.equal((await run(f,undefined,{actor:{type:'HUMAN',userId:randomUUID()},danfeManualDue:dates.due})).status,'ROUTING_DENIED')
   result.checks.push('FOREIGN_FUND_AND_FORGED_ACTOR_DENIED')
   // The schema-only minimal fixture intentionally has XML/boleto, not the
   // canonical PDF catalog row. Prove the guard before completing test data.
   assert.equal((await db.query("select count(*)::int n from public.documento_tipos where codigo='nf_danfe_pdf'")).rows[0].n,0)
   assert.equal((await run(f,undefined,{danfeManualDue:dates.due})).status,'FAILED');await empty(f)
   result.checks.push('MISSING_PDF_CATALOG_REJECTS_NO_ORPHAN')
   // Exact PDF catalog contract from 20260722193500; no policy or grant change.
   await db.query("insert into public.documento_tipos(codigo,nome,dominio,mime_types_aceitos,extensoes_aceitas,tamanho_max_bytes,permite_multiplas_versoes,ativo) values('nf_danfe_pdf','DANFE em PDF','nf',ARRAY['application/pdf'],ARRAY['pdf'],20971520,true,true)")
   const imported=await run(f,undefined,{danfeManualDue:dates.due});assert.equal(imported.status,'IMPORTED')
   const n=(await notes(f))[0];assert.equal(n.status,'rascunho');assert.equal(Number(n.valor_bruto),1234.56);assert.equal(n.valor_liquido,null);assert.equal(n.data_vencimento,dates.due)
   const evidence=(await db.query('select vencimento_origem,valor_liquido_origem,fiscal_proveniencia from public.notas_fiscais where id=$1',[n.id])).rows[0]
   assert.equal(evidence.vencimento_origem,'MANUAL');assert.equal(evidence.valor_liquido_origem,'NAO_INFORMADO');assert.equal(evidence.fiscal_proveniencia.vencimento_documento,null)
   assert.equal((await db.query('select count(*)::int n from public.nota_fiscal_parcelas where nota_fiscal_id=$1',[n.id])).rows[0].n,0)
   const reservation=(await db.query('select id from private.fiscal_identity_reservations where nota_fiscal_id=$1',[n.id])).rows[0]
   const docs=(await db.query('select bucket_id,name from storage.objects where name like $1',[reservation.id+'/%'])).rows;assert.equal(docs.length,1)
   const original=value(await admin.storage.from(docs[0].bucket_id).download(docs[0].name),'DANFE_NATIVE_DOWNLOAD');assert.equal(Buffer.compare(Buffer.from(await original.arrayBuffer()),bytes),0)
   const requirements=(await db.query('select status from public.documento_requisito_instancias where nota_fiscal_id=$1',[n.id])).rows
   assert.ok(requirements.length>0);assert.ok(requirements.every(row=>row.status==='pendente'))
   assert.equal((await run(f,undefined,{danfeManualDue:dates.due})).status,'DUPLICATE');assert.equal((await notes(f)).length,1)
   result.checks.push('NATIVE_DRAFT_COMMIT','EXACT_CENTS_AND_MANUAL_DUE_PROVENANCE','NO_INVENTED_NET_OR_PARCEL','ORIGINAL_PDF_BYTES_RETAINED','FUND_DOCUMENT_REQUIREMENTS_STILL_PENDING','DUPLICATE_ONE_NOTE')
  }else if(mode==='NO_DUP'||mode==='ORDER_FANOUT'){
   const f=make(mode==='NO_DUP'?'NO_DUP':'VALID'),r=await run(f);assert.equal(r.status,'IMPORTED');const n=(await notes(f))[0]
   assert.equal(n.status,'rascunho');assert.equal(Number(n.valor_bruto),100);assert.equal(Number(n.valor_liquido),100)
   const parcels=(await db.query('select id,numero_parcela,valor_nominal from public.nota_fiscal_parcelas where nota_fiscal_id=$1 order by numero_parcela',[n.id])).rows
   const reqs=(await db.query("select parcela_id,status from public.documento_requisito_instancias where nota_fiscal_id=$1 and tipo_documento_codigo_snapshot='boleto'",[n.id])).rows
   assert.equal(parcels.length,mode==='NO_DUP'?0:2);assert.equal(reqs.length,parcels.length)
   for(const parcel of parcels){assert.equal(Number(parcel.valor_nominal),50);assert.equal(reqs.filter(x=>x.parcela_id===parcel.id).length,1)}
   assert.equal(n.data_vencimento,mode==='NO_DUP'?dates.issued:dates.due)
   const reservation=(await db.query('select id,actor_type,actor_user_id,state from private.fiscal_identity_reservations where nota_fiscal_id=$1',[n.id])).rows[0]
   assert.equal(reservation.actor_type,'HUMAN');assert.equal(reservation.actor_user_id,userId);assert.equal(reservation.state,'COMPLETED')
   const docs=(await db.query('select bucket_id,name from storage.objects where name like $1',[reservation.id+'/%'])).rows;assert.equal(docs.length,1)
   const original=value(await admin.storage.from(docs[0].bucket_id).download(docs[0].name),'NATIVE_DOWNLOAD');assert.equal(Buffer.compare(Buffer.from(await original.arrayBuffer()),Buffer.from(f.xml)),0)
   assert.equal((await run(f)).status,'DUPLICATE');assert.equal((await notes(f)).length,1);assert.equal((await db.query('select count(*)::int n from storage.objects where name like $1',[reservation.id+'/%'])).rows[0].n,1)
   result.checks.push(mode==='NO_DUP'?'NO_PARCELS_NO_BOLETO_NO_INVENTED_DEBT':'ATOMIC_TWO_PARCELS_TWO_MATCHING_BOLETO_REQUIREMENTS_FIRST_COMMIT','EXACT_FINANCIAL_DATES','ORIGINAL_STORAGE_BYTES','HUMAN_AUDIT','DUPLICATE_ONE_NOTE_ONE_OBJECT')
   result.note={id:n.id,key:f.key,parcels:parcels.length,requirements:reqs.length,status:n.status}
  }else if(mode==='INVALID_SUM'||mode==='ATOMIC_ROLLBACK'){
   const f=make(mode==='INVALID_SUM'?'INVALID_SUM':'DUPLICATE_PARCEL');let uploadObserved=false
   const r=await run(f,{repository:repo,storage:{upload:async(intent,file)=>{await storage.upload(intent,file);assert.equal((await db.query('select count(*)::int n from storage.objects where bucket_id=$1 and name=$2',[intent.bucket,intent.path])).rows[0].n,1);uploadObserved=true}}})
   assert.equal(r.status,'FAILED');assert.equal(uploadObserved,true);result.states=await empty(f)
   result.checks.push(mode==='INVALID_SUM'?'REAL_SUM_CONSTRAINT_REJECTS_AFTER_PARCEL_INSERTS':'REAL_DUPLICATE_PARCEL_UNIQUE_CONSTRAINT_ROLLBACK','STORAGE_UPLOAD_OBSERVED_THEN_COMPENSATED','NO_PARTIAL_NF_OR_PARCELS','NO_ORPHAN_STORAGE')
  }else{
   const good=make(),ok=await run(good);assert.equal(ok.status,'IMPORTED');result.checks.push('CONSULTOR_ACTIVE_ISSUER_ESTABLISHMENT_NATIVE_IMPORT')
   const foreign=make('VALID','11222333000181');assert.ok(['UNKNOWN_CEDENTE','ROUTING_DENIED','INVALID'].includes((await run(foreign)).status));await empty(foreign);result.checks.push('FOREIGN_ISSUER_DENIED_NO_STORAGE')
   const wrong=make();assert.ok(['UNKNOWN_CEDENTE','ROUTING_DENIED','INVALID'].includes((await run(wrong,undefined,{fundoId:randomUUID()})).status));await empty(wrong);result.checks.push('WRONG_FUND_DENIED_NO_STORAGE')
   const actor=make();assert.equal((await run(actor,undefined,{actor:{type:'HUMAN',userId:randomUUID()}})).status,'ROUTING_DENIED');await empty(actor);result.checks.push('PAYLOAD_ACTOR_NOT_JWT_USER_DENIED')
   const e=(await db.query("select id,status,motivo_status,suspenso_em,suspenso_por from public.cedente_estabelecimentos where cedente_id=$1 and tipo='matriz'",[cedente])).rows[0];establishment=e.id;originalEstablishmentStatus=e.status;originalEstablishmentReason=e.motivo_status;originalSuspendedAt=e.suspenso_em;originalSuspendedBy=e.suspenso_por
   await db.query("update public.cedente_estabelecimentos set status='suspenso',suspenso_em=now(),suspenso_por=$2,motivo_status='QA negative origin fixture' where id=$1",[establishment,userId]);const inactive=make();assert.ok(['UNKNOWN_CEDENTE','ROUTING_DENIED','INVALID'].includes((await run(inactive)).status));await empty(inactive);await db.query('update public.cedente_estabelecimentos set status=$2,motivo_status=$3,suspenso_em=$4,suspenso_por=$5 where id=$1',[establishment,originalEstablishmentStatus,originalEstablishmentReason,originalSuspendedAt,originalSuspendedBy]);result.checks.push('INACTIVE_ESTABLISHMENT_DENIED')
   const revoked=make();const guarded={...repo,reserve:async(...args)=>{const claim=await repo.reserve(...args);assert.ok('id' in claim);await db.query("update public.consultor_usuarios set papel='LEITOR' where user_id=$1 and consultor_id=$2",[userId,consultoria]);return claim}}
   assert.equal((await run(revoked,{repository:guarded,storage})).status,'FAILED');await empty(revoked);result.checks.push('MEMBERSHIP_RECHECK_AFTER_RESERVATION_DENIED_NO_STORAGE')
  }
  result.status='PASS';return result
 }catch(e){result.status='FAIL';result.error={code:e.code??e.name,message:e.message.slice(0,200)};throw e}
 finally{
  if(establishment)await db.query('update public.cedente_estabelecimentos set status=$2,motivo_status=$3,suspenso_em=$4,suspenso_por=$5 where id=$1',[establishment,originalEstablishmentStatus,originalEstablishmentReason,originalSuspendedAt,originalSuspendedBy]).catch(()=>{})
  await human.auth.signOut();await db.end();await mkdir(reportRoot,{recursive:true});await writeFile(reportRoot+'/'+mode+'-'+randomUUID()+'.json',JSON.stringify(result,null,2))
 }
}
