import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import puppeteer from 'puppeteer-core'

// Builds the real client components with synthetic props and explicit action/router doubles.
// Generated HTML/bundles are artifacts, never application routes. No backend or provider is called.
const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/central-bases-20261021', `browser-${Date.now()}`)
mkdirSync(output, { recursive: true })
const generated = resolve(output, 'fixture-source')
mkdirSync(generated, { recursive: true })
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {VortxReportRequests} from '@/components/admin/vortx-report-requests';
import '@/app/globals.css';
const id=${JSON.stringify(id)};
const base={id,fundo_id:id,integracao_versao_id:id,ambiente:'producao',pedido:{codigoCarteira:'QA-SINTETICA',tipoRelatorio:'Inclusao',dataInicio:'2026-10-18',dataFim:'2026-10-19',dataReferencia:'2026-10-19',extensaoArquivo:2},estado:'aceita',protocolo_externo:id,codigo_http:200,criada_em:'2026-10-20T13:00:00Z',envio_iniciado_em:null,concluida_em:null,origem:'MANUAL'};
const ctx={fundo:{id,nome:'Fundo Demonstração QA',cnpj:'00000000000000'},podeSolicitar:true,versoes:[{id,versao:1,ambiente:'producao',carteira:'QA-SINTETICA',capabilities:['ESTOQUE','AQUISICOES','LIQUIDACOES']}]};
const geometryRows=['PosicaoParcela','PosicaoAtivo','Inclusao','Exclusao','PosicaoParcela'].map((tipo,index)=>({...base,id:id.slice(0,-1)+index,pedido:{...base.pedido,tipoRelatorio:tipo},acompanhamento:index<2?{processamento:'REVISAO',publicacao:'NAO_PUBLICADA',processadoEm:'2026-10-20T14:00:00Z',ativos:12,parcelas:18}:undefined}));
const app=createRoot(document.getElementById('root'));let revision=0;
window.__qa={requests:[],pushes:[],refresh:0};
window.mount=(mode='operator')=>{window.__qa={requests:[],pushes:[],refresh:0}; const contexto={...ctx,podeSolicitar:mode!=='reader',versoes:mode==='unconfigured'?[]:ctx.versoes};
app.render(React.createElement(VortxReportRequests,{key:++revision,contexto,historico:{total:mode==='empty'?0:25,solicitacoes:mode==='empty'?[]:mode==='geometry'?geometryRows:[base],resumo:mode==='geometry'?geometryRows:[base]},pagina:1,hoje:'2026-10-21',filtros:mode==='geometry'?{}:{tipo:'Inclusao'},historicoHref:'/admin/fundos/qa?tab=dados-financeiros'}));};window.mount();`
writeFileSync(resolve(generated, 'entry.jsx'), entry)
writeFileSync(resolve(generated, 'router.mjs'), `export const useRouter=()=>({refresh:()=>window.__qa.refresh++,push:url=>window.__qa.pushes.push(url)});`)
writeFileSync(resolve(generated, 'link.mjs'), `import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{...props,href},children)}`)
writeFileSync(resolve(generated, 'action.mjs'), `export async function solicitarRelatorioVortx(input){window.__qa.requests.push(input);await new Promise(r=>setTimeout(r,200));return {success:false,message:'Falha sintética controlada; nenhum pedido externo foi enviado.'}}`)
await build({ root, configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, resolve: { alias: [
  { find: '@/app/admin/fundos/relatorios-vortx-actions', replacement: resolve(generated, 'action.mjs') },
  { find: 'next/navigation', replacement: resolve(generated, 'router.mjs') },
  { find: 'next/link', replacement: resolve(generated, 'link.mjs') },
  { find: 'react-dom', replacement: resolve(root, 'node_modules/react-dom') },
  { find: 'react', replacement: resolve(root, 'node_modules/react') },
  { find: '@', replacement: resolve(root, 'src') },
] },
  oxc: { jsx: { runtime: 'automatic' } },
  build: { outDir: output, emptyOutDir: false, minify: false, lib: { entry: resolve(generated, 'entry.jsx'), name: 'CentralBasesFixture', formats: ['iife'], fileName: () => 'app.js' } },
})
const css = readdirSync(output).filter(name => name.endsWith('.css'))
assert(css.length > 0)
writeFileSync(resolve(output, 'index.html'), `<!doctype html><html lang="pt-BR" style="--font-inter:'Segoe UI'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(name => `<link rel="stylesheet" href="${name}">`).join('')}<style>#root{max-width:1240px;margin:auto;padding:28px 32px}@media(max-width:760px){#root{padding:20px 14px}}</style><title>QA local · Central de Bases</title></head><body class="font-sans"><main id="root"></main><script src="app.js"></script></body></html>`)
const report = { scope: 'REAL_CLIENT_COMPONENTS_SYNTHETIC_ACTIONS_ONLY', output, checks: [], externalRequests: [], errors: [], browserClosed: false, error: null }
let browser
try {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request', req => {
    if (/^https?:/.test(req.url())) { report.externalRequests.push(new URL(req.url()).origin); req.abort(); return }
    req.continue()
  })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(pathToFileURL(resolve(output, 'index.html')).href)
  await page.waitForSelector('#historico-bases')
  for (const width of [375, 768, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 900 })
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await page.evaluate(theme => { document.documentElement.className = theme === 'dark' ? 'dark' : '' }, theme)
    const result = await page.evaluate(() => ({
      width: window.innerWidth, scroll: document.documentElement.scrollWidth,
      tableScrollable: document.querySelector('[data-slot="table-container"]').scrollWidth > document.querySelector('[data-slot="table-container"]').clientWidth,
      unnamed: [...document.querySelectorAll('input,select')].filter(e => !e.labels?.length && !e.getAttribute('aria-label')).length,
      brokenAnchors: [...document.querySelectorAll('a[href^="#"]')].filter(e => !document.getElementById(e.getAttribute('href').slice(1))).length,
    }))
    assert(result.scroll <= width, JSON.stringify(result)); assert.equal(result.unnamed, 0); assert.equal(result.brokenAnchors, 0)
    if (width === 375) assert(result.tableScrollable)
    await page.screenshot({ path: resolve(output, `central-${width}-${theme}.png`), fullPage: true })
    report.checks.push({ name: 'responsive_theme_and_labels', width, theme, ...result })
  }
  await page.setViewport({ width: 1440, height: 1000 })
  await page.evaluate(() => { document.documentElement.className = '' })
  await page.evaluate(() => window.mount('geometry'))
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 5)
  const actual = await page.evaluate(() => {
    const rect=selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,fontSize:parseFloat(getComputedStyle(e).fontSize)}}
    return {heading:rect('[data-bases-layout] > section h2'),metrics:[...document.querySelector('[aria-label="Últimos pedidos por base, independentemente dos filtros"]').children].map(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width})),request:rect('#solicitar-bases'),manual:rect('#importacao-bases'),wallet:rect('#carteira-bases'),history:rect('#historico-bases'),select:!!document.querySelector('select#relatorio-tipo'),radios:document.querySelectorAll('input[type="radio"]').length}
  })
  await page.screenshot({path:resolve(output,'option-1-corrected-1440.png'),fullPage:true})
  const referencePage=await browser.newPage()
  await referencePage.setRequestInterception(true)
  referencePage.on('request',req=>{if(/^https?:/.test(req.url())){report.externalRequests.push(new URL(req.url()).origin);req.abort()}else req.continue()})
  await referencePage.setViewport({width:1440,height:1000})
  await referencePage.goto(pathToFileURL(resolve(root,'design-previews/bases-20261021/01-central-de-bases.html')).href)
  await referencePage.evaluate(()=>document.querySelector('.prototype').remove())
  const reference=await referencePage.evaluate(()=>{
    const rect=selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,fontSize:parseFloat(getComputedStyle(e).fontSize)}}
    return {heading:rect('h1'),metrics:[...document.querySelectorAll('.metric')].map(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width})),request:rect('#solicitar'),manual:rect('#importacao'),wallet:rect('#carteira'),history:rect('#historico')}
  })
  await referencePage.screenshot({path:resolve(output,'option-1-approved-1440.png'),fullPage:true})
  await referencePage.close()
  assert.equal(actual.metrics.length,4); assert.equal(actual.heading.fontSize,reference.heading.fontSize)
  assert(Math.abs(actual.request.y-actual.manual.y)<2,'API and manual must share a row')
  assert(Math.abs(actual.request.width-actual.manual.width)<2,'Equal-width panels')
  assert(Math.abs(actual.history.width-reference.history.width)<3,'Match approved content width')
  assert(actual.metrics.every((m,index)=>m.height<=reference.metrics[index].height+45),'Compact metric height contract')
  assert(actual.request.height<=reference.request.height+130,'Compact request panel contract')
  assert(actual.wallet.y>actual.request.y && actual.request.y>actual.history.y,'Approved section order')
  assert(actual.select && actual.radios===0,'Compact select, not radio cards')
  report.checks.push({name:'approved_option_1_geometry_comparison',actual,reference,syntheticDataOnly:true})
  writeFileSync(resolve(output,'comparison.html'),`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Opção 1 · comparação local</title><style>body{font:16px system-ui;background:#eef2f7;margin:24px}main{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{width:100%;border:1px solid #ccd4df}h2{font-size:18px}</style><h1>Opção 1 aprovada × implementação corrigida</h1><p>Apenas dados sintéticos. Estados reais não foram inventados para reproduzir os exemplos do protótipo.</p><main><section><h2>HTML aprovado</h2><img src="option-1-approved-1440.png"></section><section><h2>Componente real corrigido</h2><img src="option-1-corrected-1440.png"></section></main></html>`)
  await page.evaluate(() => window.mount('operator'))
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1)
  await page.select('#bases-tipo', 'Exclusao'); await page.select('#bases-origem', 'CRON')
  await page.$eval('form[aria-label="Filtrar histórico completo"]', form => form.requestSubmit())
  assert.equal(await page.evaluate(() => window.__qa.pushes[0]), '/admin/fundos/qa?tab=dados-financeiros&tipo=Exclusao&origem=CRON&pagina=1#historico-bases')
  assert.equal(await page.evaluate(() => window.__qa.requests.length), 0)
  report.checks.push({ name: 'filters_preserve_tab_and_reset_page_without_provider_request' })
  await page.click('summary')
  assert(await page.$eval('details', node => node.open))
  await page.click('button[aria-label^="Solicitar novamente"]')
  await page.waitForSelector('[role="dialog"]')
  assert.equal(await page.evaluate(() => window.__qa.requests.length), 0)
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find(e => e.textContent === 'Cancelar').click())
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
  await page.evaluate(() => [...document.querySelectorAll('button')].find(e => e.textContent.startsWith('Revisar e solicitar')).click())
  await page.waitForSelector('[role="dialog"]')
  assert.equal(await page.evaluate(() => window.__qa.requests.length), 0)
  await page.evaluate(() => { const button = [...document.querySelectorAll('[role="dialog"] button')].find(e => e.textContent === 'Confirmar e solicitar'); button.click(); button.click() })
  await page.waitForFunction(() => document.body.textContent.includes('Falha sintética controlada'))
  assert.equal(await page.evaluate(() => window.__qa.requests.length), 1)
  assert.equal(await page.evaluate(() => window.__qa.refresh), 1)
  report.checks.push({ name: 'details_cancel_review_confirmation_double_click_single_flight_and_error_feedback' })
  await page.evaluate(() => window.mount('reader'))
  await page.waitForFunction(() => document.body.textContent.includes('sem iniciar novas solicitações'))
  assert(await page.$eval('button[aria-label^="Solicitar novamente"]', e => e.disabled))
  assert(await page.evaluate(() => [...document.querySelectorAll('button')].find(e => e.textContent.startsWith('Revisar e solicitar')).disabled))
  assert.equal(await page.evaluate(() => window.__qa.requests.length), 0)
  await page.evaluate(() => window.mount('empty'))
  await page.waitForFunction(() => document.body.textContent.includes('Nenhum pedido corresponde aos filtros'))
  assert(await page.$('a[href*="pagina=1"]'))
  report.checks.push({ name: 'leitor_has_no_request_actions_and_filtered_empty_preserves_clear_action' })
  assert.equal(report.externalRequests.length, 0); assert.equal(report.errors.length, 0)
} catch (error) { report.error = { name: error.name, message: error.message }; process.exitCode = 1 }
finally {
  if (browser) { await browser.close(); report.browserClosed = true }
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, passed: !report.error, checks: report.checks.length, externalRequests: report.externalRequests, errors: report.errors, browserClosed: report.browserClosed, error: report.error }))
}
