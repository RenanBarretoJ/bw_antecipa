// Local browser rehearsal with synthetic data and mocked server boundaries.
// Run after: node node_modules/next/dist/bin/next build --webpack
// No Supabase/provider traffic; screenshots/results remain in ignored rehearsal/.
import assert from 'node:assert/strict'
import { build } from '../../node_modules/tsx/node_modules/esbuild/lib/main.js'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import puppeteer from 'puppeteer-core'

const mocks = {
  'configuracoes-tecnicas-actions': [
    "export const salvarIntegracaoRascunhoAdmin=async(input)=>window.qa.save(input);",
    ...['ativarCredencialAdmin','desativarIntegracaoAdmin','publicarIntegracaoAdmin','revogarCredencialAdmin','testarIntegracaoAdmin'].map(n => 'export const '+n+'=async()=>({success:true,message:"QA local"});'),
  ].join('\n'),
  'vortx-vrs-actions': ['configurarCredencialVortxVrsAdmin','testarConexaoVortxVrsAdmin'].map(n => 'export const '+n+'=async()=>({success:true,message:"QA local"});').join('\n'),
  'notification-provider': 'export const useNotifications=()=>({fromActionResult(){},warning(){},error(){}});',
  'next/navigation': 'export const useRouter=()=>({refresh(){window.qa.refresh()}});',
  'next/link': 'export default function Link({children,...props}){return <a {...props}>{children}</a>}',
}
const fixture = {
 fundo: { id:'00000000-0000-4000-8000-000000000001', nome:'QA', cnpj:'98000000000168', ativo:true },
 integracoes:[], credenciais:[], cnab:[], execucoes:[], execucoes_total:0,
}
const c={id:'00000000-0000-4000-8000-000000000003',integracao_fundo_id:null,fundo_id:fixture.fundo.id,provider_key:'SINQIA',credential_type:'usuario_senha',capabilities:['ESTOQUE'],ambiente:'homologacao',nome:'QA compativel',status:'ativa',revogada_em:null,criada_em:'2026-10-01T00:00:00Z',created_at:'',updated_at:'',ativada_em:null,substituida_por:null,ultimo_uso_em:null,usuario_mascarado:'q*',chave_versao:'qa'}
fixture.credenciais=[c,{...c,id:'wrong-env',ambiente:'producao',nome:'Nao exibir ambiente'},{...c,id:'wrong-provider',provider_key:'OUTRO',nome:'Nao exibir provider'},{...c,id:'inactive',status:'revogada',nome:'Nao exibir revogada'}]
const harness = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {FundoIntegracoesTecnicas} from '@/components/admin/fundo-integracoes-tecnicas';
let state=${JSON.stringify(fixture)}; const root=createRoot(document.getElementById('app'));
const render=()=>root.render(<FundoIntegracoesTecnicas state={state} execPage={1} vortxConfig={[]}/>);
window.qa={ fail:true, calls:0, refresh:render, save:async(input)=>{
 window.qa.calls++; window.qa.contract={inline:!!input.novaCredencial,caps:input.capabilities,provider:input.providerKey};
 if(window.qa.fail)return {success:false,message:'Falha QA esperada'};
 const id='00000000-0000-4000-8000-000000000005',vid='00000000-0000-4000-8000-000000000006',cid='00000000-0000-4000-8000-000000000007';
 const credential={...state.credenciais[0],id:cid,integracao_fundo_id:id,status:'rascunho',nome:'QA preparada',capabilities:input.capabilities};
 const version={id:vid,versao:1,status:'rascunho',adapter_key:input.adapterKey,capabilities:input.capabilities,active_capabilities:[],ambiente:input.ambiente,endpoint_base:input.endpointBase,identificador_cliente:input.identificadorCliente,credencial_integracao_id:cid,configuracao_nao_sensivel:{},updated_at:'2026-10-01T12:00:00Z'};
 state={...state,credenciais:[...state.credenciais,credential],integracoes:[{id,provider_key:'SINQIA',system_name:'Portal FIDC',status:'rascunho',versoes:[version]}]};
 return {success:true,message:'QA salva',data:{id:vid,integrationId:id}};
}};
render();
`
const result=await build({stdin:{contents:harness,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',alias:{'@':resolve('src')},plugins:[{name:'qa-only-boundaries',setup(b){b.onResolve({filter:/.*/},args=>{const key=Object.keys(mocks).find(k=>args.path===k||args.path.endsWith('/'+k));if(key)return{path:key,namespace:'qa'}});b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:process.cwd()}))}}]})
const css=readdirSync('.next/static/css',{recursive:true}).filter(p=>p.endsWith('.css')).map(p=>readFileSync(resolve('.next/static/css',p),'utf8')).join('\n')
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body class="bg-background text-foreground"><main id="app" style="max-width:1200px;margin:auto;padding:16px"></main><script>'+result.outputFiles[0].text+'</script></body></html>'
const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(html)})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await puppeteer.launch({executablePath:process.env.QA_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const report=[]
async function click(page,label){await page.evaluate(label=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===label);if(!button)throw Error('Missing button '+label);button.click()},label)}
try {
 for(const width of [390,430,820,1440,1920]) for(const theme of ['light','dark']){
  const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.setViewport({width,height:1000});await page.goto('http://127.0.0.1:'+server.address().port)
  await page.waitForSelector('button');await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme)
  await click(page,'Nova integracao')
  await page.waitForSelector('select[name=adapterKey]');await page.select('select[name=adapterKey]','sinqia_portal_fidc')
  const options=await page.$$eval('select[name=credencialIntegracaoId] option',os=>os.map(o=>o.text))
  assert.deepEqual(options,['Configurar depois','QA compativel · ativa'])
  assert.equal(await page.$$eval('input[name=capabilities]',els=>els.length),4)
  assert.equal(await page.$$eval('input[name=credentialCapabilities]',els=>els.length),0)
  await page.click('input[name=capabilities][value=ESTOQUE]')
  await click(page,'Configurar usuario e senha');await page.waitForSelector('input[name=senha]')
  const layout=await page.evaluate(()=>{
    const field=document.querySelector('input[name=senha]').closest('fieldset'),card=field.closest('[data-slot=card]');
    return {overflow:document.documentElement.scrollWidth>innerWidth+1,contained:field.getBoundingClientRect().bottom<=card.getBoundingClientRect().bottom+1,nestedForms:document.querySelectorAll('form form').length,oldCard:document.body.innerText.includes('Credenciais do fundo')}
  })
  assert.deepEqual(layout,{overflow:false,contained:true,nestedForms:0,oldCard:false})
  await page.type('input[name=usuario]','qa-local')
  await page.evaluate(()=>{document.querySelector('input[name=senha]').value=crypto.randomUUID();document.querySelector('input[name=mfaCode]').value='123456'})
  await click(page,'Salvar rascunho');await page.waitForFunction(()=>window.qa.calls===1)
  assert.equal(await page.$eval('input[name=usuario]',e=>e.value),'qa-local')
  await page.evaluate(()=>window.qa.fail=false)
  await click(page,'Salvar rascunho')
  await page.waitForFunction(()=>window.qa.calls===2&&!document.querySelector('input[name=senha]'))
  assert.deepEqual(await page.evaluate(()=>window.qa.contract),{inline:true,caps:['ESTOQUE'],provider:'SINQIA'})
  assert.equal(await page.$eval('select[name=credencialIntegracaoId]',e=>e.value),'00000000-0000-4000-8000-000000000007')
  await click(page,'Substituir / rotacionar credencial');await page.waitForSelector('input[name=usuario]')
  await page.type('input[name=usuario]','descartar-ao-trocar')
  await page.select('select[name=ambiente]','producao')
  assert.equal(await page.$('input[name=senha]'),null)
  await page.select('select[name=adapterKey]','vortx_vrs')
  await click(page,'Configurar credencial')
  assert.equal(await page.$$eval('input[type=file]',e=>e.length),2)
  assert.equal(await page.$$eval('input[type=password]',e=>e.length),2)
  assert.equal(await page.$$eval('form form',e=>e.length),0)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  assert.deepEqual(errors,[])
  if(width===390||width===1440){mkdirSync('rehearsal/reports/inline-credential-ui',{recursive:true});await page.screenshot({path:'rehearsal/reports/inline-credential-ui/'+width+'-'+theme+'.png',fullPage:true})}
  report.push({width,theme,pass:true});await page.close()
 }
 mkdirSync('rehearsal/reports/inline-credential-ui',{recursive:true});writeFileSync('rehearsal/reports/inline-credential-ui/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.length,cases:report}))
}finally{await browser.close();server.close()}
