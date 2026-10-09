// Synthetic rollout fixtures; no existing user, fund, CNPJ, policy or document reused.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {randomUUID,randomBytes,createHmac} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {fingerprints,ident} from './production-runtime.mjs'
import {captureWebhooks,normalizeWebhooks} from './concurrent-webhooks.mjs'
export const val=r=>{assert(!r.error,r.error?.code??'QA_REQUEST_FAILED');return r.data}
function totp(secret){const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');const ctr=Buffer.alloc(8);ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)))).update(ctr).digest();return String((h.readUInt32BE(h[19]&15)&0x7fffffff)%1000000).padStart(6,'0')}
function cnpj(){let s='98'+[...randomBytes(10)].map(x=>x%10).join('');for(const weights of [[5,4,3,2,9,8,7,6,5,4,3,2],[6,5,4,3,2,9,8,7,6,5,4,3,2]]){const r=[...s].reduce((n,d,i)=>n+Number(d)*weights[i],0)%11;s+=r<2?0:11-r}return s}
export async function fixtureSession(db,d,output,{recover=false}={}){
  const previous=recover?JSON.parse(readFileSync(output+'/qa-manifest.json','utf8')):null
  if(previous)assert.equal(previous.ref,new URL(d.SUPABASE_URL).hostname.split('.')[0])
  const run=previous?.run??randomUUID(),owned=new Set(previous?.owned??[]),map=new Map(),actors={},clients=[]
  if(previous)for(const a of previous.users)actors[a.id]=a
  let before=previous?.before,concurrency=previous?.concurrency
  if(!previous){await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{concurrency=await captureWebhooks(db);before=await fingerprints(db);await db.query('COMMIT')}catch(e){await db.query('ROLLBACK');throw e}}
  const admin=createClient(d.SUPABASE_URL,d.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  const old=(p,n=1)=>`${p}000000-0000-4000-8000-${String(n).padStart(12,'0')}`
  const id=(p,n=1)=>{const k=old(p,n);if(!map.has(k))map.set(k,randomUUID());owned.add(map.get(k));return map.get(k)}
  const A=id('22'),B=id('22',2),C=id('22',3),CF=id('24'),CFB=id('24',2),NF=id('2a'),NFB=id('2a',5),OP=id('2c'),E=id('2d')
  const manifest=previous??{run,ref:new URL(d.SUPABASE_URL).hostname.split('.')[0],before,concurrency,owned:[],users:[],cleanup:[]}
  function save(){manifest.owned=[...owned];manifest.users=Object.values(actors).map(a=>({id:a.id,email:a.email}));writeFileSync(output+'/qa-manifest.json',JSON.stringify(manifest,null,2))}
  async function seed(){
    assert(!recover,'RECOVERY_IS_CLEANUP_ONLY')
    save()
    for(const [name,n,role] of [['consultor',1,'consultor'],['leitor',2,'consultor'],['cedente',3,'cedente'],['gestor',4,'gestor'],['sacado',5,'sacado'],['gestorB',6,'gestor']]){
      const email=`notif-r4-${name}-${run}@example.invalid`.toLowerCase(),password=randomBytes(24).toString('base64url')+'!aA9'
      const u=val(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{nome_completo:'QA Notificacoes R4 '+name}})).user
      map.set(old('21',n),u.id);owned.add(u.id);actors[name]={id:u.id,email,password,role};save()
    }
    let fixture=readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql','utf8').replaceAll('\r\n','\n')
    fixture=fixture.replace(/  INSERT INTO auth\.users[\s\S]*?\n\n  INSERT INTO public\.profiles/,'  INSERT INTO public.profiles')
    assert(!fixture.includes('INSERT INTO auth.users'))
    for(const k of fixture.match(/[a-f0-9]{8}-[a-f0-9-]{27}/g)||[])if(!map.has(k)){map.set(k,randomUUID());owned.add(map.get(k))}
    for(const [a,b] of map)fixture=fixture.replaceAll(a,b)
    const docs=new Map([...new Set(fixture.match(/\b\d{14}\b/g))].map(x=>[x,cnpj()]))
    for(const [a,b] of docs)fixture=fixture.replaceAll(a,b)
    fixture=fixture.replaceAll('ESCROW-C21','QA-R4-'+run).replaceAll('QA_C2_1','QA_R4_'+run.slice(0,8))
    save();await db.query('BEGIN')
    try{
      await db.query(fixture)
      for(const a of Object.values(actors))await db.query("UPDATE public.profiles SET nome_completo=$2,email=$3,role=$4,status='ativo',senha_alterada_em=now() WHERE id=$1",[a.id,'QA R4 '+a.role,a.email,a.role])
      await db.query("UPDATE public.fundos SET nome='QA Notificacoes A' WHERE id=$1",[A])
      for(const [f,name] of [[B,'B'],[C,'C']])await db.query("INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo) VALUES($1,$2,$3,'QA',$4,'QA',$5,true)",[f,'QA Notificacoes '+name,cnpj(),cnpj(),cnpj()])
      await db.query('INSERT INTO public.usuario_fundos(usuario_id,fundo_id) VALUES($1,$2),($3,$2)',[actors.gestor.id,B,actors.gestorB.id])
      await db.query('INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id) VALUES($1,$2,$3)',[CFB,id('23'),B])
      await db.query('INSERT INTO public.consultor_fundos(consultor_id,fundo_id,concedido_por) VALUES($1,$2,$3)',[id('29'),B,actors.gestor.id])
      await db.query("INSERT INTO public.sacados(id,cnpj,razao_social) VALUES($1,$2,'QA R4 Sacado')",[id('2b'),docs.get('11222333000181')])
      await db.query('INSERT INTO public.sacado_acessos(user_id,sacado_id,fundo_id) VALUES($1,$2,$3),($1,$2,$4)',[actors.sacado.id,id('2b'),A,B])
      await db.query(`INSERT INTO public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,status)
        SELECT $1,cedente_id,$2,$3,'QA-R4-B','1',data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,status FROM public.notas_fiscais WHERE id=$4`,[NFB,CFB,B,NF])
      await db.query(`INSERT INTO public.operacoes(id,cedente_id,cedente_fundo_id,valor_bruto_total,prazo_dias,data_vencimento,aceite_sacado_exigido,aceite_sacado_status) VALUES($1,$2,$3,1000,30,current_date+30,true,'pendente')`,[OP,id('23'),CF])
      await db.query('INSERT INTO public.operacoes_nfs(operacao_id,nota_fiscal_id) VALUES($1,$2)',[OP,NF])
      // Future deadlines: the real global cron must not act on rollout fixtures.
      await db.query("INSERT INTO public.nota_fiscal_entregas(id,operacao_id,nota_fiscal_id,status_entrega,data_limite_cte,data_limite_canhoto) VALUES($1,$2,$3,'em_transito',current_date+90,current_date+90)",[E,OP,NF])
      await db.query('COMMIT');save()
    }catch(e){await db.query('ROLLBACK');throw e}
  }
  async function login(name){const a=actors[name];const c=createClient(d.SUPABASE_URL,d.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});clients.push(c);val(await c.auth.signInWithPassword({email:a.email,password:a.password}));const f=val(await c.auth.mfa.enroll({factorType:'totp',friendlyName:'Notifications R4 QA'}));const ch=val(await c.auth.mfa.challenge({factorId:f.id}));val(await c.auth.mfa.verify({factorId:f.id,challengeId:ch.id,code:totp(f.totp.secret)}));val(await c.rpc('registrar_sessao_mfa_atual',{p_factor_id:f.id}));assert.equal(val(await c.rpc('obter_sessao_mfa_atual'))[0].status,'valid');a.client=c;return c}
  async function notify(entity,entityId,role,title,type='operacao_aprovada'){return val(await admin.rpc('notificar_entidade',{p_entidade_tipo:entity,p_entidade_id:entityId,p_destino:role,p_titulo:title,p_mensagem:'QA R4 '+run,p_tipo:type,p_dedupe_key:run+':'+title,p_usuario_id:null,p_somente_admin:false}))}
  async function cleanup(){
    for(const c of clients)if(val(await c.auth.getSession()).session)val(await c.auth.signOut({scope:'global'}))
    const tables=(await db.query("SELECT table_schema,table_name,array_agg(column_name::text ORDER BY ordinal_position) FILTER(WHERE udt_name='uuid') AS uuids FROM information_schema.columns c WHERE table_schema IN ('public','private') AND EXISTS(SELECT 1 FROM pg_tables t WHERE t.schemaname=c.table_schema AND t.tablename=c.table_name) GROUP BY 1,2 ORDER BY 1,2")).rows
    const snapshots=[]
    for(let pass=0;pass<8;pass++){
      const oldSize=owned.size;snapshots.length=0
      const candidates=tables.filter(t=>t.uuids?.length)
      const found=(await db.query(candidates.map((t,i)=>{
        assert(Array.isArray(t.uuids),'UUID_COLUMN_METADATA_INVALID')
        const name=ident(t.table_schema)+'.'+ident(t.table_name),where=t.uuids.map(c=>`${ident(c)}=ANY($1::uuid[])`).join(' OR ')
        return `SELECT ${i} position,ctid::text tid,to_jsonb(t) row FROM ${name} t WHERE ${where}`
      }).join(' UNION ALL '),[[...owned]])).rows
      for(const [i,t] of candidates.entries()){
        const name=ident(t.table_schema)+'.'+ident(t.table_name),rows=found.filter(r=>r.position===i)
        if(rows.length)snapshots.push({name,rows})
        for(const r of rows)if(typeof r.row.id==='string'&&/^[a-f0-9-]{36}$/.test(r.row.id))owned.add(r.row.id)
      }
      if(owned.size===oldSize)break
      assert(pass<7,'QA_GRAPH_DID_NOT_CONVERGE')
    }
    save()
    // Before deleting, prove every excluded row is QA and all remaining rows
    // are exactly the pre-smoke baseline (including audit and fiscal Storage).
    const nonQa=(await db.query(before.map(t=>{const [s,n]=t.name.split('.'),meta=tables.find(x=>x.table_schema===s&&x.table_name===n);const where=meta?.uuids?.length?'NOT ('+meta.uuids.map(c=>`coalesce(${ident(c)}=ANY($1::uuid[]),false)`).join(' OR ')+')':'true'
      return `SELECT '${t.name}' name,count(*)::int count,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) hash FROM ${ident(s)}.${ident(n)} t WHERE ${where}`
    }).join(' UNION ALL '),[[...owned]])).rows.sort((a,b)=>a.name.localeCompare(b.name))
    assert.deepEqual(await normalizeWebhooks(db,nonQa,concurrency),before,'PREEXISTING_DATA_DRIFT_BEFORE_QA_CLEANUP')
    await db.query('BEGIN')
    try{
      await db.query("SET LOCAL session_replication_role='replica'")
      for(const t of snapshots){const result=await db.query(`DELETE FROM ${t.name} t USING jsonb_to_recordset($1::jsonb) AS q(tid text,row jsonb) WHERE t.ctid=q.tid::tid AND to_jsonb(t)=q.row`,[JSON.stringify(t.rows)]);assert.equal(result.rowCount,t.rows.length,'QA_ROW_CHANGED')}
      await db.query("SET LOCAL session_replication_role='origin'")
      assert.deepEqual(await fingerprints(db,{concurrency}),before,'QA_CLEANUP_INTEGRITY_FAILED')
      await db.query('COMMIT')
    }catch(e){await db.query('ROLLBACK');throw e}
    for(const a of Object.values(actors)){const exists=(await db.query('SELECT email FROM auth.users WHERE id=$1',[a.id])).rows[0];if(exists){assert.equal(exists.email,a.email.toLowerCase());val(await admin.auth.admin.deleteUser(a.id))}}
    const counts={}
    for(const [table,column] of [['auth.users','id'],['auth.sessions','user_id'],['auth.mfa_factors','user_id']])counts[table]=Number((await db.query(`SELECT count(*) FROM ${table} WHERE ${column}=ANY($1::uuid[])`,[[...owned]])).rows[0].count)
    assert(Object.values(counts).every(n=>n===0));manifest.cleanup.push(counts);save()
  }
  return {run,actors,admin,owned,id,A,B,C,CF,CFB,NF,NFB,OP,E,seed,login,notify,cleanup,manifest}
}
