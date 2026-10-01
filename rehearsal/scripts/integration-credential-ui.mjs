// Local component rehearsal only: server actions and navigation are mocked.
// Run from the repo root after next build. No Supabase or provider traffic.
import { build } from '../../node_modules/tsx/node_modules/esbuild/lib/main.js'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import puppeteer from 'puppeteer-core'

const mocks = {
  'configuracoes-tecnicas-actions': ['ativarCredencialAdmin','cadastrarCredencialAdmin','desativarIntegracaoAdmin','publicarIntegracaoAdmin','revogarCredencialAdmin','salvarIntegracaoRascunhoAdmin','testarIntegracaoAdmin'].map(n => `export const ${n}=async()=>({success:true,message:'QA local'});`).join(''),
  'vortx-vrs-credential-section': 'export const VortxCredentialSection=()=>null;',
  'notification-provider': 'export const useNotifications=()=>({fromActionResult(){},warning(){},error(){}});',
  'next/navigation': 'export const useRouter=()=>({refresh(){}});',
  'next/link': 'export default function Link({children,...props}){return <a {...props}>{children}</a>}',
}
const fixture = {
 fundo: { id:'00000000-0000-4000-8000-000000000001', nome:'QA', cnpj:'98000000000168', ativo:true },
 integracoes:[], credenciais:[], cnab:[], execucoes:[], execucoes_total:0,
}
const c={id:'00000000-0000-4000-8000-000000000003', integracao_fundo_id:null,fundo_id:fixture.fundo.id, provider_key:'SINQIA',credential_type:'usuario_senha',capabilities:['ESTOQUE'],ambiente:'homologacao',nome:'QA compativel',status:'ativa',revogada_em:null, criada_em:'2026-10-01T00:00:00Z',created_at:'',updated_at:'',ativada_em:null,substituida_por:null,ultimo_uso_em:null,usuario_mascarado:'q*',chave_versao:'qa'}
fixture.credenciais=[c,{...c,id:'wrong-env',ambiente:'producao',nome:'Nao exibir ambiente'},{...c,id:'wrong-provider',provider_key:'OUTRO',nome:'Nao exibir provider'},{...c,id:'inactive',status:'revogada',nome:'Nao exibir revogada'}]
const result=await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {FundoIntegracoesTecnicas} from '@/components/admin/fundo-integracoes-tecnicas'; createRoot(document.getElementById('app')).render(<FundoIntegracoesTecnicas state={${JSON.stringify(fixture)}} execPage={1} vortxConfig={[]}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',alias:{'@':resolve('src')},plugins:[{name:'qa-only-boundaries',setup(b){b.onResolve({filter:/.*/},args=>{const key=Object.keys(mocks).find(k=>args.path===k||args.path.endsWith('/'+k));if(key)return{path:key,namespace:'qa'}});b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:process.cwd()}))}}]})
const css=readdirSync('.next/static/css',{recursive:true}).filter(p=>p.endsWith('.css')).map(p=>readFileSync(resolve('.next/static/css',p),'utf8')).join('\n')
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body class="bg-background text-foreground"><main id="app" style="max-width:1200px;margin:auto;padding:16px"></main><script>${result.outputFiles[0].text}</script></body></html>`
const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(html)})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const report=[]
try {
 for(const width of [390,430,820,1440,1920]) for(const theme of ['light','dark']){
  const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.setViewport({width,height:1000});await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForSelector('button');await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme)
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Nova credencial').click())
  await page.waitForSelector('input[name=usuario]',{visible:true})
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Nova integracao').click())
  await page.waitForSelector('select[name=adapterKey]');await page.select('select[name=adapterKey]','sinqia_portal_fidc')
  const check=await page.evaluate(()=>{
    const form=document.querySelector('input[name=usuario]').closest('form'); const select=document.querySelector('select[name=credencialIntegracaoId]');
    const r=form.getBoundingClientRect(); const parent=form.closest('[data-slot=card]').getBoundingClientRect();
    return {options:[...select.options].map(o=>o.text),horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,contained:r.bottom<=parent.bottom+1,formVisible:r.height>0,hasOldBlock:document.body.innerText.includes('Salve a integracao primeiro')}
  })
  const pass=check.options.join('|')==='Nenhuma por enquanto|QA compativel'&&!check.horizontalOverflow&&check.contained&&check.formVisible&&!check.hasOldBlock&&errors.length===0
  report.push({width,theme,pass,...check,errors}); if(!pass)throw Error(JSON.stringify(report.at(-1)))
  if(width===390||width===1440){mkdirSync('rehearsal/reports/credential-ui',{recursive:true});await page.screenshot({path:`rehearsal/reports/credential-ui/${width}-${theme}.png`,fullPage:true})}
  await page.close()
 }
 mkdirSync('rehearsal/reports/credential-ui',{recursive:true});writeFileSync('rehearsal/reports/credential-ui/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.length,cases:report}))
}finally{await browser.close();server.close()}
