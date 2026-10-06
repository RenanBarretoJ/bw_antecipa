// Explicit local-only migration list. Both clean-room and upgrade roll back.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import pg from 'pg'

assert.equal(process.argv.length, 2)
const inspect = spawnSync('docker', ['inspect', 'supabase_db_notificacoes-r1-20261005', '--format', '{{index .Config.Labels "com.supabase.cli.project"}}'], { encoding: 'utf8', windowsHide: true })
assert.equal(inspect.status, 0)
assert.equal(inspect.stdout.trim(), 'notificacoes-r1-20261005')
const db = new pg.Client({ host: '127.0.0.1', port: 59422, user: 'postgres', password: 'postgres', database: 'postgres' })
const files = ['20261005213812_notificacoes_fund_scope.sql','20261006114841_notificacoes_shared_cedente_producers.sql','20261006124134_notificacoes_entity_producers.sql','20261006130657_notificacoes_scoped_ui.sql']
const migrations = files.map(file => ({ file, sql: readFileSync(`supabase/migrations/${file}`, 'utf8') }))
const fixture = readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql', 'utf8')
const id = (prefix,n=1) => `${prefix}000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const A=id('22'), B=id('22',2), CF=id('24'), CFB=id('24',2), NF=id('2a'), OP=id('2c'), E=id('2d')
const G=id('21',4), GB=id('21',6), S=id('21',7), SB=id('21',8), SX=id('21',9), C=id('21',3)
let checks=0
async function test(fn) { await fn(); checks++ }
async function scalar(sql,args=[]) { return Object.values((await db.query(sql,args)).rows[0])[0] }
async function denied(sql,args,code) {
  await db.query('SAVEPOINT denied')
  let error
  try { await db.query(sql,args) } catch(e) { error=e }
  await db.query('ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied')
  assert.equal(error?.code,code,error?.message ?? 'Expected rejection')
}
async function setup() {
  await db.query(fixture)
  await db.query(`INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
    VALUES($1,'QA B','98000000000439','QA','98000000000277','QA','98000000000358',true)`,[B])
  await db.query('INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id) VALUES($1,$2,$3)',[CFB,id('23'),B])
  for(const [u,role] of [[GB,'gestor'],[S,'sacado'],[SB,'sacado'],[SX,'sacado']]) {
    await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,'{}')",[u,`qa-${u}@example.invalid`])
    await db.query("UPDATE public.profiles SET role=$2,status='ativo' WHERE id=$1",[u,role])
  }
  await db.query('INSERT INTO public.usuario_fundos(usuario_id,fundo_id) VALUES($1,$2),($3,$2)',[GB,B,G])
  await db.query(`INSERT INTO public.sacados(id,cnpj,razao_social) VALUES($1,'11222333000181','QA exact CNPJ'),($2,'11222333000262','QA same root other CNPJ')`,[id('2b'),id('2b',2)])
  await db.query(`INSERT INTO public.sacado_acessos(user_id,sacado_id,fundo_id) VALUES($1,$2,$3),($4,$2,$5),($6,$7,$3)`,[S,id('2b'),A,SB,B,SX,id('2b',2)])
  await db.query(`INSERT INTO public.operacoes(id,cedente_id,cedente_fundo_id,valor_bruto_total,prazo_dias,data_vencimento,aceite_sacado_exigido,aceite_sacado_status)
    VALUES($1,$2,$3,1000,30,current_date+30,true,'pendente')`,[OP,id('23'),CF])
  await db.query('INSERT INTO public.operacoes_nfs(operacao_id,nota_fiscal_id) VALUES($1,$2)',[OP,NF])
  await db.query(`INSERT INTO public.nota_fiscal_entregas(id,operacao_id,nota_fiscal_id,status_entrega,data_limite_cte,data_limite_canhoto)
    VALUES($1,$2,$3,'em_transito',current_date,current_date)`,[E,OP,NF])
}
const sendSql='SELECT * FROM public.notificar_entidade($1,$2,$3,$4,$5,$6,$7,$8,$9)'
async function send(entity,entityId,role,type,key=type,user=null,admin=false) {
  return (await db.query(sendSql,[entity,entityId,role,'QA title','QA message',type,key,user,admin])).rows
}
const evidence=[]
await db.connect()
try {
  for(const mode of ['fresh','upgrade']) {
    const start=checks
    await db.query('BEGIN')
    try {
      await db.query("SET LOCAL statement_timeout='20s'")
      await setup()
      if(mode==='upgrade')await db.query("INSERT INTO public.notificacoes(usuario_id,titulo,mensagem,tipo) VALUES($1,'Historic QA','Unscoped','info')",[G])
      await db.query(migrations[0].sql)
      const before=(await db.query('SELECT * FROM public.notificacoes ORDER BY id')).rows
      for(const m of migrations.slice(1))await db.query(m.sql)
      await test(async()=>assert.deepEqual((await db.query('SELECT * FROM public.notificacoes ORDER BY id')).rows,before))
      await db.query('SAVEPOINT ui_tap')
      await db.query("CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions; SET LOCAL search_path=public,extensions; DELETE FROM public.notificacoes")
      const tapResults = await db.query(readFileSync('supabase/tests/notificacoes_ui_scope.sql','utf8'))
      const tap = tapResults.flatMap(result=>result.rows.flatMap(row=>Object.values(row))).filter(value=>typeof value==='string')
      assert.deepEqual(tap.filter(line=>/^not ok|^# Looks like/.test(line)),[])
      const tapChecks=tap.filter(line=>/^ok \d+/.test(line)).length
      assert(tapChecks>=38,'Missing UI pgTAP checks')
      checks+=tapChecks
      await db.query('ROLLBACK TO SAVEPOINT ui_tap; RELEASE SAVEPOINT ui_tap')
      for(const signature of ['notificar_entidade(text,uuid,text,text,text,text,text,uuid,boolean)','notificar_cedente_cadastro(uuid,text,text,text,text,boolean)','notificar_seguranca_global(uuid,text,text,text,text)']) {
        for(const role of ['anon','authenticated']) await test(async()=>assert.equal(await scalar('SELECT has_function_privilege($1,$2,\'EXECUTE\')',[role,`public.${signature}`]),false))
        await test(async()=>assert.equal(await scalar('SELECT has_function_privilege(\'service_role\',$1,\'EXECUTE\')',[`public.${signature}`]),true))
      }
      // Every application event family uses this exact persisted-entity boundary.
      for(const [entity,entityId,role,types] of [
        ['nota_fiscal',NF,'gestor',['nf_submetida','pagamento_informado','info']],
        ['nota_fiscal',NF,'cedente',['nf_aprovada','nf_reprovada','nf_ajuste_solicitado','boleto_parcela_aprovado','boleto_parcela_rejeitado','boleto_parcela_requer_ajuste']],
        ['operacao',OP,'gestor',['operacao_solicitada','operacao_disponivel_analise','alerta_vencimento_gestor','inadimplencia_urgente']],
        ['operacao',OP,'cedente',['operacao_encaminhada_gestor','operacao_desembolsada','operacao_reprovada','operacao_cancelada','nf_removida_operacao','operacao_liquidada','operacao_inadimplente','alerta_vencimento','alerta_vencimento_urgente','cessao_efetivada']],
        ['operacao',OP,'sacado',['cessao_credito','alerta_vencimento']],
        ['entrega',E,'gestor',['canhoto_enviado']],
        ['cedente_fundo',CF,'gestor',['cte_enviado']],
        ['entrega',E,'cedente',['cte_vencido','cte_prazo_proximo','canhoto_vencido','canhoto_prazo_proximo']],
        ['nota_fiscal',NF,'cedente',['cessao_aceita','cessao_contestada']],
        ['nota_fiscal',NF,'gestor',['cessao_aceita','cessao_contestada']],
      ])for(const type of types)await test(async()=>{
        const key=`${entity}:${role}:${type}`
        const created=await send(entity,entityId,role,type,key)
        assert.equal(created.length,1,`${entity}/${role}/${type}`)
        assert.equal(created[0].usuario_id,role==='gestor'?G:role==='cedente'?C:S)
        const row=(await db.query('SELECT * FROM public.notificacoes WHERE id=$1',[created[0].notificacao_id])).rows[0]
        assert.equal(row.fundo_id,A);assert.equal(row.cedente_fundo_id,CF);assert.equal(row.scope_type,'FUNDO')
        assert.equal(row.entidade_id,entityId);assert.equal(row.entidade_tipo,entity)
        assert.equal(row.href,`/notificacoes/abrir/${row.id}?fundo=${A}`)
        assert.equal(row.dedupe_key,`fund:${A}:${key}:user:${row.usuario_id}`)
        assert.equal((await send(entity,entityId,role,type,key)).length,0,'duplicate retry')
      })
      await test(async()=>assert.equal(await scalar('SELECT count(*)::int FROM public.notificacoes WHERE usuario_id=ANY($1::uuid[])',[ [GB,SB,SX] ]),0))
      for(const wrong of [SB,SX])await test(()=>denied(sendSql,['nota_fiscal',NF,'sacado','QA','QA','cessao_credito','negative',wrong,false],'42501'))
      await test(()=>denied(sendSql,['nota_fiscal',id('2a',999),'gestor','QA','QA','nf_submetida','negative',null,false],'23514'))
      await test(()=>denied("SELECT private.notificar_cedente_ativos($1,'QA','QA','nf_aprovada','old')",[id('23')],'23514'))
      await test(async()=>assert.equal((await send('nota_fiscal',NF,'consultor','info','consultor')).length,2,'active operator and reader'))
      await db.query("UPDATE public.consultor_cedentes SET status='inativo' WHERE cedente_id=$1",[id('23')])
      await test(()=>denied(sendSql,['nota_fiscal',NF,'consultor','QA','QA','info','consultor-denied',id('21'),false],'42501'))
      await db.query("UPDATE public.consultor_cedentes SET status='ativo' WHERE cedente_id=$1",[id('23')])
      await test(async()=>{
        const a=await send('cedente_fundo',CF,'cedente','nf_aprovada','same-logical-event')
        const b=await send('cedente_fundo',CFB,'cedente','nf_aprovada','same-logical-event')
        assert.equal(a.length,1);assert.equal(b.length,1);assert.notEqual(a[0].notificacao_id,b[0].notificacao_id)
      })
      for(const type of ['cadastro_aprovado','cadastro_reprovado','documento_aprovado','documento_reprovado','alteracao_cadastral_aprovada','alteracao_cadastral_reprovada','documento_atualizacao_solicitada','estabelecimento_pendencia_pos_aprovacao','documento_estabelecimento_aprovado','documento_estabelecimento_rejeitado','documento_estabelecimento_requer_ajuste'])await test(async()=>{
        const args=[id('23'),'QA','QA',type,`shared:${type}`]
        assert.equal((await db.query('SELECT * FROM public.notificar_cedente_cadastro($1,$2,$3,$4,$5)',args)).rows.length,2)
        assert.equal((await db.query('SELECT * FROM public.notificar_cedente_cadastro($1,$2,$3,$4,$5)',args)).rows.length,0)
      })
      await test(()=>denied("SELECT public.notificar_seguranca_global($1,'QA','QA','nf_aprovada','x')",[G],'22023'))
      for(const type of ['seguranca_senha_alterada','mfa_reset_administrativo'])await test(async()=>{
        const notification=await scalar("SELECT public.notificar_seguranca_global($1,'QA','QA',$2,'event')",[G,type])
        const row=(await db.query('SELECT * FROM public.notificacoes WHERE id=$1',[notification])).rows[0]
        assert.equal(row.scope_type,'GLOBAL');assert.equal(row.fundo_id,null)
      })
      // Exercise the real logistics cron, not only its delegated helper.
      await test(async()=>{
        const result=await scalar('SELECT public.processar_prazos_entrega(current_date)')
        assert.equal(result.cte_alertas,1);assert.equal(result.canhoto_alertas,1)
        assert.equal(await scalar("SELECT count(*)::int FROM public.notificacoes WHERE tipo IN ('cte_vencido','canhoto_vencido') AND dedupe_key LIKE $2 AND fundo_id=$1",[A,`fund:${A}:entrega:${E}:%`]),2)
      })
      for(const action of ['aceitar','contestar'])await test(async()=>{
        await db.query('SAVEPOINT real_acceptance')
        try {
          await db.query("UPDATE public.operacoes SET status='solicitada',aceite_sacado_status='pendente' WHERE id=$1",[OP])
          await db.query("UPDATE public.notas_fiscais SET status='em_antecipacao' WHERE id=$1",[NF])
          await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:S,role:'authenticated',aal:'aal2'})])
          await db.query('SET LOCAL ROLE authenticated')
          await db.query('SELECT public.processar_aceite_sacado($1::uuid[],$2,$3)',[[NF],action,action==='contestar'?'QA contestation':null])
          await db.query('RESET ROLE')
          const rows=(await db.query('SELECT usuario_id,fundo_id,scope_type FROM public.notificacoes WHERE dedupe_key LIKE $1',[`fund:${A}:operacao:${OP}:nf:${NF}:${action}:%`])).rows
          assert.equal(rows.length,2)
          assert.deepEqual(rows.map(r=>r.usuario_id).sort(),[C,G].sort())
          assert(rows.every(r=>r.fundo_id===A&&r.scope_type==='FUNDO'))
        } finally {await db.query('ROLLBACK TO SAVEPOINT real_acceptance; RELEASE SAVEPOINT real_acceptance')}
      })
      const catalog=(await db.query(`SELECT n.nspname,p.proname,p.pronargs,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname IN ('public','private') AND p.prokind='f'`)).rows
      await test(()=>assert.equal(catalog.filter(p=>/INSERT\s+INTO\s+public\.notificacoes/i.test(p.prosrc)&&/FROM\s+public\.profiles\s+\w+\s+WHERE\s+\w+\.role\s*=\s*'gestor'/i.test(p.prosrc)).length,0))
      await test(()=>assert.equal(catalog.filter(p=>p.proname!=='notificar_cedente_ativos'&&/private\.notificar_cedente_ativos\(/.test(p.prosrc)).length,0))
      await test(()=>assert.deepEqual(catalog.filter(p=>/INSERT\s+INTO\s+public\.notificacoes/i.test(p.prosrc)).map(p=>p.proname).sort(),['criar_notificacao_fundo','notificar_seguranca_global']))
      evidence.push({mode,checks:checks-start,pass:true,historicalRowsUnchanged:true,globalGestorInserts:0})
    } finally {await db.query('ROLLBACK')}
  }
  const report={at:new Date().toISOString(),target:'127.0.0.1:59422',checks,evidence,migrations:migrations.map(m=>({file:m.file,sha256:createHash('sha256').update(m.sql).digest('hex')})),allChangesRolledBack:true}
  writeFileSync('rehearsal/reports/NOTIFICACOES_PRODUCERS_TEST.json',JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report))
} finally {await db.end()}
