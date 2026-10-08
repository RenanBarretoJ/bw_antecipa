import assert from 'node:assert/strict'
import {hash} from './r1-4-restorer.mjs'
export const uid=n=>'f1150000-0000-4000-8000-'+String(n).padStart(12,'0')
const date='2026-10-07T12:00:00Z'
export const actors=[
 {n:1,name:'cedente_owner_A',role:'cedente',funds:['A'],allowed:['A']},
 {n:2,name:'cedente_delegado_A',role:'cedente',funds:['A'],allowed:['A']},
 {n:3,name:'cedente_delegado_revogado_A',role:'cedente',funds:[],allowed:[]},
 {n:4,name:'cedente_owner_B',role:'cedente',funds:['B'],allowed:['B']},
 {n:5,name:'cedente_outro_owner_A2',role:'cedente',funds:['A'],allowed:['A2']},
 {n:6,name:'cedente_sem_vinculo',role:'cedente',funds:[],allowed:[]},
 {n:7,name:'gestor_A',role:'gestor',funds:['A'],allowed:['A','A2','REV','LEITOR_OWNER','GESTOR_OWNER']},
 {n:8,name:'gestor_B_owner_legado_fundo_A',role:'gestor',funds:['B'],allowed:['B']},
 {n:9,name:'gestor_sem_vinculo',role:'gestor',funds:[],allowed:[]},
 {n:10,name:'consultor_owner_A',role:'consultor',papel:'OWNER',funds:['A'],allowed:['A','LEITOR_OWNER']},
 {n:11,name:'consultor_operador_A',role:'consultor',papel:'OPERADOR',funds:['A'],allowed:['A','LEITOR_OWNER']},
 {n:12,name:'consultor_leitor_A',role:'consultor',papel:'LEITOR',funds:['A'],allowed:[]},
 {n:13,name:'consultor_inativo_A',role:'consultor',papel:'OPERADOR',membership:'inativo',funds:[],allowed:[]},
 {n:14,name:'consultor_operador_B',role:'consultor',papel:'OPERADOR',funds:['B'],allowed:['B']},
 {n:15,name:'consultor_sem_vinculo',role:'consultor',funds:[],allowed:[]},
 {n:16,name:'cedente_owner_revogado',role:'cedente',funds:[],allowed:[]},
 {n:17,name:'consultor_leitor_owner_legado',role:'consultor',papel:'LEITOR',funds:['A'],allowed:[]},
 {n:18,name:'gestor_vinculo_revogado_A',role:'gestor',funds:[],allowed:[]},
 {n:19,name:'gestor_multifundo_A_B',role:'gestor',funds:['A','B'],allowed:['A','A2','B','REV','LEITOR_OWNER','GESTOR_OWNER']},
 {n:20,name:'cedente_delegado_operacional_A',role:'cedente',funds:['A'],allowed:['A']},
].map(a=>({...a,id:uid(a.n),email:a.name+'@r115.invalid',dbRole:'authenticated'}))
export const cedentes=[
 {key:'A',n:101,owner:1,fund:'A'}, {key:'A2',n:102,owner:5,fund:'A'},
 {key:'B',n:103,owner:4,fund:'B'}, {key:'REV',n:104,owner:16,fund:'A'},
 {key:'LEITOR_OWNER',n:105,owner:17,fund:'A'}, {key:'GESTOR_OWNER',n:106,owner:8,fund:'A'},
].map(c=>({...c,id:uid(c.n),taxaId:uid(c.n+200),devedorId:uid(c.n+300)}))
export const funds={A:uid(201),B:uid(202)}
function cnpj(n){let base=String(n).padStart(12,'0');for(const weights of [[5,4,3,2,9,8,7,6,5,4,3,2],[6,5,4,3,2,9,8,7,6,5,4,3,2]]){const r=base.split('').reduce((s,d,i)=>s+Number(d)*weights[i],0)%11;base+=String(r<2?0:11-r)}return base}
export function validateProfile(rows,a){assert.equal(rows.length,1,'AUTOMATIC_PROFILE_CARDINALITY');const p=rows[0];assert.equal(p.id,a.id);assert.equal(p.email,a.email);assert.equal(p.role,a.role,'UNEXPECTED_CANONICAL_ROLE');assert.equal(p.status,'ativo','UNEXPECTED_CANONICAL_STATUS');assert.equal(p.nome_completo,a.name);return p}
export function expectedIds(a,table,filter){
 const allowed=table==='devedores_solidarios'&&a.role==='consultor'?[]:a.allowed
 return cedentes.filter(c=>allowed.includes(c.key)&&(!filter||c.key===filter)).map(c=>table==='taxas_cedente'?c.taxaId:c.devedorId).sort()
}
export async function seed(db){
 const profiles=[]
 await db.query('BEGIN')
 try{
  assert.equal((await db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,0)
  assert.equal((await db.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created'")).rows[0].tgenabled,'O')
  for(const a of actors){
   await db.query("INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES($1,'authenticated','authenticated',$2,'{}'::jsonb,$3::jsonb,$4,$4)",[a.id,a.email,JSON.stringify({role:a.role,nome_completo:a.name}),date])
   const rows=(await db.query('SELECT id,email,role::text,status::text,nome_completo FROM public.profiles WHERE id=$1',[a.id])).rows
   validateProfile(rows,a)
   assert.throws(()=>validateProfile([{...rows[0],role:'unexpected'}],a),/UNEXPECTED_CANONICAL_ROLE/)
   assert.throws(()=>validateProfile([{...rows[0],status:'inativo'}],a),/UNEXPECTED_CANONICAL_STATUS/)
   profiles.push({actor:a.id,canonicalProfile:rows[0],fixtureAdjustments:'NONE',negativeControl:'PASS'})
  }
  for(const [i,[key,id]] of Object.entries(Object.entries(funds))){await db.query('INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo) VALUES($1,$2,$3,$4,$5,$6,$7,true)',[id,'R115 Fundo '+key,cnpj(981150000100+Number(i)),'Admin QA',cnpj(981150000200+Number(i)),'Gestora QA',cnpj(981150000300+Number(i))])}
  for(const c of cedentes){
   await db.query('INSERT INTO public.cedentes(id,user_id,cnpj,razao_social,status,fundo_id,testemunha_1_nome,testemunha_1_cpf,testemunha_2_nome,testemunha_2_cpf) VALUES($1,$2,$3,$4,\'ativo\',$5,NULL,NULL,NULL,NULL)',[c.id,uid(c.owner),cnpj(981150000000+c.n),'R115 Cedente '+c.key,funds[c.fund]])
   await db.query("INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id,status,vigente_desde) VALUES($1,$2,$3,'ativo',$4)",[uid(c.n+500),c.id,funds[c.fund],date])
   await db.query('INSERT INTO public.taxas_cedente(id,cedente_id,prazo_min,prazo_max,taxa_percentual,created_at,updated_at) VALUES($1,$2,0,180,2.35,$3,$3)',[c.taxaId,c.id,date])
   await db.query('INSERT INTO public.devedores_solidarios(id,cedente_id,cpf,doc_numero,nome,created_at) VALUES($1,$2,$3,$4,$5,$6)',[c.devedorId,c.id,'00000000191','QA-'+c.key,'R115 Devedor '+c.key,date])
  }
  for(const [actor,key,status,perfil] of [[2,'A','ATIVO','ADMIN'],[3,'A','REVOGADO','ADMIN'],[16,'REV','REVOGADO','ADMIN'],[20,'A','ATIVO','OPERACIONAL']]){
   await db.query('INSERT INTO public.cedente_acessos(id,user_id,cedente_id,perfil,status,ativo,aceito_em,revogado_em) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(700+actor),uid(actor),cedentes.find(c=>c.key===key).id,perfil,status,status==='ATIVO',date,status==='REVOGADO'?date:null])
  }
  for(const [actor,key,status] of [[7,'A','ativo'],[8,'B','ativo'],[18,'A','revogado'],[19,'A','ativo'],[19,'B','ativo']])await db.query('INSERT INTO public.usuario_fundos(usuario_id,fundo_id,perfil_no_fundo,status) VALUES($1,$2,\'gestor\',$3)',[uid(actor),funds[key],status])
  for(const [i,key] of ['A','B'].entries()){
   const org=uid(801+i)
   await db.query("INSERT INTO public.consultores(id,cnpj,razao_social,status) VALUES($1,$2,$3,'ativo')",[org,cnpj(981150000800+i),'R115 Consultoria '+key])
   await db.query("INSERT INTO public.consultor_fundos(consultor_id,fundo_id,status) VALUES($1,$2,'ativo')",[org,funds[key]])
   for(const c of cedentes.filter(c=>key==='A'?['A','LEITOR_OWNER'].includes(c.key):c.key==='B'))await db.query("INSERT INTO public.consultor_cedentes(consultor_id,cedente_id,status) VALUES($1,$2,'ativo')",[org,c.id])
   for(const a of actors.filter(a=>a.papel&&(key==='A'?a.n!==14:a.n===14)))await db.query('INSERT INTO public.consultor_usuarios(consultor_id,user_id,papel,status,ativado_em,desativado_em) VALUES($1,$2,$3,$4,$5,$6)',[org,a.id,a.papel,a.membership??'ativo',date,a.membership==='inativo'?date:null])
  }
  await db.query('COMMIT')
 }catch(e){await db.query('ROLLBACK');throw e}
 return {actors,cedentes,funds,profiles,declarationHash:hash(JSON.stringify({actors,cedentes,funds})),noProfileUpdates:true}
}
