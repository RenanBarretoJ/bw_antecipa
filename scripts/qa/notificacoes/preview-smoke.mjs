// Real Auth/MFA and UI. Disposable synthetic fixtures, exact Preview, double cleanup.
import assert from 'node:assert/strict'
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs'
import { randomUUID,randomBytes,createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { details,connect,empty,ref,base } from './preview-runtime.mjs'
import {keyboardCycle,keyboardOpen,keyboardClose,rememberFocus,unchangedFocus} from './focus-keyboard.mjs'
assert.equal(process.argv.length,2)
const require=createRequire(import.meta.url),d=details(),db=await connect(d)
const admin=createClient(d.SUPABASE_URL,d.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const run=randomUUID(),map=new Map(),actors={},clients=[],owned=new Set(),checks=[],screens=[]
const out='rehearsal/reports/notificacoes-preview';mkdirSync(out,{recursive:true})
const sha=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).stdout.trim()
const report={target:ref,sha,run,success:false,checks,screens,cleanup:false,cleanupRuns:[]}
const old=(p,n=1)=>`${p}000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function id(p,n=1){const key=old(p,n);if(!map.has(key))map.set(key,randomUUID());const v=map.get(key);owned.add(v);return v}
const A=id('22'),B=id('22',2),C=id('22',3),CF=id('24'),CFB=id('24',2),NF=id('2a'),NFB=id('2a',5),OP=id('2c'),E=id('2d')
const val=r=>{assert(!r.error,r.error?.message||'REQUEST_FAILED');return r.data}
const log=phase=>console.log(JSON.stringify({phase,run}))
function totp(secret){const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');const ctr=Buffer.alloc(8);ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)))).update(ctr).digest();return String((h.readUInt32BE(h[19]&15)&0x7fffffff)%1000000).padStart(6,'0')}
async function login(a){
  const c=createClient(d.SUPABASE_URL,d.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});clients.push(c)
  val(await c.auth.signInWithPassword({email:a.email,password:a.password}))
  const f=val(await c.auth.mfa.enroll({factorType:'totp',friendlyName:'Notification QA'}))
  const challenge=val(await c.auth.mfa.challenge({factorId:f.id}))
  val(await c.auth.mfa.verify({factorId:f.id,challengeId:challenge.id,code:totp(f.totp.secret)}))
  val(await c.rpc('registrar_sessao_mfa_atual',{p_factor_id:f.id}))
  assert.equal(val(await c.rpc('obter_sessao_mfa_atual'))[0].status,'valid')
  return c
}
async function notify(entity,entityId,role,title,key=title,type='operacao_aprovada'){return val(await admin.rpc('notificar_entidade',{p_entidade_tipo:entity,p_entidade_id:entityId,p_destino:role,p_titulo:title,p_mensagem:'Evento sintetico de QA '+run,p_tipo:type,p_dedupe_key:run+':'+key,p_usuario_id:null,p_somente_admin:false}))}
async function seed(){
  for(const [name,p,n,role] of [['consultor','21',1,'consultor'],['leitor','21',2,'consultor'],['cedente','21',3,'cedente'],['gestor','21',4,'gestor'],['sacado','21',5,'sacado'],['gestorB','21',6,'gestor']]){
    const email=`notif-${name}-${run}@example.invalid`,password=randomBytes(24).toString('base64url')+'!aA9'
    const u=val(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{nome_completo:'QA '+name}})).user
    map.set(old(p,n),u.id);owned.add(u.id);actors[name]={id:u.id,email,password,role}
  }
  let fixture=readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql','utf8').replaceAll('\r\n','\n')
  fixture=fixture.replace(/  INSERT INTO auth\.users[\s\S]*?\n\n  INSERT INTO public\.profiles/,'  INSERT INTO public.profiles')
  assert(!fixture.includes('INSERT INTO auth.users'),'AUTH_MUST_USE_REAL_API')
  for(const key of fixture.match(/[a-f0-9]{8}-[a-f0-9-]{27}/g)||[]){if(!map.has(key)){map.set(key,randomUUID());owned.add(map.get(key))}}
  for(const [a,b] of map)fixture=fixture.replaceAll(a,b)
  await db.query('BEGIN')
  try{
    await db.query(fixture)
    for(const a of Object.values(actors))await db.query("UPDATE public.profiles SET nome_completo=$2,email=$3,role=$4,status='ativo',senha_alterada_em=now() WHERE id=$1",[a.id,'QA '+a.role,a.email,a.role])
    await db.query("UPDATE public.fundos SET nome='QA Notificacoes A' WHERE id=$1",[A])
    for(const [f,name,cnpj] of [[B,'B','98000000000439'],[C,'C','98000000000510']])await db.query("INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo) VALUES($1,$2,$3,'QA','98000000000277','QA','98000000000358',true)",[f,'QA Notificacoes '+name,cnpj])
    await db.query('INSERT INTO public.usuario_fundos(usuario_id,fundo_id) VALUES($1,$2),($3,$2)',[actors.gestor.id,B,actors.gestorB.id])
    await db.query('INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id) VALUES($1,$2,$3)',[CFB,id('23'),B])
    await db.query('INSERT INTO public.consultor_fundos(consultor_id,fundo_id,concedido_por) VALUES($1,$2,$3)',[id('29'),B,actors.gestor.id])
    await db.query("INSERT INTO public.sacados(id,cnpj,razao_social) VALUES($1,'11222333000181','QA Sacado')",[id('2b')])
    await db.query('INSERT INTO public.sacado_acessos(user_id,sacado_id,fundo_id) VALUES($1,$2,$3),($1,$2,$4)',[actors.sacado.id,id('2b'),A,B])
    await db.query(`INSERT INTO public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,status)
      SELECT $1,cedente_id,$2,$3,'QA-B','1',data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,status FROM public.notas_fiscais WHERE id=$4`,[NFB,CFB,B,NF])
    await db.query(`INSERT INTO public.operacoes(id,cedente_id,cedente_fundo_id,valor_bruto_total,prazo_dias,data_vencimento,aceite_sacado_exigido,aceite_sacado_status) VALUES($1,$2,$3,1000,30,current_date+30,true,'pendente')`,[OP,id('23'),CF])
    await db.query('INSERT INTO public.operacoes_nfs(operacao_id,nota_fiscal_id) VALUES($1,$2)',[OP,NF])
    await db.query("INSERT INTO public.nota_fiscal_entregas(id,operacao_id,nota_fiscal_id,status_entrega,data_limite_cte,data_limite_canhoto) VALUES($1,$2,$3,'em_transito',current_date,current_date)",[E,OP,NF])
    await db.query('COMMIT')
  }catch(e){await db.query('ROLLBACK');throw e}
}
let browser
async function cleanup(){
  await browser?.close().catch(()=>{});browser=null
  for(const c of clients)await c.auth.signOut({scope:'global'}).catch(()=>{})
  const users=(await db.query('SELECT id,email FROM auth.users')).rows
  assert(users.every(u=>owned.has(u.id)&&u.email.endsWith('@example.invalid')),'NON_QA_AUTH_USER_STOP')
  const tables=(await db.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','private') ORDER BY 1,2")).rows
  const snapshots=[]
  for(const t of tables){const name=`"${t.schemaname}"."${t.tablename}"`;const rows=(await db.query(`SELECT ctid::text AS tid,to_jsonb(t) AS row FROM ${name} t`)).rows;if(rows.length)snapshots.push({name,rows})}
  // Every row must be connected to explicitly owned fixture/user UUIDs. Discover
  // generated QA children transitively; an unrelated row aborts cleanup.
  const pending=snapshots.flatMap(t=>t.rows)
  for(let pass=0;pass<10&&pending.length;pass++)for(let i=pending.length-1;i>=0;i--){const ids=JSON.stringify(pending[i].row).match(/[a-f0-9]{8}-[a-f0-9-]{27}/g)||[];if(ids.some(x=>owned.has(x))){ids.forEach(x=>owned.add(x));pending.splice(i,1)}}
  assert.equal(pending.length,0,'UNOWNED_QA_ROW_STOP')
  await db.query('BEGIN')
  try{
    // Only cleanup bypasses immutable QA audit triggers; not Auth/RLS evidence.
    await db.query("SET LOCAL session_replication_role='replica'")
    for(const t of snapshots)for(const r of t.rows)await db.query(`DELETE FROM ${t.name} t WHERE ctid=$1::tid AND to_jsonb(t)=$2::jsonb`,[r.tid,JSON.stringify(r.row)])
    await db.query("SET LOCAL session_replication_role='origin'; COMMIT")
  }catch(e){await db.query('ROLLBACK');throw e}
  for(const a of users)val(await admin.auth.admin.deleteUser(a.id))
  await empty(db)
  const counts={}
  for(const table of ['auth.users','auth.sessions','auth.mfa_factors','storage.objects']){
    counts[table]=Number((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count)
    assert.equal(counts[table],0,'QA_AUTH_OR_STORAGE_REMAINING')
  }
  report.cleanupRuns.push(counts)
  report.cleanup=report.cleanupRuns.length===2
}
try{
  const historyBefore=(await db.query('SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version')).rows
  report.historyBefore=historyBefore.map(r=>({version:r.version,name:r.name}))
  await empty(db);log('seed');await seed();log('auth')
  for(const name of ['gestor','cedente','sacado','consultor'])actors[name].client=await login(actors[name])
  checks.push('4 real Auth sessions and MFA valid')
  for(const role of ['gestor','cedente','sacado','consultor']){
    await notify('nota_fiscal',NF,role,'A1');await notify('nota_fiscal',NF,role,'A2');await notify('nota_fiscal',NFB,role,'B1')
    assert.equal((await notify('nota_fiscal',NF,role,'A1')).length,0,'DEDUPE_FAILED')
    const c=actors[role].client
    const funds=val(await c.rpc('listar_fundos_notificacoes'));assert.deepEqual(funds.map(f=>f.id).sort(),[A,B].sort())
    for(const [f,n] of [[A,2],[B,1]])assert.equal(val(await c.rpc('contar_notificacoes',{p_scope:'FUNDO',p_fundo_id:f}))[0].nao_lidas,n)
    assert((await c.rpc('listar_notificacoes',{p_scope:'FUNDO',p_fundo_id:C})).error,'C_LIST_ALLOWED')
    assert((await c.rpc('marcar_notificacoes_lidas',{p_scope:'FUNDO',p_fundo_id:C})).error,'C_MARK_ALLOWED')
    const b=val(await c.rpc('listar_notificacoes',{p_scope:'FUNDO',p_fundo_id:B}))[0]
    assert((await c.rpc('obter_destino_notificacao',{p_id:b.id,p_scope:'FUNDO',p_fundo_id:A})).error,'CROSS_FUND_HREF_ALLOWED')
    assert((await c.rpc('marcar_notificacoes_lidas',{p_id:b.id,p_scope:'FUNDO',p_fundo_id:A})).error,'CROSS_FUND_MARK_ALLOWED')
    checks.push(role+':fund matrix, badge, dedupe and RLS negatives')
  }
  assert.equal(Number((await db.query('SELECT count(*) FROM public.notificacoes WHERE usuario_id=$1 AND fundo_id=$2',[actors.gestorB.id,A])).rows[0].count),0)
  log('browser')
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
  for(const role of ['gestor','cedente','sacado','consultor']){
    const context=await browser.createBrowserContext(),c=actors[role].client,session=val(await c.auth.getSession()).session
    const chunks=('base64-'+Buffer.from(JSON.stringify(session)).toString('base64url')).match(/.{1,3180}/g),domain=new URL(base).hostname
    const cookie=(name,value)=>({name,value,domain,path:'/',secure:true,sameSite:'Lax'})
    await context.setCookie(...chunks.map((v,i)=>cookie(`sb-${ref}-auth-token${chunks.length===1?'':'.'+i}`,v)),cookie('bw_fundo_ativo_id',A),cookie('bw_cedente_fundo_ativo_id',CF),cookie('bw_notificacoes_fundo_id',A))
    const page=await context.newPage();await page.setViewport({width:1440,height:1000})
    const r=await page.goto(base+`/${role}/notificacoes`,{waitUntil:'domcontentloaded',timeout:60000})
    assert(r.status()<400,'PREVIEW_HTTP_ERROR');assert.equal(new URL(page.url()).pathname,`/${role}/notificacoes`,'AUTH_REDIRECT')
    assert((r.headers()['content-security-policy']||'').includes(ref+'.supabase.co'),'WRONG_DEPLOYMENT_DB')
    assert(!/wwsndnuvnjuabpbjwlck|fhgkmggthxikfpogrvaa/.test(r.headers()['content-security-policy']||''),'FORBIDDEN_HOST_IN_CSP')
    await page.waitForFunction(()=>document.body.innerText.includes('2 não lidas neste contexto'),{timeout:30000})
    let text=await page.evaluate(()=>document.body.innerText);assert(text.includes('A1')&&text.includes('A2')&&!text.includes('B1'))
    const aNotice=val(await c.rpc('listar_notificacoes',{p_scope:'FUNDO',p_fundo_id:A}))[0]
    const bNotice=val(await c.rpc('listar_notificacoes',{p_scope:'FUNDO',p_fundo_id:B}))[0]
    const cookies=(await context.cookies()).map(c=>c.name+'='+c.value).join('; ')
    const good=await fetch(`${base}/notificacoes/abrir/${aNotice.id}?scope=FUNDO&fundo=${A}`,{headers:{cookie:cookies},redirect:'manual'})
    assert.equal(good.status,303,'OWN_FUND_HREF_DENIED')
    assert(good.headers.get('location').includes(A),'HREF_LOST_FUND')
    const bad=await fetch(`${base}/notificacoes/abrir/${bNotice.id}?scope=FUNDO&fundo=${B}`,{headers:{cookie:cookies},redirect:'manual'})
    assert.equal(bad.status,403,'CANONICAL_CONTEXT_HREF_BYPASSED')
    const detail=await context.newPage();const dr=await detail.goto(good.headers.get('location'),{waitUntil:'domcontentloaded'});assert.equal(dr.status(),200)
    assert(!(await detail.evaluate(()=>document.body.innerText)).includes('Acesso não permitido'),'ORIGIN_ENTITY_DENIED');await detail.close()
    checks.push(role+':server href rechecks canonical fund and opens own origin')
    await page.bringToFront()
    await keyboardCycle(page,{negative:true})
    await keyboardOpen(page);await rememberFocus(page)
    await notify('nota_fiscal',NFB,role,'B-realtime')
    await notify('nota_fiscal',NF,role,'A-realtime')
    await page.waitForFunction(()=>document.body.innerText.includes('A-realtime'),{timeout:20000})
    assert(!(await page.evaluate(()=>document.body.innerText)).includes('B-realtime'))
    await unchangedFocus(page)
    await keyboardClose(page)
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Marcar todas como lidas').click())
    await page.waitForFunction(()=>document.body.innerText.includes('0 não lidas neste contexto'),{timeout:15000})
    assert.equal(val(await c.rpc('contar_notificacoes',{p_scope:'FUNDO',p_fundo_id:B}))[0].nao_lidas,2)
    if(role==='gestor'){
      await page.click('[aria-controls="fundo-ativo-dropdown"]')
      await page.evaluate(()=>[...document.querySelectorAll('#fundo-ativo-dropdown button')].find(b=>b.textContent.includes('QA Notificacoes B')).click())
      await page.waitForFunction(()=>location.pathname==='/gestor/dashboard',{timeout:30000})
      await page.goto(base+'/gestor/notificacoes',{waitUntil:'domcontentloaded'})
    }else if(role==='cedente')await page.select('select[aria-label="Fundo operacional do cedente"]',CFB)
    else await page.select('select[aria-label="Fundo das notificações"]',B)
    await page.waitForFunction(()=>document.body.innerText.includes('B-realtime'),{timeout:30000})
    text=await page.evaluate(()=>document.body.innerText);assert(!text.includes('A-realtime')&&text.includes('B1'))
    checks.push(role+':live UI badge/list/mark-all/realtime/switch')
    await keyboardCycle(page)
    checks.push(role+':keyboard A/B, realtime focus, trigger stability and negative escape')
    await page.screenshot({path:`${out}/${role}-B.png`,fullPage:true})
    if(role==='consultor'){
      for(let i=0;i<23;i++)await notify('nota_fiscal',NFB,role,'Pagina-'+i)
      await notify('nota_fiscal',NFB,role,'Documento QA','documento','nf_aprovada')
      await notify('nota_fiscal',NFB,role,'Logistica QA','logistica','cte_enviado')
      await notify('nota_fiscal',NFB,role,'Integracao QA','integracao','integracao_alerta')
      await notify('nota_fiscal',NFB,role,'Alerta QA','alerta','alerta_prazo')
      await page.reload({waitUntil:'domcontentloaded'})
      await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Lista de notificações"]>li').length===20,{timeout:20000})
      await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Carregar mais').click())
      await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Lista de notificações"]>li').length===29,{timeout:15000})
      for(const [filter,title] of [['documentos','Documento QA'],['logistica','Logistica QA'],['integracoes','Integracao QA'],['alertas','Alerta QA']]){
        await page.click(`nav[aria-label="Filtros de notificações"] a[href*="filtro=${filter}"]`)
        await page.waitForFunction((f,t)=>document.querySelector('nav[aria-label="Filtros de notificações"] a[aria-current="page"]')?.getAttribute('href').includes('filtro='+f)&&document.querySelector('[aria-label="Lista de notificações"]')?.getAttribute('aria-busy')==='false'&&document.querySelector('[aria-label="Lista de notificações"]')?.textContent.includes(t),{timeout:20000},filter,title)
        assert(!(await page.$eval('[aria-label="Lista de notificações"]',e=>e.textContent)).includes('Pagina-'))
      }
      await page.goto(base+'/consultor/notificacoes?filtro=nao_lidas',{waitUntil:'domcontentloaded'})
      await page.waitForSelector('[aria-label="Lista de notificações"] li button')
      await page.focus('[aria-label="Lista de notificações"] li button');await page.keyboard.press('Enter')
      await page.waitForFunction(()=>document.body.innerText.includes('28 não lidas neste contexto'),{timeout:15000})
      assert(await page.evaluate(()=>Boolean(document.activeElement?.closest('[data-notificacao-id]'))),'MARK_UNREAD_FOCUS_LOST')
      await page.goto(base+'/consultor/notificacoes?filtro=lidas',{waitUntil:'domcontentloaded'})
      await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Lista de notificações"]>li').length===1,{timeout:15000})
      checks.push('live filters/keyset pagination/mark one/read filter')
      await page.goto(base+'/consultor/notificacoes',{waitUntil:'domcontentloaded'})
      await page.waitForSelector('button[aria-label^="Notificações,"]')
      await page.waitForFunction(()=>document.querySelector('[aria-label="Lista de notificações"]')?.getAttribute('aria-busy')==='false')
      for(const width of [390,430,820,1440,1920])for(const theme of ['light','dark']){
        await page.setViewport({width,height:1000});await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme)
        const focus=await keyboardCycle(page,{negative:true})
        writeFileSync(`${out}/${width}-${theme}-focus.json`,JSON.stringify(focus,null,2))
        await keyboardOpen(page)
        await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))})
        await page.addScriptTag({content:readFileSync(require.resolve('axe-core/axe.min.js'),'utf8')})
        const violations=await page.evaluate(async()=>{const r=await axe.run({include:[['[aria-labelledby="notificacoes-title"]'],['[role="dialog"]']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});return r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))})
        screens.push({width,theme,violations,keyboard:true,semantics:focus.semantics,negativeEscape:true});assert.deepEqual(violations,[])
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'HORIZONTAL_OVERFLOW')
        const bounds=await page.$eval('[role="dialog"]',e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,bottom:r.bottom}})
        assert(bounds.left>=0&&bounds.right<=width&&bounds.bottom<=1000,'POPOVER_OUTSIDE_VIEWPORT')
        await page.screenshot({path:`${out}/${width}-${theme}.png`,fullPage:true})
        await keyboardClose(page)
      }
    }
    await context.close()
  }
  log('real-producers')
  for(const action of ['aceitar','contestar']) {
    // Synthetic QA operation only; reset its acceptance between independent cases.
    await db.query("UPDATE public.operacoes SET status='solicitada',aceite_sacado_status='pendente' WHERE id=$1",[OP])
    await db.query("UPDATE public.notas_fiscais SET status='em_antecipacao' WHERE id=$1",[NF])
    val(await actors.sacado.client.rpc('processar_aceite_sacado',{p_nota_fiscal_ids:[NF],p_acao:action,p_motivo:action==='contestar'?'Contestacao sintetica QA':null}))
    const rows=(await db.query('SELECT usuario_id,fundo_id,scope_type FROM public.notificacoes WHERE dedupe_key LIKE $1',[`fund:${A}:operacao:${OP}:nf:${NF}:${action}:%`])).rows
    assert.equal(rows.length,2)
    assert.deepEqual(rows.map(r=>r.usuario_id).sort(),[actors.cedente.id,actors.gestor.id].sort())
    assert(rows.every(r=>r.fundo_id===A&&r.scope_type==='FUNDO'))
    checks.push('real Sacado '+action+' producer: exact recipients, no cross-fund')
  }
  await db.query('SELECT public.processar_prazos_entrega(current_date)')
  const events=(await db.query("SELECT tipo,fundo_id,scope_type FROM public.notificacoes WHERE tipo IN ('cessao_aceita','cte_vencido','canhoto_vencido','cte_prazo_proximo','canhoto_prazo_proximo')")).rows
  assert(events.length>=2&&events.every(e=>e.fundo_id===A&&e.scope_type==='FUNDO'))
  checks.push('real delivery deadline producer; no cross-fund')
  // Representative producer boundaries used by shared document/cadastro flows.
  // No real uploads, external provider requests or outbound emails are sent.
  for(const type of ['documento_enviado','alteracao_cadastral']) {
    const args={p_cedente_id:id('23'),p_titulo:'QA '+type,p_mensagem:'Evento QA '+run,p_tipo:type,p_evento_key:run+':'+type}
    assert.equal(val(await admin.rpc('notificar_gestores_cadastro_cedente',args)),3)
    assert.equal(val(await admin.rpc('notificar_gestores_cadastro_cedente',args)),0)
    const rows=(await db.query('SELECT usuario_id,fundo_id,scope_type FROM public.notificacoes WHERE tipo=$1',[type])).rows
    assert.deepEqual(rows.map(r=>r.usuario_id+':'+r.fundo_id).sort(),[actors.gestor.id+':'+A,actors.gestor.id+':'+B,actors.gestorB.id+':'+B].sort())
    assert(rows.every(r=>r.scope_type==='FUNDO'))
    checks.push(type+':real producer RPC, shared A/B explicit rows, C denied, retry deduped')
  }
  await notify('operacao',OP,'gestor','QA technical event','technical','integracao_alerta')
  assert.equal((await notify('operacao',OP,'gestor','QA technical event','technical','integracao_alerta')).length,0)
  const technical=(await db.query("SELECT usuario_id,fundo_id,scope_type FROM public.notificacoes WHERE titulo='QA technical event'")).rows
  assert.equal(technical.length,1);assert.equal(technical[0].usuario_id,actors.gestor.id);assert.equal(technical[0].fundo_id,A)
  checks.push('technical operation-scoped producer RPC: A only, dedupe')
  assert.deepEqual((await db.query('SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version')).rows,historyBefore,'MIGRATION_HISTORY_CHANGED')
  checks.push('migration history unchanged; original A6 absent')
  report.success=true
}catch(e){report.error=String(e.message).slice(0,350);console.log(JSON.stringify({phase:'failure',error:report.error,checks}));process.exitCode=1}
finally{
  try{log('cleanup');await cleanup();await cleanup()}catch(e){report.cleanupError=String(e.message).slice(0,250);process.exitCode=1}
  await db.end();writeFileSync(out+'/result.json',JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report))
}
