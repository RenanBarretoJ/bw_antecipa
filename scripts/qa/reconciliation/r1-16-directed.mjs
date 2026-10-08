import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {actors,cedentes,funds,uid} from './r1-15-rls-fixture.mjs'

async function actor(db,n) {
  const a=actors.find(a=>a.n===n)
  await db.query('SET LOCAL ROLE authenticated')
  await db.query("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",[JSON.stringify({sub:a.id,role:'authenticated',aal:'aal2'}),a.id])
  const p=(await db.query('SELECT current_user AS role,auth.uid()::text AS uid,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]
  assert.equal(p.role,'authenticated');assert.equal(p.uid,a.id);assert.equal(p.rolsuper,false);assert.equal(p.rolbypassrls,false)
  return {id:a.id,domainRole:a.role,funds:a.funds,...p}
}
export async function verifyR116Directed(db) {
  const checks=[]
  const fields=(await db.query("SELECT c.relname AS table_name,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type_name,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_expr FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped AND ((a.attrelid='public.cedentes'::regclass AND a.attname LIKE 'sacado%escrow') OR (a.attrelid IN('public.taxas_cedente'::regclass,'public.consultor_cedente'::regclass) AND a.attname IN('created_at','updated_at'))) ORDER BY 1,2")).rows
  const escrow=fields.filter(f=>f.table_name==='cedentes')
  assert.equal(escrow.length,4)
  for(const f of escrow){assert.equal(f.type_name,'text');assert.equal(f.attnotnull,false);assert.equal(f.default_expr,f.name==='sacado_tipo_conta_escrow'?"'Conta Escrow'::text":null)}
  for(const [table,name] of [['consultor_cedente','created_at'],['taxas_cedente','created_at'],['taxas_cedente','updated_at']]) {
    const f=fields.find(f=>f.table_name===table&&f.name===name);assert(f);assert.equal(f.attnotnull,true);assert.equal(f.default_expr,'now()')
  }
  checks.push({name:'STRUCTURE',fields,result:'PASS'})
  for(const [min,max,rate,expected] of [[0,0,0,null],[0,180,2.35,null],[30,30,1,null],[-1,30,1,'23514'],[30,29,1,'23514'],[0,30,-1,'23514'],[null,30,1,'23502'],[0,null,1,'23502'],[0,30,null,'23502']]) {
    await db.query('BEGIN')
    let proof,code=null
    try {proof=await actor(db,7);await db.query('INSERT INTO public.taxas_cedente(cedente_id,prazo_min,prazo_max,taxa_percentual) VALUES($1,$2,$3,$4)',[cedentes[0].id,min,max,rate])}
    catch(e){code=e.code}
    finally{await db.query('ROLLBACK')}
    assert.equal(code,expected,'TAXAS_CASE:'+JSON.stringify([min,max,rate]));checks.push({name:'TAXAS',actor:proof,min,max,rate,expected,result:code??'ACCEPTED'})
  }
  for(const origin of ['perfil_primario','bootstrap_homolog','bootstrap_producao','administracao','unknown_r116']) {
    await db.query('BEGIN');let code=null
    try {const result=await db.query('UPDATE public.usuario_papeis SET origem=$1 WHERE usuario_id=$2',[origin,uid(1)]);assert.equal(result.rowCount,1,'ORIGIN_FIXTURE_CARDINALITY')}
    catch(e){code=e.code}
    finally{await db.query('ROLLBACK')}
    assert.equal(code,origin==='unknown_r116'?'23514':null,'ORIGIN:'+origin)
    checks.push({name:'ORIGIN_CHECK',origin,result:code??'ACCEPTED',actor:'schema test only; not an authorization claim'})
  }
  const observed=JSON.parse(await readFile('rehearsal/reports/R1_15_DIRECTED_TESTS.json','utf8')).encodingPatterns
  await db.query('BEGIN')
  try {
    const c=cedentes[0],nf=uid(9901),dup=uid(9902),version=uid(9903)
    await db.query("INSERT INTO public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,valor_liquido_origem,status) SELECT $1,c.id,$2,$3,'R116-TEXT','1',current_date,current_date+30,c.cnpj,c.razao_social,'11222333000181','Sacado QA',100,90,'DOCUMENTO_EXPLICITO','rascunho' FROM public.cedentes c WHERE c.id=$4",[nf,uid(c.n+500),funds.A,c.id])
    await db.query('INSERT INTO public.duplicatas(id,fundo_id,cedente_fundo_id,cedente_id,nota_fiscal_id,criado_por) VALUES($1,$2,$3,$4,$5,$6)',[dup,funds.A,uid(c.n+500),c.id,nf,uid(1)])
    await db.query("INSERT INTO public.duplicata_versoes(id,duplicata_id,nota_fiscal_id,numero_versao,path,nome_original,mime_type,tamanho_bytes,sha256,metodo_extracao,enviado_por) VALUES($1,$2,$3,1,'r116/qa.pdf','qa.pdf','application/pdf',100,repeat('a',64),'MANUAL',$4)",[version,dup,nf,uid(1)])
    await db.query('UPDATE public.duplicatas SET versao_atual_id=$1 WHERE id=$2',[version,dup])
    const cases=[['não','NAO'],['nao','NAO'],['sem','NAO'],[' SEM ','NAO'],['sem aceite','NAO'],['sim','SIM'],['aceito','SIM'],['','INDETERMINADO'],[observed.prod[1].literal.slice(1,-1),'NAO'],[observed.cleanroom[1].literal.slice(1,-1),'NAO']]
    for(const [value,expected] of cases) {
      await db.query('SAVEPOINT r116_rpc')
      try {
        const proof=await actor(db,7)
        const row=(await db.query('SELECT * FROM public.corrigir_duplicata($1,$2,$3,$4)',[dup,{aceite_textual:value},'QA R1.16','COERENTE'])).rows[0]
        assert.equal(row.aceite_detectado_textualmente,expected);assert.equal(row.status_validacao,'REVISAR');assert.equal(row.metodo_extracao,'MANUAL')
        const audit=(await db.query("SELECT count(*)::int n FROM public.duplicata_correcoes WHERE duplicata_id=$1 AND campo='aceite_textual'",[dup])).rows[0].n
        assert.equal(audit,1)
        checks.push({name:'CORRIGIR_DUPLICATA',actor:proof,value,expected,result:row.aceite_detectado_textualmente,auditRows:audit})
      } finally {await db.query('ROLLBACK TO SAVEPOINT r116_rpc; RELEASE SAVEPOINT r116_rpc')}
    }
    for(const n of [4,5,6,8,12,15,17]) {
      await db.query('SAVEPOINT r116_denied');let code=null,message='',proof
      try {proof=await actor(db,n);await db.query('SELECT public.corrigir_duplicata($1,$2,$3,$4)',[dup,{aceite_textual:'sim'},'QA denied','COERENTE'])}
      catch(e){code=e.code;message=e.message}
      finally{await db.query('ROLLBACK TO SAVEPOINT r116_denied; RELEASE SAVEPOINT r116_denied')}
      assert.equal(code,'P0001');assert.match(message,/sem permissao/)
      checks.push({name:'CORRIGIR_DUPLICATA_DENIED',actor:proof,result:'DENIED'})
    }
  } finally {await db.query('ROLLBACK')}
  return {result:'PASS',checks,count:checks.length}
}
