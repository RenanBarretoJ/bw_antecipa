import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {seedMappingFixture,mappingFingerprints} from './r2-2-fixture.mjs'
import {render,migrationPath,mapping,oldHash} from './r2-2-render.mjs'
import {hash} from './r1-4-restorer.mjs'
const sql=await readFile(migrationPath,'utf8')
assert.equal(sql,await render(),'BOOTSTRAP_COMPOSITION_DRIFT')
const version='20261008183349',sha256=hash(sql)
const snapshot=async db=>({preserved:await mappingFingerprints(db),roles:(await db.query('SELECT id,role::text,status::text FROM public.profiles ORDER BY id')).rows,accessTable:(await db.query("SELECT to_regclass('public.sacado_acessos')::text name")).rows[0].name,audit:(await db.query('SELECT count(*)::int n FROM public.logs_auditoria')).rows[0].n})
export function mappingCheckHook(result,save){
 let fixture
 const callback=async(db,source)=>{
 assert.equal(hash(source.sql),oldHash)
 fixture=await seedMappingFixture(db)
 const initial=await snapshot(db),id=mapping.actors[0].id
 const negative=async(name,mutation,migration,expected)=>{
  await db.query('BEGIN')
  let error
  try{if(mutation)await db.query(mutation.sql,mutation.params);await db.query(migration)}catch(e){error=e}
  finally{await db.query('ROLLBACK')}
  assert(error,'NEGATIVE_UNEXPECTED_SUCCESS:'+name)
  assert.equal(error.message,expected,name)
  assert.deepEqual(await snapshot(db),initial,'NEGATIVE_NOT_ATOMIC:'+name)
  result.negatives.push({name,expected,actual:error.message,rollback:'PASS'});await save()
 }
 await negative('historical_role_guard',null,source.sql,'SACADO_BACKFILL_PROFILE_REVIEW_REQUIRED')
 await negative('historical_multifund_guard',{sql:"UPDATE public.profiles SET role='sacado' WHERE id=ANY($1::uuid[])",params:[mapping.actors.map(a=>a.id)]},source.sql,'SACADO_BACKFILL_FUND_REVIEW_REQUIRED')
 await negative('unknown_legacy_actor',{sql:"INSERT INTO public.sacados(user_id,cnpj,razao_social) VALUES($1,'84830000000966','R22 Unknown')",params:[fixture.cedents[0].user]},sql,'R22_UNEXPECTED_LEGACY_SET')
 await negative('unexpected_profile_role',{sql:"UPDATE public.profiles SET role='sacado' WHERE id=$1",params:[id]},sql,'R22_APPROVED_IDENTITY_MISMATCH')
 await negative('unexpected_profile_status',{sql:"UPDATE public.profiles SET status='inativo' WHERE id=$1",params:[id]},sql,'R22_APPROVED_IDENTITY_MISMATCH')
 await negative('unexpected_auth_email',{sql:"UPDATE auth.users SET email='unexpected@example.invalid' WHERE id=$1",params:[id]},sql,'R22_AUTH_IDENTITY_MISMATCH')
 await negative('unexpected_fund',{sql:'UPDATE public.fundos SET ativo=false WHERE id=$1',params:[mapping.mainFund]},sql,'R22_FUND_IDENTITY_MISMATCH')
 await negative('unexpected_existing_grant',{sql:"INSERT INTO public.usuario_fundos(usuario_id,fundo_id,perfil_no_fundo,status) VALUES($1,$2,'gestor','ativo')",params:[id,mapping.adversarialFund]},sql,'R22_UNEXPECTED_EXISTING_AUTHORIZATION')
 await negative('unexpected_fiscal_evidence',{sql:'UPDATE public.notas_fiscais SET cnpj_destinatario=$1 WHERE id=$2',params:[mapping.actors[1].cnpj,fixture.notes[0].id]},sql,'R22_FISCAL_BASELINE_MISMATCH')
 const preserved=await mappingFingerprints(db)
 const profilesBefore=(await db.query('SELECT to_jsonb(p)-\'updated_at\' data FROM public.profiles p ORDER BY id')).rows.map(x=>x.data)
 const auditBefore=(await db.query('SELECT id,to_jsonb(a) data FROM public.logs_auditoria a ORDER BY id')).rows
 await db.query(sql)
 assert.deepEqual(await mappingFingerprints(db),preserved,'BOOTSTRAP_CHANGED_PRESERVED_DATA')
 const profilesAfter=(await db.query('SELECT to_jsonb(p)-\'updated_at\' data FROM public.profiles p ORDER BY id')).rows.map(x=>x.data)
 assert.deepEqual(profilesAfter,profilesBefore.map(p=>mapping.actors.some(a=>a.id===p.id)?{...p,role:'sacado'}:p),'PROFILE_CHANGE_BEYOND_APPROVED_ROLE')
 const auditAfter=(await db.query('SELECT id,to_jsonb(a) data FROM public.logs_auditoria a WHERE id=ANY($1::uuid[]) ORDER BY id',[auditBefore.map(a=>a.id)])).rows
 assert.deepEqual(auditAfter,auditBefore,'HISTORICAL_AUDIT_CHANGED')
 const audit=(await db.query("SELECT entidade_id::text,dados_antes,dados_depois FROM public.logs_auditoria WHERE tipo_evento='SACADO_QA_VINCULO_RECONCILIADO' ORDER BY entidade_id")).rows
 assert.equal(audit.length,8)
 const roles=(await db.query('SELECT id,role::text,status::text FROM public.profiles WHERE id=ANY($1::uuid[]) ORDER BY id',[mapping.actors.map(a=>a.id)])).rows
 assert.equal(roles.length,8);assert(roles.every(p=>p.role==='sacado'&&p.status==='ativo'))
 result.preservation={before:preserved,after:await mappingFingerprints(db),result:'PASS'};result.audit=audit;result.roles=roles
 await save()
 return {version,sha256,source:'NEW_EXPLICIT_HOMOLOG_BOOTSTRAP',originalExecuted:false}
 }
 return {callback,get fixture(){return fixture}}
}
