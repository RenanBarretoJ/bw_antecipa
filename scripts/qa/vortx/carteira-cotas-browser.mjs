// Real component + canonical config helper, synthetic props only. No Auth/API/DB calls.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = resolve(root, 'rehearsal/reports', `vortx-cotas-ui-${Date.now()}`)
mkdirSync(output, { recursive: true })
const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild')
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {VortxCotasEsperadas,VortxCotasEsperadasResumo} from '@/components/admin/vortx-cotas-esperadas';
import {prepararConfiguracaoCarteiraVortx} from '@/lib/integracoes/vortx/carteira-configuracao';
function Fixture({invalid}){
 const [saved,setSaved]=useState(invalid?{codigo_carteira:'QA-VRS',carteira_consolidada:null}:{codigo_carteira:'QA-VRS'});
 const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <><h1>Cotas esperadas · QA local</h1><p>Fixture sintética. Sem persistência em banco ou chamadas externas.</p>
 <form onSubmit={event=>{event.preventDefault();try{const form=new FormData(event.currentTarget);const next=prepararConfiguracaoCarteiraVortx(saved,JSON.parse(String(form.get('carteiraConsolidada'))));window.qa.saved.push(next);setSaved(next);setError('')}catch{setError('Lista inválida; nada salvo.')}}}>
 <VortxCotasEsperadas key={revision} configuracao={saved} pending={busy}/><button type="submit">Salvar rascunho QA</button></form>
 {error&&<p role="alert">{error}</p>}<button type="button" onClick={()=>setRevision(value=>value+1)}>Reabrir rascunho</button>
 <button type="button" onClick={()=>setBusy(value=>!value)}>Simular processamento</button>
 <VortxCotasEsperadasResumo configuracao={saved}/></>;
}
const app=createRoot(document.getElementById('root'));let revision=0;
window.mount=(mode='normal')=>{window.qa={saved:[]};app.render(<Fixture key={++revision} invalid={mode==='invalid'}/>)};window.mount();`
const bundle = await build({ absWorkingDir: root, bundle: true, write: false, format: 'iife', jsx: 'automatic',
  stdin: { contents: entry, loader: 'jsx', resolveDir: root }, alias: { '@': resolve(root, 'src') },
  define: { 'process.env.NODE_ENV': '"production"' },
})
const css = (await postcss([tailwind()]).process(readFileSync(resolve(root, 'src/app/globals.css'), 'utf8'), { from: resolve(root, 'src/app/globals.css') })).css
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}:root{--font-inter:Arial}#root{max-width:1000px;margin:auto;padding:24px}</style></head><body class="bg-background text-foreground"><main id="root"></main><script src="/app.js"></script></body></html>`
const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text) }
  else if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html) }
  else { res.writeHead(404); res.end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const report = { scope: 'LOCAL_COMPONENT_AND_CONFIG_HELPER_ONLY', authenticatedSmoke: false, databasePersistence: false,
  sourceHashes: ['src/components/admin/vortx-cotas-esperadas.tsx', 'src/lib/integracoes/vortx/carteira-configuracao.ts'].map(path => ({ path, sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') })),
  checks: [], errors: [], externalRequests: [], result: 'RUNNING', browserClosed: false, serverClosed: false }
let browser, page
try {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  page = await browser.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', req => {
    if (new URL(req.url()).origin !== origin) { report.externalRequests.push(new URL(req.url()).origin); req.abort() }
    else req.continue()
  })
  const press = text => page.evaluate(text => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent === text)
    if (!button || button.matches(':disabled')) throw new Error('BUTTON_UNAVAILABLE')
    button.click()
  }, text)
  async function fill(placeholder, index, value) {
    const fields = await page.$$(`input[placeholder="${placeholder}"]`)
    assert(fields[index], 'FIELD_REQUIRED')
    await fields[index].focus()
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control')
    await page.keyboard.press('Backspace'); await fields[index].type(value)
    assert.equal(await fields[index].evaluate(field => field.value), value, 'INPUT_REPLACEMENT_MUST_MATCH_FIXTURE')
  }
  await page.goto(origin, { waitUntil: 'networkidle0' })
  await page.waitForSelector('input[name=carteiraConsolidada]')
  assert.equal(await page.$eval('input[name=carteiraConsolidada]', e => e.value), 'null')
  await page.click('input[type=checkbox]')
  await press('Adicionar cota'); await press('Adicionar cota')
  await page.waitForFunction(() => JSON.parse(document.querySelector('input[name=carteiraConsolidada]').value).cotas.length === 3)
  for (const [index, codigo, rotulo] of [[0, 'QA-SR', 'Cota sênior'], [1, 'QA-MZ', 'Cota mezanino'], [2, 'QA-SUB', 'Cota subordinada']]) {
    await fill('Ex.: 12345', index, codigo); await fill('Ex.: Cota subordinada', index, rotulo)
  }
  await press('Salvar rascunho QA')
  await page.waitForFunction(() => window.qa.saved.length === 1)
  const saved = await page.evaluate(() => window.qa.saved[0])
  assert.equal(saved.codigo_carteira, 'QA-VRS'); assert.equal(saved.carteira_consolidada.cotas.length, 3)
  await press('Reabrir rascunho')
  await page.waitForFunction(() => document.querySelector('input[placeholder="Ex.: 12345"]').value === 'QA-SR')
  report.checks.push('SAVE_AND_REOPEN_THREE_QUOTES_WITH_SEPARATE_VRS_CODE')
  await fill('Ex.: 12345', 1, 'QA-SR')
  await page.waitForFunction(() => document.querySelectorAll('[aria-invalid=true]').length === 2)
  await press('Salvar rascunho QA')
  await page.waitForFunction(() => [...document.querySelectorAll('[role=alert]')].some(e => e.textContent.includes('nada salvo')))
  assert.equal(await page.evaluate(() => window.qa.saved.length), 1)
  report.checks.push('DUPLICATES_SHOW_INLINE_ERRORS_AND_DO_NOT_SAVE')
  await fill('Ex.: 12345', 1, 'QA-MZ')
  await page.click('button[aria-label="Remover cota 2"]')
  await page.waitForFunction(() => JSON.parse(document.querySelector('input[name=carteiraConsolidada]').value).cotas.length === 2)
  await page.waitForFunction(() => document.querySelector('input[placeholder="Ex.: 12345"]') === document.activeElement, { timeout: 5000 })
  await press('Reabrir rascunho')
  await page.waitForFunction(() => JSON.parse(document.querySelector('input[name=carteiraConsolidada]').value).cotas.length === 3)
  report.checks.push('REMOVAL_RESTORES_FOCUS_AND_UNSAVED_EDITS_DO_NOT_CHANGE_SNAPSHOT')
  await press('Simular processamento')
  assert(await page.$eval('input[type=checkbox]', e => e.matches(':disabled')))
  await press('Simular processamento')
  report.checks.push('PENDING_DISABLES_EDITOR')
  for (const width of [375, 768, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 900 })
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await page.evaluate(theme => { document.documentElement.className = theme === 'dark' ? 'dark' : '' }, theme)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'HORIZONTAL_OVERFLOW')
    assert.equal(await page.$$eval('input:not([type=hidden])', fields => fields.filter(e => !e.labels?.length).length), 0)
    await page.screenshot({ path: resolve(output, `cotas-${width}-${theme}.png`), fullPage: true })
    report.checks.push(`RESPONSIVE_LABELS_REDUCED_MOTION_${width}_${theme}`)
  }
  await page.click('input[type=checkbox]'); await press('Salvar rascunho QA')
  await page.waitForFunction(() => window.qa.saved.length === 2)
  assert.deepEqual(await page.evaluate(() => window.qa.saved[1]), { codigo_carteira: 'QA-VRS' })
  report.checks.push('EXPLICIT_REMOVAL_KEEPS_VRS_AND_DOES_NOT_INFER_QUOTES')
  await page.evaluate(() => window.mount('invalid'))
  await page.waitForFunction(() => document.body.textContent.includes('não será apagada'))
  await press('Salvar rascunho QA')
  await page.waitForFunction(() => document.body.textContent.includes('nada salvo'))
  assert.equal(await page.evaluate(() => window.qa.saved.length), 0)
  await press('Corrigir lista de cotas')
  await page.waitForSelector('input[placeholder="Ex.: 12345"]')
  report.checks.push('INVALID_SAVED_CONFIG_REQUIRES_EXPLICIT_REPAIR')
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, [])
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'; report.error = error.message; process.exitCode = 1
  report.errorStack = error.stack
  if (page) {
    report.diagnostic = await page.evaluate(() => ({
      inputs: [...document.querySelectorAll('input')].map(e => ({ id: e.id, name: e.name, value: e.value, invalid: e.getAttribute('aria-invalid') })),
      text: document.body.textContent, activeElement: document.activeElement?.id, saved: window.qa.saved,
    }))
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
  }
} finally {
  if (browser) { await browser.close(); report.browserClosed = true }
  await new Promise(done => server.close(done)); report.serverClosed = true
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ result: report.result, output, checks: report.checks.length, error: report.error, browserClosed: report.browserClosed, serverClosed: report.serverClosed }))
}
