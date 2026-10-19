// Isolated component/UX test, synthetic responses only. Not authenticated E2E.
import assert from 'node:assert/strict'
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require=createRequire(import.meta.url)
const {build}=createRequire(require.resolve('tsx/package.json'))('esbuild')
const output=resolve(process.env.LOCALAPPDATA,'bw-antecipa-evidence/vortx-reports-preview-20261019',`browser-${Date.now()}`)
mkdirSync(output,{recursive:true})
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const row={id,fundo_id:id,integracao_versao_id:id,ambiente:'producao',pedido:{codigoCarteira:'qa-carteira',tipoRelatorio:'Inclusao',dataInicio:'2026-10-01',dataFim:'2026-10-16',dataReferencia:'2026-10-16',extensaoArquivo:2},estado:'aceita',protocolo_externo:id,codigo_http:200,criada_em:'2026-10-19T17:00:00Z',envio_iniciado_em:'2026-10-19T17:00:01Z',concluida_em:'2026-10-19T17:00:02Z'}
const contexto={fundo:{id,nome:'FUNDO SINTÉTICO DE TESTE DE RELATÓRIOS COM NOME LONGO',cnpj:'00000000000000'},versoes:[{id,versao:1,ambiente:'producao',carteira:'qa-carteira',capabilities:['ESTOQUE','AQUISICOES','LIQUIDACOES']}]}
const mocks={
  'next/link':`import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
  'next/navigation':`export const useRouter=()=>({refresh:()=>{window.qa.refreshes++}})`,
  '@/app/admin/fundos/relatorios-vortx-actions':`export async function solicitarRelatorioVortx(input){window.qa.calls.push({...input,mfaCode:'[SYNTHETIC_REDACTED]'});await new Promise(r=>setTimeout(r,300));return window.qa.result}`,
}
const bundle=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{VortxReportRequests}from'./src/components/admin/vortx-report-requests';const mode=new URLSearchParams(location.search).get('mode');const row=${JSON.stringify(row)};const contexto=${JSON.stringify(contexto)};if(mode==='unconfigured')contexto.versoes=[];if(mode==='capability')contexto.versoes[0].capabilities=['ESTOQUE'];window.qa={calls:[],refreshes:0,result:mode==='error'?{success:false,message:'Código TOTP inválido.'}:{success:true,criada:mode!=='duplicate',solicitacao:{...row,estado:mode==='unknown'?'indeterminada':mode==='failure'?'falha_autenticacao':'aceita'}}};const estados=['aceita','recusada','indeterminada','falha_autenticacao','registrada','enviando'];const historico={total:mode==='empty'?0:24,solicitacoes:mode==='empty'?[]:estados.map((estado,i)=>({...row,id:row.id.slice(0,-1)+i,estado,protocolo_externo:estado==='aceita'?row.id:null,codigo_http:estado==='recusada'?401:estado==='aceita'?200:null}))};createRoot(document.getElementById('root')).render(<VortxReportRequests contexto={contexto} historico={historico} pagina={1} hoje='2026-10-19'/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'isolated-ux-boundaries',setup(b){b.onResolve({filter:/^(next\/|@\/)/},args=>mocks[args.path]?{path:args.path,namespace:'qa'}:undefined);b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:process.cwd()}))}}]})
const css=(await postcss([tailwind()]).process(readFileSync('src/app/globals.css','utf8'),{from:resolve('src/app/globals.css')})).css
const server=createServer((req,res)=>{
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}:root{--font-inter:Arial}</style></head><body class="bg-background"><main id="root" class="mx-auto max-w-6xl p-4"></main><script src="/app.js"></script></body></html>`)
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const base=`http://127.0.0.1:${server.address().port}`
const checks=[],errors=[];let browser
try {
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
  const page=await browser.newPage()
  page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true)
  page.on('request',req=>req.url().startsWith(base)?req.continue():req.abort())
  for(const width of [1440,390]) {
    await page.setViewport({width,height:1000})
    for(const mode of ['empty','normal','unconfigured','capability']) {
      await page.goto(`${base}/?mode=${mode}`,{waitUntil:'networkidle0'})
      assert.equal(await page.evaluate(()=>window.qa.calls.length),0,'NO_EXTERNAL_REQUEST_ON_LOAD')
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'HORIZONTAL_OVERFLOW')
      if(mode==='empty')assert((await page.$eval('body',e=>e.textContent)).includes('Nenhum pedido nesta página'))
      if(mode==='unconfigured')assert.equal(await page.$('button[type=submit]'),null)
      if(mode==='capability')assert.equal(await page.$$eval('input[type=radio]:disabled',els=>els.length),2)
      await page.screenshot({path:resolve(output,`${mode}-${width}.png`),fullPage:true})
      checks.push(`${mode}-${width}:layout-empty-capability-no-auto-request`)
    }
  }
  await page.setViewport({width:1440,height:1000})
  async function press(text){await page.evaluate(t=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(t))?.click(),text)}
  for(const mode of ['normal','duplicate','unknown','failure','error']) {
    await page.goto(`${base}/?mode=${mode}`,{waitUntil:'networkidle0'})
    await page.click('input[value=Inclusao]');assert.equal(await page.$('#relatorio-referencia'),null)
    await press('Revisar e solicitar');await page.waitForSelector('[role=dialog]')
    assert((await page.$eval('[role=dialog]',e=>e.textContent)).includes('Cessões realizadas'))
    await page.type('#admin-sensitive-mfa','123456')
    await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Confirmar e solicitar'));b.click();b.click()})
    await page.waitForFunction(()=>!document.querySelector('[role=dialog]'))
    assert.equal(await page.evaluate(()=>window.qa.calls.length),1,'DOUBLE_CLICK_SUBMITS_ONCE')
    const text=await page.$eval('[role=status]',e=>e.textContent)
    assert(text.includes({normal:'Aguardando arquivo',duplicate:'não reenviado',unknown:'Retorno não confirmado',failure:'Não enviado',error:'TOTP inválido'}[mode]))
    const n=await page.evaluate(()=>window.qa.calls.length);await press('Atualizar histórico');assert.equal(await page.evaluate(()=>window.qa.calls.length),n,'REFRESH_DOES_NOT_POST')
    checks.push(`${mode}:confirmation-double-click-result-refresh`)
  }
  await page.goto(`${base}/?mode=empty`,{waitUntil:'networkidle0'})
  await page.$eval('#relatorio-inicio',e=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'2026-10-19');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})
  await press('Revisar e solicitar');await page.waitForSelector('[role=alert]');assert.equal(await page.$('[role=dialog]'),null);checks.push('invalid-period-blocks-confirmation')
  assert.deepEqual(errors,[])
  writeFileSync(resolve(output,'REPORT.json'),JSON.stringify({scope:'LOCAL_SYNTHETIC_COMPONENT_ONLY',authenticatedSmoke:false,checks,errors},null,2))
  console.log(JSON.stringify({output,checks:checks.length,errors}))
} finally {if(browser)await browser.close();await new Promise(r=>server.close(r))}
