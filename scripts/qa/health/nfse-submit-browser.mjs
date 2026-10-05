// Local browser/component test. Synthetic records; no external network or auth.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild')
const output = resolve('rehearsal/reports/nfse-submit-browser')
mkdirSync(output, { recursive: true })
const fixture = {
  id: 'a1000000-0000-4000-8000-000000000001', cedente_id: 'a1000000-0000-4000-8000-000000000002',
  numero_nf: 'QA-9001', tipo_documento_fiscal: 'NFSE', status: 'rascunho', serie: null, chave_acesso: null,
  data_emissao: '2026-10-02', data_vencimento: '2099-10-15', vencimento_origem: 'MANUAL',
  cnpj_emitente: '11222333000181', razao_social_emitente: 'EMITENTE SINTÉTICO QA',
  cnpj_destinatario: '11444777000161', razao_social_destinatario: 'SACADO SINTÉTICO QA',
  valor_bruto: 1234.56, valor_liquido: null, valor_liquido_origem: 'NAO_INFORMADO',
  valor_icms: 0, valor_iss: 0, valor_pis: 0, valor_cofins: 0, valor_ipi: 0,
  descricao_itens: null, condicao_pagamento: null, arquivo_url: null,
  fiscal_proveniencia: { codigo_verificacao: 'QA-CODE', orgao_emissor: 'MUNICÍPIO QA' },
}
const mocks = {
  'next/navigation': `export const useParams=()=>({id:window.qa.nf.id});export const useRouter=()=>({push:()=>{}});`,
  'next/link': `import React from 'react';export default function Link({children,...p}){return <a {...p}>{children}</a>}`,
  '@/lib/supabase/client': `export function createClient(){return {from(table){const q={select:()=>q,eq:()=>q,neq:()=>q,order:()=>q,limit:()=>q,single:async()=>({data:window.qa.nf}),maybeSingle:async()=>({data:null})};return q}}}`,
  '@/lib/actions/nota-fiscal': `export async function salvarDadosNF(...args){window.qa.saves.push(args);return {success:true}};export async function submeterNF(...args){window.qa.submits.push(args);return {success:true}};export async function resubmeterNFAjustada(){return {success:true}}`,
  '@/lib/actions/arquivo-nota-fiscal': `export async function obterUrlArquivoNotaFiscal(){return {success:false}}`,
  '@/components/notifications/notification-provider': `const api={notify:()=>{}};export const useNotifications=()=>api;`,
  '@/components/documentos-v2/ChecklistCedente': `import React,{useEffect} from 'react';export function ChecklistCedente({onEligibilityChange}){useEffect(()=>onEligibilityChange({elegivel:true,concluidosObrigatorios:1,totalObrigatorios:1}),[onEligibilityChange]);return <p>Checklist QA completo</p>}`,
  '@/components/notas-fiscais/ArquivoOriginalCompacto': `export const ArquivoOriginalCompacto=()=>null`,
  '@/components/historico/HistoricoTimelineCard': `export const HistoricoTimelineCard=()=>null`,
  '@/components/duplicatas/DuplicatasDaNota': `export const DuplicatasDaNota=()=>null`,
  '@/components/notas-fiscais/ParcelasDaNota': `export const ParcelasDaNota=()=>null`,
}
const bundle = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Page from './src/app/cedente/notas-fiscais/[id]/page';window.qa={nf:${JSON.stringify(fixture)},saves:[],submits:[]};if(location.search.includes('nfe')){window.qa.nf.tipo_documento_fiscal='NFE';window.qa.nf.valor_liquido=1234.56};createRoot(document.getElementById('root')).render(<Page/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'isolated-ui-boundaries', setup(b) {
    b.onResolve({ filter: /^(next\/|@\/)/ }, args => mocks[args.path] ? { path: args.path, namespace: 'qa' } : undefined)
    b.onLoad({ filter: /.*/, namespace: 'qa' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: process.cwd() }))
  } }],
})
const css = (await postcss([tailwind()]).process(readFileSync('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })).css
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
  res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}:root{--font-inter:Arial}</style></head><body class="bg-background"><main id="root" class="p-4"></main><script src="/app.js"></script></body></html>`)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
let browser
const checks = []
try {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.setRequestInterception(true)
  page.on('request', r => r.url().startsWith(base) ? r.continue() : r.abort())
  for (const mode of ['nfse', 'nfe']) for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 1000 })
    await page.goto(`${base}/?${mode}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('h1')
    if (mode === 'nfse') {
      assert.equal(await page.$$eval('input,textarea', inputs => inputs.length), 0, 'NFSE_HAS_EDITABLE_OR_HIDDEN_FISCAL_INPUTS')
      const text = await page.$eval('body', el => el.textContent)
      for (const expected of ['Não informado', 'Dados fiscais importados do documento', 'Dados operacionais', 'Informado manualmente', 'QA-CODE']) assert(text.includes(expected))
    }
    await page.screenshot({ path: resolve(output, `${mode}-${width}.png`), fullPage: true })
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Submeter para analise')).click())
    await page.waitForSelector('[role="dialog"]')
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Confirmar submissão')).click())
    await page.waitForFunction(() => window.qa.submits.length === 1)
    const calls = await page.evaluate(() => ({ saves: window.qa.saves.length, submits: window.qa.submits }))
    assert.equal(calls.saves, mode === 'nfse' ? 0 : 1)
    assert.deepEqual(calls.submits, [[{ nfId: fixture.id }]])
    checks.push(`${mode}-${width}:minimal-submit`)
  }
  assert.deepEqual(errors, [])
  const report = { localOnly: true, authenticatedSmoke: false, checks, errors }
  writeFileSync(resolve(output, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  if (browser) await browser.close()
  await new Promise(r => server.close(r))
}
