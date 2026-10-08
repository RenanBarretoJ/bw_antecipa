import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mapping} from './r2-2-render.mjs'
import {validateProfile} from './r1-15-rls-fixture.mjs'
export async function seedMappingFixture(db){
 assert.equal(db.connectionParameters.host,'127.0.0.1')
 const cedents=[]
 for(const a of [...mapping.actors,...[1,2].map(i=>({id:`f2220000-0000-4000-8000-00000000000${i}`,email:`r22-cedent-${i}@example.invalid`,name:`R22 Cedente ${i}`}))]){
  await db.query('INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES($1,$2,$3,$4,now(),now())',[a.id,a.email,{}, {nome_completo:a.name}])
  const rows=(await db.query('SELECT id,email,role::text,status::text,nome_completo FROM public.profiles WHERE id=$1',[a.id])).rows
  validateProfile(rows,{...a,role:'cedente'})
  assert.throws(()=>validateProfile([{...rows[0],role:'unexpected'}],{...a,role:'cedente'}),/UNEXPECTED_CANONICAL_ROLE/)
  assert.throws(()=>validateProfile([{...rows[0],status:'inativo'}],{...a,role:'cedente'}),/UNEXPECTED_CANONICAL_STATUS/)
 }
 for(const [i,fund] of [mapping.mainFund,mapping.adversarialFund].entries()){
  await db.query('INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo) VALUES($1,$2,$3,$4,$5,$6,$7,true)',[fund,i?'QA RLX GOLDEN V2 ADVERSARIAL FIDC':'QA RLX GOLDEN V2 FIDC',i?'84810000000228':'84810000000147','QA Admin','98000000000277','QA Gestor','98000000000358'])
  const c={id:randomUUID(),link:randomUUID(),user:`f2220000-0000-4000-8000-00000000000${i+1}`,cnpj:i?'84820000000632':'84820000000128',fund}
  await db.query("INSERT INTO public.cedentes(id,user_id,cnpj,razao_social,status) VALUES($1,$2,$3,'R22 QA Cedente','ativo')",[c.id,c.user,c.cnpj])
  await db.query("INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id,status) VALUES($1,$2,$3,'ativo')",[c.link,c.id,fund]);cedents.push(c)
 }
 const notes=[]
 for(const a of mapping.actors){
  await db.query('INSERT INTO public.sacados(id,user_id,cnpj,razao_social,email) VALUES($1,$2,$3,$4,$5)',[a.sacado,a.id,a.cnpj,a.name,a.email])
  for(const [i,c] of cedents.entries())for(let n=0;n<(i?a.adversarialNotes:a.mainNotes);n++){
   const id=randomUUID();notes.push({id,fund:c.fund,actor:a.id})
   await db.query(`INSERT INTO public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,valor_liquido_origem,status)
    VALUES($1,$2,$3,$4,$5,'1',current_date,current_date+30,$6,'R22 QA Cedente',$7,$8,1000,900,'DOCUMENTO_EXPLICITO','rascunho')`,[id,c.id,c.link,c.fund,'R22-'+notes.length,c.cnpj,a.cnpj,a.name])
  }
 }
 assert.equal(notes.length,110)
 return {notes,cedents,actors:mapping.actors}
}
export async function mappingFingerprints(db){
 const tables=(await db.query(`SELECT schemaname,tablename FROM pg_tables
  WHERE (schemaname IN('public','private') AND tablename NOT IN('profiles','usuario_papeis','logs_auditoria','sacado_acessos'))
   OR (schemaname='auth' AND tablename IN('users','mfa_factors'))
   OR (schemaname='storage' AND tablename IN('objects','buckets')) ORDER BY 1,2`)).rows
 const result=[]
 for(const t of tables){
  const quote=s=>'"'+s.replaceAll('"','""')+'"',table=quote(t.schemaname)+'.'+quote(t.tablename)
  result.push({table:t.schemaname+'.'+t.tablename,...(await db.query(`SELECT count(*)::int n,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) hash FROM ${table} t`)).rows[0]})
 }
 return result
}
export async function verifyMappingRls(db,fixture){
 const checks=[]
 for(const a of mapping.actors){
  await db.query('BEGIN;SET LOCAL ROLE authenticated')
  try{
   await db.query("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",[JSON.stringify({sub:a.id,role:'authenticated',aal:'aal2'}),a.id])
   const proof=(await db.query("SELECT current_user,auth.uid()::text uid,rolsuper,rolbypassrls,row_security_active('public.notas_fiscais') active FROM pg_roles WHERE rolname=current_user")).rows[0]
   assert.equal(proof.current_user,'authenticated');assert.equal(proof.uid,a.id);assert.equal(proof.rolsuper,false);assert.equal(proof.rolbypassrls,false);assert.equal(proof.active,true)
   const contexts=(await db.query('SELECT * FROM public.get_user_sacado_context()')).rows
   assert.equal(contexts.length,1);assert.equal(contexts[0].fundo_id,mapping.mainFund);assert.equal(contexts[0].cnpj,a.cnpj)
   const ids=(await db.query('SELECT id::text FROM public.notas_fiscais ORDER BY id')).rows.map(r=>r.id)
   const expected=fixture.notes.filter(n=>n.actor===a.id&&n.fund===mapping.mainFund).map(n=>n.id).sort()
   assert.deepEqual(ids,expected,'OWN_FUND_ROW_SET');assert.equal(ids.length,a.mainNotes)
   checks.push({actor:a.id,role:'sacado',policySet:'CANONICAL_SACADO',query:'SELECT id FROM public.notas_fiscais ORDER BY id',expected,actual:ids,adversarialVisible:0,proof,result:'PASS'})
  }finally{await db.query('ROLLBACK')}
 }
 return checks
}
