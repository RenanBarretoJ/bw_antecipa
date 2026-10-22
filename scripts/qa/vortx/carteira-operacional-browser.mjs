// Actual client component, local CSS and synthetic action responses. No Auth/DB/provider access.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const root = process.cwd(), output = resolve(root, 'rehearsal/reports', `vortx-carteira-operacional-ui-${Date.now()}`)
mkdirSync(output, { recursive: true })
const require = createRequire(import.meta.url), { build } = createRequire(require.resolve('tsx/package.json'))('esbuild')
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {VortxCarteiraOperacional} from '@/components/admin/vortx-carteira-operacional';
const root=createRoot(document.getElementById('root'));let n=0;window.mount=(override={})=>{window.qa={calls:[],refreshes:0};root.render(<VortxCarteiraOperacional key={++n} hoje="2026-10-22" referenciaInicial="2026-10-21" habilitada podeProcessar posicaoInicial={{dataReferencia:'2026-10-20',patrimonioLiquidoTotal:'30.0000',cotas:[{codigoCarteira:'QA',rotulo:'Cota QA',patrimonioLiquido:'30.0000'}]}} {...override}/>)};window.mount();`
const bundle = await build({ absWorkingDir: root, bundle: true, write: false, outfile: 'qa/app.js', format: 'iife', jsx: 'automatic',
  stdin: { contents: entry, loader: 'jsx', resolveDir: root }, alias: { '@': resolve(root, 'src') }, define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'synthetic-action-only', setup(build) {
    build.onResolve({ filter: /^(next\/navigation|@\/app\/gestor\/dados-financeiros\/carteira-actions)$/ }, args => ({ path: args.path, namespace: 'qa' }))
    build.onLoad({ filter: /.*/, namespace: 'qa' }, args => ({ contents: args.path === 'next/navigation'
      ? `export const useRouter=()=>({refresh:()=>window.qa.refreshes++});`
      : `export async function processarCarteiraVortxAction(input){window.qa.calls.push(input);return new Promise(done=>{window.qa.release=done})}` }))
  } }],
})
const globalCss = (await postcss([tailwind()]).process(readFileSync('src/app/globals.css', 'utf8'), { from: resolve(root, 'src/app/globals.css') })).css
const css = globalCss + '\n' + bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n')
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(script) }
  else if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}#root{max-width:1000px;margin:auto;padding:24px}:root{--font-inter:Arial}</style></head><body class="bg-background text-foreground"><main id="root"></main><script src="/app.js"></script></body></html>`) }
  else { res.writeHead(404); res.end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const report = { result: 'RUNNING', scope: 'REAL_COMPONENT_SYNTHETIC_ACTION_ONLY', authenticatedSmoke: false, providerCalls: false, checks: [], externalRequests: [], embeddedResourceSchemes: [], errors: [],
  componentSha256: createHash('sha256').update(readFileSync('src/components/admin/vortx-carteira-operacional.tsx')).digest('hex'), browserClosed: false, serverClosed: false }
let browser, page
try {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  page = await browser.newPage(); page.on('pageerror', error => report.errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', req => {
    const url = new URL(req.url())
    if (url.protocol === 'data:') { report.embeddedResourceSchemes.push(url.protocol); req.continue() }
    else if (url.origin !== origin) { report.externalRequests.push({ protocol: url.protocol, origin: url.origin }); req.abort() }
    else req.continue()
  })
  await page.goto(origin, { waitUntil: 'networkidle0' }); await page.waitForSelector('form button')
  assert.equal(await page.$eval('input', field => field.value), '2026-10-21'); report.checks.push('D1_REFERENCE_INITIAL')
  await page.$eval('form', form => { form.requestSubmit(); form.requestSubmit() })
  await page.waitForFunction(() => window.qa.calls.length === 1 && document.querySelector('form').getAttribute('aria-busy') === 'true')
  assert(await page.$eval('fieldset', field => field.disabled)); report.checks.push('SINGLE_ACTION_PENDING_DOUBLE_SUBMIT_BLOCKED')
  await page.evaluate(() => window.qa.release({ success: true, estado: 'AGUARDANDO_COTAS', dataReferencia: '2026-10-21', cotasPendentes: [{ codigoCarteira: 'SUB', rotulo: 'Subordinada' }] }))
  await page.waitForFunction(() => document.body.textContent.includes('Faltam: Subordinada (SUB)'))
  assert(await page.evaluate(() => document.body.textContent.includes('20/10/2026') && document.body.textContent.includes('Nenhum PL parcial')))
  assert.equal(await page.evaluate(() => window.qa.refreshes), 0); report.checks.push('MISSING_QUOTA_PRESERVES_LAST_PUBLICATION_NOT_SUCCESS')
  await page.click('form button'); await page.waitForFunction(() => window.qa.calls.length === 2)
  await page.evaluate(() => window.qa.release({ success: true, estado: 'PUBLICADA', posicao: { dataReferencia: '2026-10-21', patrimonioLiquidoTotal: '60.0000', cotas: [{ codigoCarteira: 'QA', rotulo: 'Cota QA', patrimonioLiquido: '60.0000' }] } }))
  await page.waitForFunction(() => document.body.textContent.includes('Carteira completa publicada com sucesso.'))
  assert.equal(await page.evaluate(() => window.qa.refreshes), 1); report.checks.push('PUBLICATION_CONFIRMED_REFRESH_AND_CURRENT_PL')
  for (const width of [375, 768, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewport({ width, height: 900 }); await page.evaluate(theme => { document.documentElement.className = theme === 'dark' ? 'dark' : '' }, theme)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'HORIZONTAL_OVERFLOW')
    assert.equal(await page.$$eval('input', fields => fields.filter(field => !field.labels?.length).length), 0)
    await page.screenshot({ path: resolve(output, `carteira-${width}-${theme}.png`), fullPage: true }); report.checks.push(`RESPONSIVE_LABELED_${width}_${theme}`)
  }
  await page.evaluate(() => window.mount({ podeProcessar: false })); await page.waitForFunction(() => document.querySelector('fieldset').disabled)
  assert.equal(await page.evaluate(() => window.qa.calls.length), 0); report.checks.push('READ_ONLY_NO_PROCESSING')
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []); report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.error = error.message; process.exitCode = 1; if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }) }
finally {
  if (browser) { await browser.close(); report.browserClosed = true }
  await new Promise(done => server.close(done)); report.serverClosed = true
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ result: report.result, checks: report.checks.length, output, error: report.error }))
}
