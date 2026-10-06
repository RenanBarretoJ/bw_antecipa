// Actual notification components, mocked transport boundaries. No remote traffic.
// Complements (does not replace) Preview Auth/Realtime certification.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import puppeteer from 'puppeteer-core'
import {probeLegacySequence,controlledOpeningProbe} from './focus-probe.mjs'
import {keyboardCycle,keyboardOpen,keyboardClose,rememberFocus,unchangedFocus} from './focus-keyboard.mjs'
import {clickMarkAllReady,readMarkState} from './mark-read-diagnostics.mjs'
const require=createRequire(import.meta.url)
const {build}=createRequire(require.resolve('tsx/package.json'))('esbuild')
const output=resolve('rehearsal/reports/notificacoes-browser-local')
mkdirSync(output,{recursive:true})
const mocks={
  'next/link': `import React from 'react';export default function Link({children,prefetch,...p}){return <a {...p} onClick={e=>{p.onClick?.(e);if(p.href.includes('/notificacoes')&&!p.href.includes('/abrir/')){e.preventDefault();window.qa.filter(new URL(p.href,location.origin).searchParams.get('filtro')||'todas')}}}>{children}</a>}`,
  '@/lib/supabase/client': `export function createClient(){return {channel(name){const channel={name,callback:null,on(_,filter,cb){channel.callback=cb;return channel},subscribe(cb){window.qa.channels.push(channel);cb?.('SUBSCRIBED');return channel}};return channel},removeChannel(channel){window.qa.channels=window.qa.channels.filter(c=>c!==channel)}}}`,
  '@/lib/actions/notificacoes-listagem': `import {notificacaoMatchesFilter} from '@/lib/notificacoes/contracts';
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    export async function carregarContextoNotificacoes(){await sleep(20);return {userId:'qa-user',role:window.qa.role,fundos:[{id:'A',nome:'Fundo A — carteira de teste'},{id:'B',nome:'Fundo B — carteira de teste'}],fundoId:window.qa.fund,seletorProprio:['sacado','consultor'].includes(window.qa.role)}}
    export async function selecionarFundoNotificacoes(id){await sleep(70);if(!['A','B'].includes(id))throw Error('denied');window.qa.fund=id;return carregarContextoNotificacoes()}
    export async function carregarPaginaNotificacoes({escopo,filtro,limit,cursor}){window.qa.requests.push({escopo,filtro});if(window.qa.fail)throw Error('offline');const all=window.qa.rows.filter(r=>r.scope===escopo.scope&&r.fundoId===escopo.fundoId);const rows=all.filter(r=>notificacaoMatchesFilter(r,filtro));const start=Number(cursor)||0;const page={userId:'qa-user',items:structuredClone(rows.slice(start,start+limit)),contadores:{total:all.length,naoLidas:all.filter(r=>!r.lida).length},hasMore:rows.length>start+limit,nextCursor:rows.length>start+limit?String(start+limit):null};if(limit===20&&window.qa.holdList)await new Promise(r=>window.qa.listWaiters.push(r));await sleep(escopo.fundoId==='A'?(window.qa.delayA||15):15);return page}
    export async function marcarNotificacoesLidas(escopo,id){window.qa.marks.push({escopo,id});await sleep(20);if(window.qa.markFail)throw Error('denied');window.qa.rows.forEach(r=>{if(r.scope===escopo.scope&&r.fundoId===escopo.fundoId&&(!id||r.id===id))r.lida=true});return {total:0,naoLidas:0}}
  `,
}
const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{NotificacoesProvider}from'./src/components/notificacoes/notificacoes-context';
import{NotificacoesPageClient}from'./src/components/notificacoes/notificacoes-page-client';
import{NotificationBell}from'./src/components/ui/notification-bell';
import{iniciarTrocaContextoNotificacoes,concluirTrocaContextoNotificacoes,NOTIFICACOES_ATUALIZAR}from'./src/lib/notificacoes/events';
const role=new URLSearchParams(location.search).get('role')||'gestor';
function row(id,fund,tipo){return{id,createdAt:'2026-10-06T10:00:00.123456Z',titulo:id,mensagem:'Aviso sintético do '+fund,tipo,lida:false,entidadeTipo:'nota_fiscal',entidadeId:id,href:'/notificacoes/abrir/'+id+'?fundo='+fund,scope:'FUNDO',fundoId:fund}}
window.qa={role,fund:'A',rows:[row('A1','A','nf_aprovada'),row('A2','A','operacao_aprovada'),row('B1','B','nf_aprovada')],channels:[],requests:[],marks:[],filter:()=>{},row,
emit(id,fund,tipo='nf_aprovada'){const r=row(id,fund,tipo);window.qa.rows.unshift(r);window.qa.channels.forEach(c=>c.callback({eventType:'INSERT',new:{usuario_id:'qa-user',scope_type:'FUNDO',fundo_id:fund},old:{}}))},
refresh(){window.dispatchEvent(new Event(NOTIFICACOES_ATUALIZAR))}};
function App(){const[filter,setFilter]=useState('todas');const[fund,setFund]=useState('A');window.qa.filter=setFilter;return<NotificacoesProvider userId='qa-user'><header className='flex justify-end gap-4 border-b border-border p-4'>{['gestor','cedente'].includes(role)&&<select aria-label='Fundo operacional QA' value={fund} onChange={async e=>{const value=e.target.value;iniciarTrocaContextoNotificacoes();await new Promise(r=>setTimeout(r,70));window.qa.fund=value;setFund(value);concluirTrocaContextoNotificacoes()}}><option>A</option><option>B</option></select>}<NotificationBell userId='qa-user'/></header><main className='pt-6'><NotificacoesPageClient initialFilter={filter} basePath={'/'+role+'/notificacoes'}/></main></NotificacoesProvider>};createRoot(document.getElementById('root')).render(<App/>);`
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'isolated-ui',setup(b){
  b.onResolve({filter:/^(next\/|@\/)/},args=>mocks[args.path]?{path:args.path,namespace:'qa'}:undefined)
  b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:process.cwd()}))
}}]})
const css=(await postcss([tailwind()]).process(readFileSync('src/app/globals.css','utf8'),{from:resolve('src/app/globals.css')})).css
const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="pt-BR"><head><title>QA notificações por Fundo</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}:root{--font-inter:Arial}</style></head><body class="bg-background text-foreground"><div id="root"></div><script src="/app.js"></script></body></html>`)})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const checks=[], errors=[], axe=[]
try{
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message))
  await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(base)?r.continue():r.abort())
  const badge=async n=>page.waitForFunction(n=>document.querySelector('[data-testid="notificacao-badge"]')?.textContent===(n>9?'9+':String(n)),{},n)
  const items=()=>page.$$eval('ul[aria-label="Lista de notificações"] h2',nodes=>nodes.map(n=>n.childNodes[0].textContent))
  const ready=()=>page.waitForFunction(()=>document.querySelector('ul[aria-label="Lista de notificações"]')?.getAttribute('aria-busy')==='false')
  if(process.argv.includes('--focus-probe')) {
    await page.setViewport({width:390,height:1000})
    await page.goto(`${base}/?role=consultor`,{waitUntil:'domcontentloaded'});await badge(2);await ready()
    await page.evaluate(()=>document.documentElement.classList.add('dark'))
    const report = await probeLegacySequence(page)
    writeFileSync(resolve(output,'focus-probe.json'),JSON.stringify(report,null,2))
    console.log(JSON.stringify({rounds:report.rounds,failures:report.failures}))
    const controlled=await controlledOpeningProbe(page)
    writeFileSync(resolve(output,'focus-controlled.json'),JSON.stringify(controlled,null,2))
    console.log(JSON.stringify({controlled:controlled.results.map(r=>({premature:r.premature.active,settled:r.settled.active}))}))
    await page.focus('main li button');await page.keyboard.press('Enter');await ready()
    await page.waitForFunction(()=>document.querySelector('main [role="status"]')?.textContent.startsWith('1 não lidas'))
    console.log(JSON.stringify({markAllView:await page.evaluate(()=>({tag:document.activeElement.tagName,text:document.activeElement.textContent.slice(0,80)}))}))
    await page.click('nav a[href*="nao_lidas"]');await ready()
    await page.focus('main li button');await page.keyboard.press('Enter')
    await page.waitForFunction(()=>document.querySelector('main [role="status"]')?.textContent.startsWith('0 não lidas'))
    console.log(JSON.stringify({markUnreadView:await page.evaluate(()=>({tag:document.activeElement.tagName,text:document.activeElement.textContent.slice(0,80)}))}))
  } else {
  const markProof=[]
  for(let round=0;round<3;round++){
    await page.goto(`${base}/?role=cedente`,{waitUntil:'domcontentloaded'});await badge(2);await ready()
    await keyboardOpen(page)
    await page.evaluate(()=>{window.qa.holdList=true;window.qa.listWaiters=[];window.qa.emit('A-realtime','A')})
    await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.textContent.includes('A-realtime'))
    await page.waitForFunction(()=>window.qa.listWaiters.length>0)
    await keyboardClose(page)
    const before=await readMarkState(page)
    assert.equal(before.listBusy,'true');assert.equal(before.button.disabled,true)
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Marcar todas como lidas').click())
    assert.equal(await page.evaluate(()=>window.qa.marks.length),0,'LEGACY_DISABLED_CLICK_MUST_NOT_SUBMIT')
    // Release the held response explicitly, without a timing sleep or app change.
    await page.evaluate(()=>{window.qa.holdList=false;window.qa.listWaiters.splice(0).forEach(r=>r())})
    await clickMarkAllReady(page,'A-realtime')
    await page.waitForFunction(()=>document.querySelector('main [role="status"]')?.textContent.startsWith('0 não lidas'))
    assert.equal(await page.evaluate(()=>window.qa.marks.length),1)
    assert.equal(await page.evaluate(()=>window.qa.rows.filter(r=>r.fundoId==='B'&&!r.lida).length),1)
    markProof.push({round,before,legacyMutations:0,readyMutations:1,after:await readMarkState(page),otherFundUnchanged:true})
  }
  writeFileSync(resolve(output,'mark-read-controlled.json'),JSON.stringify({success:true,results:markProof},null,2))
  checks.push('mark-all-readiness:3-controlled-disabled-noop-and-enabled-success')
  for(const role of ['gestor','cedente','sacado','consultor']){
    await page.goto(`${base}/?role=${role}`,{waitUntil:'domcontentloaded'});await badge(2);await ready()
    await keyboardCycle(page,{negative:true})
    assert.deepEqual(await items(),['A1','A2'])
    const select=['gestor','cedente'].includes(role)?'[aria-label="Fundo operacional QA"]':'main [aria-label="Fundo das notificações"]'
    assert.equal((await page.$$('[aria-label="Fundo das notificações"]')).length,['gestor','cedente'].includes(role)?0:1)
    await keyboardOpen(page);await rememberFocus(page)
    await page.evaluate(()=>window.qa.emit('B2','B'));await ready();assert.deepEqual(await items(),['A1','A2']);await badge(2);await unchangedFocus(page)
    await page.evaluate(()=>window.qa.emit('A3','A'));await badge(3);assert((await items()).includes('A3'));await unchangedFocus(page)
    await keyboardClose(page)
    await page.select(select,'B');await badge(2);await ready();assert.deepEqual(await items(),['B2','B1'])
    await keyboardCycle(page)
    await page.select(select,'A');await badge(3);await ready()
    await page.click('main button:has(svg.lucide-check-check)')
    await page.waitForFunction(()=>document.querySelector('main [role="status"]')?.textContent.startsWith('0 não lidas'))
    assert.equal(await page.evaluate(()=>window.qa.rows.filter(r=>r.fundoId==='B'&&!r.lida).length),2)
    await page.select(select,'B');await badge(2);await ready()
    await page.select(select,'A');await ready()
    await page.evaluate(()=>{window.qa.delayA=500;window.qa.refresh()})
    await page.select(select,'B');await badge(2);await ready()
    await new Promise(r=>setTimeout(r,600));assert.deepEqual(await items(),['B2','B1'])
    checks.push(`${role}:A-B-badge-realtime-markall-stale-response`)
  }
  await page.goto(`${base}/?role=gestor`,{waitUntil:'domcontentloaded'});await ready()
  await page.focus('main li button');await page.keyboard.press('Enter')
  await page.waitForFunction(()=>document.querySelector('main [role="status"]')?.textContent.startsWith('1 não lidas'))
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('[data-notificacao-id]')?.dataset.notificacaoId),'A1','MARK_LOST_ROW_FOCUS')
  await page.click('nav a[href*="nao_lidas"]');await ready()
  await page.focus('main li button');await page.keyboard.press('Enter')
  await page.waitForFunction(()=>document.querySelector('main [role="status"]')?.textContent.startsWith('0 não lidas'))
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Notificações do contexto atual','EMPTY_LIST_FOCUS_LOST')
  checks.push('mark-read-focus-all-and-empty-unread')
  await page.goto(`${base}/?role=gestor`,{waitUntil:'domcontentloaded'});await ready()
  await page.click('nav a[href*="nao_lidas"]');await ready()
  await page.focus('main li button');await page.keyboard.press('Enter')
  await page.waitForFunction(()=>document.querySelector('main [role="status"]')?.textContent.startsWith('1 não lidas'))
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('[data-notificacao-id]')?.dataset.notificacaoId),'A2','NEXT_UNREAD_FOCUS_LOST')
  await page.evaluate(()=>window.qa.markFail=true)
  await page.focus('main li button');await page.keyboard.press('Enter');await page.waitForSelector('main [role="alert"]')
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('[data-notificacao-id]')?.dataset.notificacaoId),'A2','FAILED_MARK_STOLE_FOCUS')
  await page.evaluate(()=>window.qa.markFail=false)
  await keyboardOpen(page)
  await page.focus('[role="dialog"] article button');await page.keyboard.press('Enter')
  await page.waitForFunction(()=>!document.querySelector('[role="dialog"] article button'))
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('[data-notificacao-id]')?.dataset.notificacaoId),'A2','BELL_MARK_FOCUS_LOST')
  await keyboardClose(page)
  checks.push('mark-read-next-unread-error-and-bell-focus')
  await page.goto(`${base}/?role=gestor`,{waitUntil:'domcontentloaded'});await ready()
  await page.click('nav[aria-label="Filtros de notificações"] a[href*="documentos"]');await ready()
  await page.waitForFunction(()=>document.querySelectorAll('ul[aria-label="Lista de notificações"] li').length===1)
  assert.deepEqual(await items(),['A1'])
  await page.click('nav[aria-label="Filtros de notificações"] a[href*="operacoes"]');await ready()
  await page.waitForFunction(()=>document.querySelector('ul[aria-label="Lista de notificações"] h2')?.textContent.startsWith('A2'))
  for(const filtro of ['logistica','integracoes','alertas']){await page.click(`nav a[href*="${filtro}"]`);await ready();assert.equal((await items()).length,0)}
  await page.click('nav a[href="/gestor/notificacoes"]');await ready()
  await page.evaluate(()=>{for(let i=4;i<=28;i++)window.qa.rows.push(window.qa.row('A'+i,'A','nf_aprovada'));window.qa.refresh()})
  await page.waitForFunction(()=>document.querySelectorAll('ul[aria-label="Lista de notificações"] li').length===20)
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Carregar mais'))?.click())
  await page.waitForFunction(()=>document.querySelectorAll('ul[aria-label="Lista de notificações"] li').length===27)
  assert.equal(new Set(await items()).size,27)
  checks.push('filters-and-keyset-pagination')
  await page.evaluate(()=>{window.qa.fail=true;window.qa.refresh()});await page.waitForSelector('main [role="alert"]')
  assert.equal((await items()).length,0)
  await page.evaluate(()=>{window.qa.fail=false});await page.click('main [role="alert"] button');await ready();await badge(27)
  checks.push('transport-error-fail-closed-and-retry')
  for(const width of [390,430,820,1440,1920])for(const theme of ['light','dark']){
    await page.setViewport({width,height:1000});await page.goto(`${base}/?role=gestor`,{waitUntil:'domcontentloaded'});await ready()
    await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme)
    const focus=await keyboardCycle(page,{negative:true})
    writeFileSync(resolve(output,`${width}-${theme}-focus.json`),JSON.stringify(focus,null,2))
    await keyboardOpen(page)
    // Theme/popup transitions must finish before measuring contrast, not midway
    // between the light and dark token values.
    await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))})
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow')
    const bounds=await page.$eval('[role="dialog"]',e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,bottom:r.bottom}})
    assert(bounds.left>=0&&bounds.right<=width&&bounds.bottom<=1000,'popover outside viewport')
    await page.addScriptTag({content:readFileSync(require.resolve('axe-core/axe.min.js'),'utf8')})
    const violations=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))})
    if(violations.length) console.log(JSON.stringify({width,theme,violations}))
    axe.push({width,theme,violations});assert.deepEqual(violations,[])
    await page.screenshot({path:resolve(output,`${width}-${theme}.png`),fullPage:true})
    await keyboardClose(page)
    checks.push(`${width}-${theme}:responsive-keyboard-focus-axe`)
  }
  assert.deepEqual(errors,[])
  const report={localOnly:true,authenticatedSmoke:false,success:true,checks,axe,errors}
  writeFileSync(resolve(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
  }
}finally{await browser.close();await new Promise(r=>server.close(r))}
