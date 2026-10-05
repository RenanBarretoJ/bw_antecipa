// Local component harness only. Synthetic data and mocked actions, no Supabase.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import puppeteer from 'puppeteer-core'

const require=createRequire(import.meta.url)
const {build}=createRequire(require.resolve('tsx/package.json'))('esbuild')

const output=resolve('rehearsal/reports/sacado-ux')
mkdirSync(output,{recursive:true})
const fixture={fundo:{id:'qa',nome:'FUNDO SINTÉTICO QA DE INVESTIMENTO EM DIREITOS CREDITÓRIOS RESPONSABILIDADE LIMITADA'},fundos:[],busca:'',pagina:1,userId:null,pode_editar:true,total:3,
 usuarios:[{id:'qa-user',nome_completo:'Usuário de demonstração QA',email:'usuario.sintetico@example.invalid',status:'ativo',cnpjs_ativos:2},{id:'qa-other',nome_completo:'Segundo usuário QA',email:'outro@example.invalid',status:'inativo',cnpjs_ativos:0},{id:'qa-third',nome_completo:'Terceiro usuário QA',email:'terceiro@example.invalid',status:'ativo',cnpjs_ativos:0}],
 acessos:['ativo','inativo','revogado','ativo'].map((status,i)=>({id:`qa-${i}`,user_id:'qa-user',cnpj:['11344038002141','11344038002060','11344038001765','11344038000106'][i],razao_social:'EMPRESA SINTÉTICA QA COM RAZÃO SOCIAL EXTENSA PARA VALIDAÇÃO DE LAYOUT',status,created_at:'2026-10-05T12:00:00Z',updated_at:'2026-10-05T12:00:00Z'}))}
fixture.fundos=[fixture.fundo]
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {GestaoSacadosView} from './src/components/sacado/GestaoSacadosView';const data=${JSON.stringify(fixture)};const mode=new URLSearchParams(location.search).get('mode');if(mode==='detail'||mode==='readonly')data.userId='qa-user';if(mode==='readonly')data.pode_editar=false;if(mode==='empty'){data.usuarios=[];data.total=0}createRoot(document.getElementById('root')).render(<GestaoSacadosView result={data} basePath='/gestor/sacados'/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'qa-local-boundary',setup(b){
 b.onResolve({filter:/^(next\/link|@\/lib\/actions\/sacado-acessos)$/},args=>({path:args.path,namespace:'qa-mock'}))
 b.onLoad({filter:/.*/,namespace:'qa-mock'},args=>({loader:'jsx',resolveDir:process.cwd(),contents:args.path==='next/link'?"import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}":"export async function consultarEmpresaSacado(){return {success:true,empresa:null}};export async function gerenciarAcessoSacado(){return {success:true,message:'Simulação local: formulário enviado.'}}"}))
}}]})
const css=(await postcss([tailwind()]).process(readFileSync('src/app/globals.css','utf8'),{from:resolve('src/app/globals.css')})).css
const server=createServer((req,res)=>{
 if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n:root{--font-inter:Arial}</style></head><body class="bg-background text-foreground"><main id="root" class="py-8"></main><script src="/app.js"></script></body></html>`)
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const base=`http://127.0.0.1:${server.address().port}`
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const checks=[]
try{
 const page=await browser.newPage(),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.setRequestInterception(true)
 page.on('request',r=>r.url().startsWith(base)?r.continue():r.abort())
 for(const mode of ['list','detail','empty','readonly'])for(const width of [1440,390]){
  await page.setViewport({width,height:1000});await page.goto(`${base}/?mode=${mode}`,{waitUntil:'networkidle0'})
  await page.waitForSelector('h1')
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'HORIZONTAL_OVERFLOW')
  if(mode==='readonly')assert.equal(await page.$('[name="mfa"]'),null)
  await page.screenshot({path:resolve(output,`${mode}-${width}.png`),fullPage:true});checks.push(`${mode}-${width}`)
 }
 await page.goto(`${base}/?mode=detail`,{waitUntil:'networkidle0'})
 await page.click('details summary')
 await page.select('details select[name="acao"]','atualizar_empresa')
 assert.equal(await page.$eval('details [name="razao"]',e=>e.readOnly),false)
 await page.select('details select[name="acao"]','revogar')
 assert.equal(await page.$eval('details [name="razao"]',e=>e.readOnly),true)
 const add='aside form'
 await page.type(`${add} [name="cnpj"]`,'11344038002141');await page.click(`${add} [name="razao"]`)
 await page.waitForFunction(()=>document.querySelector('aside [role="status"]')?.textContent.includes('Empresa ainda'))
 await page.type(`${add} [name="razao"]`,'Empresa sintética QA')
 assert.equal(await page.$eval(add,e=>e.checkValidity()),false)
 await page.click(`${add} [name="confirmacao"]`);await page.type(`${add} [name="mfa"]`,'123456')
 await page.click(`${add} button[type="submit"]`)
 await page.waitForFunction(()=>document.querySelector('aside')?.textContent.includes('Simulação local: formulário enviado.'))
 checks.push('mocked-form-validation-and-action-selection')
 await page.evaluate(()=>document.documentElement.classList.add('dark'))
 await page.screenshot({path:resolve(output,'detail-dark-mobile.png'),fullPage:true})
 assert.deepEqual(errors,[])
 writeFileSync(resolve(output,'result.json'),JSON.stringify({localOnly:true,authenticatedSmoke:false,checks,errors},null,2))
 console.log(JSON.stringify({localOnly:true,checks,errors}))
}finally{await browser.close();await new Promise(r=>server.close(r))}
