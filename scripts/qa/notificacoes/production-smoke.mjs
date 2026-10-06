// R4 production smoke; rehearse this exact QA harness in the isolated Preview first.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import puppeteer from 'puppeteer-core'
import * as preview from './preview-runtime.mjs'
import {productionRef,productionBase,connectProduction,productionKeys,assertSource,out,command,fingerprints} from './production-runtime.mjs'
import {fixtureSession,val} from './production-fixtures.mjs'
import {keyboardCycle,keyboardOpen,keyboardClose,rememberFocus,unchangedFocus} from './focus-keyboard.mjs'
import {clickMarkAllReady,readMarkState,observeActions} from './mark-read-diagnostics.mjs'
const mode=process.argv[2];assert(['--preview-rehearsal','--production'].includes(mode)&&process.argv.length===3)
assertSource()
const prod=mode==='--production',ref=prod?productionRef:preview.ref,base=prod?productionBase:preview.base
const sha=command('git',['rev-parse','HEAD'])
if(prod){const gate=JSON.parse(readFileSync(out+'/deploy.json','utf8'));assert(gate.success&&gate.ref===ref&&gate.sourceEquivalent,'PRODUCTION_DEPLOY_GATE_REQUIRED');assert(JSON.parse(readFileSync(out+'/smoke-preview.json','utf8')).success,'QA_HARNESS_PREVIEW_REQUIRED')}
const d=prod?productionKeys():preview.details(),db=prod?await connectProduction():await preview.connect(d)
const output=out+(prod?'/smoke-production':'/smoke-preview');mkdirSync(output,{recursive:true})
const require=createRequire(import.meta.url),qa=await fixtureSession(db,d,output),checks=[],screens=[]
const {A,B,C,CF,CFB,NF,NFB,OP,E,actors}=qa
const report={at:new Date().toISOString(),ref,base,sha,run:qa.run,success:false,checks,screens,cleanup:[],limitations:['Document/cadastro/logistics/technical producers are exercised through real entity-scoped RPC boundaries, not external uploads or a production-wide deadline cron.','No manual screen-reader audit.']}
let browser
const log=phase=>console.log(JSON.stringify({phase,ref,run:qa.run}))
const count=async(c,f)=>val(await c.rpc('contar_notificacoes',{p_scope:'FUNDO',p_fundo_id:f}))[0].nao_lidas
async function open(c,role,fund,link){
  const context=await browser.createBrowserContext(),session=val(await c.auth.getSession()).session,domain=new URL(base).hostname
  const chunks=('base64-'+Buffer.from(JSON.stringify(session)).toString('base64url')).match(/.{1,3180}/g)
  const cookie=(name,value)=>({name,value,domain,path:'/',secure:true,sameSite:'Lax'})
  await context.setCookie(...chunks.map((v,i)=>cookie(`sb-${ref}-auth-token${chunks.length===1?'':'.'+i}`,v)),cookie('bw_fundo_ativo_id',fund),cookie('bw_cedente_fundo_ativo_id',link),cookie('bw_notificacoes_fundo_id',fund))
  const page=await context.newPage();await page.setViewport({width:1440,height:1000})
  const r=await page.goto(base+`/${role}/notificacoes`,{waitUntil:'domcontentloaded',timeout:60000})
  assert(r.status()<400);assert.equal(new URL(page.url()).pathname,`/${role}/notificacoes`)
  assert(r.headers()['content-security-policy']?.includes(ref+'.supabase.co'))
  for(const other of [productionRef,preview.ref,'fhgkmggthxikfpogrvaa'].filter(x=>x!==ref))assert(!r.headers()['content-security-policy'].includes(other))
  await page.waitForFunction(()=>document.querySelector('[aria-label="Lista de notificações"]')?.getAttribute('aria-busy')==='false',{timeout:30000})
  return {page,context}
}
async function waitUnread(page,n){try{await page.waitForFunction(n=>document.querySelector('[aria-labelledby="notificacoes-title"] [role="status"]')?.textContent.startsWith(n+' não lidas neste contexto'),{timeout:15000},n)}catch(e){report.diagnostic={expectedUnread:n,path:new URL(page.url()).pathname,state:await readMarkState(page)};throw e}}
try{
  const history=(await db.query('SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version')).rows
  assert(!history.some(x=>x.version==='20260929193129'))
  log('seed');await qa.seed();log('auth')
  for(const name of ['gestor','cedente','sacado','consultor','gestorB'])await qa.login(name)
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
  for(const role of ['gestor','cedente','sacado','consultor']){
    log(role);const c=actors[role].client
    await qa.notify('nota_fiscal',NF,role,'A1');await qa.notify('nota_fiscal',NF,role,'A2');await qa.notify('nota_fiscal',NFB,role,'B1')
    assert.equal((await qa.notify('nota_fiscal',NF,role,'A1')).length,0)
    assert.deepEqual(val(await c.rpc('listar_fundos_notificacoes')).map(f=>f.id).sort(),[A,B].sort())
    assert.equal(await count(c,A),2);assert.equal(await count(c,B),1)
    assert((await c.rpc('listar_notificacoes',{p_scope:'FUNDO',p_fundo_id:C})).error)
    assert((await c.rpc('listar_notificacoes',{p_scope:'LEGACY_UNSCOPED',p_fundo_id:null})).error)
    val(await qa.admin.rpc('notificar_seguranca_global',{p_usuario_id:actors[role].id,p_titulo:'QA R4 security',p_mensagem:'QA',p_tipo:'seguranca_senha_alterada',p_dedupe_key:qa.run+role}))
    assert.equal(val(await c.rpc('contar_notificacoes',{p_scope:'GLOBAL',p_fundo_id:null}))[0].nao_lidas,1)
    const a=val(await c.rpc('listar_notificacoes',{p_scope:'FUNDO',p_fundo_id:A})).find(n=>n.titulo==='A1'),b=val(await c.rpc('listar_notificacoes',{p_scope:'FUNDO',p_fundo_id:B}))[0]
    assert((await c.rpc('marcar_notificacoes_lidas',{p_scope:'FUNDO',p_fundo_id:A,p_id:b.id})).error)
    assert((await c.rpc('obter_destino_notificacao',{p_scope:'FUNDO',p_fundo_id:A,p_id:b.id})).error)
    const {page,context}=await open(c,role,A,CF);await waitUnread(page,2)
    assert.equal(await page.$eval('[data-testid="notificacao-badge"]',e=>e.textContent),'2')
    const cookies=(await context.cookies()).map(c=>c.name+'='+c.value).join('; ')
    const good=await fetch(`${base}/notificacoes/abrir/${a.id}?scope=FUNDO&fundo=${A}`,{headers:{cookie:cookies},redirect:'manual'});assert.equal(good.status,303)
    const detail=await context.newPage();assert.equal((await detail.goto(good.headers.get('location'),{waitUntil:'domcontentloaded'})).status(),200);await detail.close();await page.bringToFront()
    const bad=await fetch(`${base}/notificacoes/abrir/${b.id}?scope=FUNDO&fundo=${B}`,{headers:{cookie:cookies},redirect:'manual'});assert.equal(bad.status,403)
    await keyboardCycle(page,{negative:true})
    const oneRead=observeActions(page);report.markOneActions??=[];report.markOneActions.push({role,events:oneRead.events})
    const markSelector=`[aria-labelledby="notificacoes-title"] [data-notificacao-id="${a.id}"] button:has(svg.lucide-check)`
    await page.waitForFunction(selector=>{const b=document.querySelector(selector);return b&&!b.disabled&&b.checkVisibility()&&document.querySelector('[aria-label="Lista de notificações"]')?.getAttribute('aria-busy')==='false'},{timeout:15000},markSelector)
    await page.focus(markSelector);await page.keyboard.press('Enter')
    await waitUnread(page,1);assert.equal(await count(c,A),1);assert.equal(await count(c,B),1)
    assert.equal(oneRead.events.filter(e=>e.event==='request'&&e.kind==='mark').length,1);oneRead.stop()
    await clickMarkAllReady(page,'A2');await waitUnread(page,0);assert.equal(await count(c,B),1)
    await keyboardOpen(page);await rememberFocus(page)
    await qa.notify('nota_fiscal',NFB,role,'B-realtime');await qa.notify('nota_fiscal',NF,role,'A-realtime')
    await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.textContent.includes('A-realtime'),{timeout:20000});await unchangedFocus(page)
    assert(!(await page.$eval('[role="dialog"]',e=>e.textContent)).includes('B-realtime'));await keyboardClose(page)
    if(role==='gestor'){await page.click('[aria-controls="fundo-ativo-dropdown"]');await page.evaluate(()=>[...document.querySelectorAll('#fundo-ativo-dropdown button')].find(b=>b.textContent.includes('QA Notificacoes B')).click());await page.waitForFunction(()=>location.pathname==='/gestor/dashboard');await page.goto(base+'/gestor/notificacoes',{waitUntil:'domcontentloaded'})}
    else if(role==='cedente')await page.select('select[aria-label="Fundo operacional do cedente"]',CFB)
    else await page.select('select[aria-label="Fundo das notificações"]',B)
    await waitUnread(page,2);await keyboardCycle(page,{negative:true})
    assert.equal(await page.$eval('[data-testid="notificacao-badge"]',e=>e.textContent),'2')
    checks.push(role+':Auth/MFA,list,badge,mark-one,mark-all,realtime,switch,href,GLOBAL,LEGACY,keyboard PASS')
    if(role==='consultor')for(const width of [390,820,1440])for(const theme of ['light','dark']){
      await page.setViewport({width,height:1000});await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme)
      await keyboardCycle(page,{negative:true});await keyboardOpen(page)
      await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))})
      await page.addScriptTag({content:readFileSync(require.resolve('axe-core/axe.min.js'),'utf8')})
      const violations=await page.evaluate(async()=>(await axe.run({include:[['[aria-labelledby="notificacoes-title"]'],['[role="dialog"]']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>v.id))
      assert.deepEqual(violations,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await page.screenshot({path:`${output}/${width}-${theme}.png`});await keyboardClose(page);screens.push({width,theme,keyboard:true,violations})
    }
    await context.close()
  }
  log('single-fund');const single=actors.gestorB.client
  assert.deepEqual(val(await single.rpc('listar_fundos_notificacoes')).map(f=>f.id),[B]);assert((await single.rpc('listar_notificacoes',{p_scope:'FUNDO',p_fundo_id:A})).error)
  const one=await open(single,'gestor',B,CFB);await waitUnread(one.page,2)
  const multiBefore=await count(actors.gestor.client,B)
  await clickMarkAllReady(one.page,'B1');await waitUnread(one.page,0);assert.equal(await count(actors.gestor.client,B),multiBefore)
  await qa.notify('nota_fiscal',NF,'gestor','Single-other-A');await qa.notify('nota_fiscal',NFB,'gestor','Single-B')
  await waitUnread(one.page,1);assert(!(await one.page.$eval('[aria-labelledby="notificacoes-title"]',e=>e.textContent)).includes('Single-other-A'))
  await keyboardCycle(one.page,{negative:true});await one.context.close();checks.push('single-fund:list,badge,mark-all,realtime,keyboard PASS')
  log('producers')
  for(const action of ['aceitar','contestar']){
    await db.query("UPDATE public.operacoes SET status='solicitada',aceite_sacado_status='pendente' WHERE id=$1",[OP]);await db.query("UPDATE public.notas_fiscais SET status='em_antecipacao' WHERE id=$1",[NF])
    val(await actors.sacado.client.rpc('processar_aceite_sacado',{p_nota_fiscal_ids:[NF],p_acao:action,p_motivo:action==='contestar'?'Contestacao QA R4':null}))
    const rows=(await db.query('SELECT usuario_id,fundo_id FROM public.notificacoes WHERE dedupe_key LIKE $1',[`fund:${A}:operacao:${OP}:nf:${NF}:${action}:%`])).rows
    assert.deepEqual(rows.map(r=>r.usuario_id).sort(),[actors.cedente.id,actors.gestor.id].sort());assert(rows.every(r=>r.fundo_id===A));checks.push(action+':real RPC exact recipients PASS')
  }
  for(const type of ['documento_enviado','alteracao_cadastral']){
    const args={p_cedente_id:qa.id('23'),p_titulo:'QA '+type,p_mensagem:'QA '+qa.run,p_tipo:type,p_evento_key:qa.run+type}
    assert.equal(val(await qa.admin.rpc('notificar_gestores_cadastro_cedente',args)),3);assert.equal(val(await qa.admin.rpc('notificar_gestores_cadastro_cedente',args)),0)
    const rows=(await db.query('SELECT usuario_id,fundo_id FROM public.notificacoes WHERE tipo=$1 AND cedente_id=$2',[type,qa.id('23')])).rows
    assert.deepEqual(rows.map(r=>r.usuario_id+':'+r.fundo_id).sort(),[actors.gestor.id+':'+A,actors.gestor.id+':'+B,actors.gestorB.id+':'+B].sort());checks.push(type+':scoped producer PASS')
  }
  for(const [entity,entityId,dest,title,type] of [['entrega',E,'cedente','QA logistics','cte_prazo_proximo'],['operacao',OP,'gestor','QA technical','integracao_alerta']]){const rows=await qa.notify(entity,entityId,dest,title,type);assert.deepEqual(rows.map(r=>r.usuario_id),[actors[dest].id]);assert.equal((await qa.notify(entity,entityId,dest,title,type)).length,0);checks.push(title+':real producer boundary/dedupe PASS')}
  assert.deepEqual((await db.query('SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version')).rows,history)
  report.success=true
}catch(e){report.error={code:e.code??'ASSERTION',message:String(e.message).split('\n')[0].slice(0,200)};process.exitCode=1}
finally{
  await browser?.close();log('cleanup')
  try{await qa.cleanup();await qa.cleanup();report.cleanup=qa.manifest.cleanup;assert.deepEqual(await fingerprints(db,{concurrency:qa.manifest.concurrency}),qa.manifest.before)}catch(e){report.cleanupError={code:e.code??'ASSERTION',message:String(e.message).split('\n')[0].slice(0,200)};report.success=false;process.exitCode=1}
  await db.end();writeFileSync(out+(prod?'/smoke-production.json':'/smoke-preview.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
