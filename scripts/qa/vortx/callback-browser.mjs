// Real browser, isolated component and synthetic actions. Not hosted authenticated E2E.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild')
const output = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-callback-ui-20261019', `browser-${Date.now()}`)
mkdirSync(output, { recursive: true })
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const status = { id, revisao: 1, ativo: true, carteira: 'CARTEIRA-SINTETICA-COM-IDENTIFICADOR-LONGO', ambiente: 'producao', geradaEm: '2026-10-19T20:00:00Z', cadastroInformadoEm: null, ultimoEventoEm: null }
const mock = `export async function obterCallbackVortx(){window.qa.reads++;return window.qa.status}
export async function alterarCallbackVortx(input){window.qa.calls.push({...input,mfaCode:'[SYNTHETIC_REDACTED]'});await new Promise(r=>setTimeout(r,250));if(window.qa.mode==='error')return{success:false,message:'Código TOTP inválido.'};const generation=input.acao==='gerar'||input.acao==='rotacionar';const s={...window.qa.status.status,id:'${id}',ativo:input.acao!=='revogar',revisao:input.revisao+1};return{success:true,message:generation?'URL gerada. Envie à Vórtx.':'Estado atualizado.',status:s,habilitado:true,bloqueio:null,...generation?{urlUnica:'https://example.invalid/api/integracoes/vortx/relatorios/callback?endpoint=${id}&token='+'f'.repeat(64)}:{}}}`
const bundle = await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{VortxCallbackSection}from'./src/components/admin/vortx-callback-section';const mode=new URLSearchParams(location.search).get('mode')||'empty';window.qa={mode,calls:[],reads:0,status:{success:true,message:'',status:{...${JSON.stringify(status)},...mode==='empty'||mode==='error'?{id:null,revisao:0,ativo:false,geradaEm:null}:{}},habilitado:mode!=='disabled',bloqueio:mode==='disabled'?'A geração depende da liberação técnica do endereço público e da proteção do segredo nos logs desta Preview.':null}};createRoot(document.getElementById('root')).render(<VortxCallbackSection fundoId='${id}' versaoId={mode==='unpublished'?undefined:'${id}'}/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'synthetic-actions', setup(b) {
  b.onResolve({ filter: /^@\/app\/admin\/fundos\/callback-vortx-actions$/ }, () => ({ path: 'actions', namespace: 'qa' }))
  b.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: mock, loader: 'js' }))
} }] })
const css = (await postcss([tailwind()]).process(readFileSync('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })).css
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
  res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}:root{--font-inter:Arial}</style></head><body class="bg-background text-foreground"><main id="root" class="mx-auto max-w-4xl p-4"></main><script src="/app.js"></script></body></html>`)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
const checks = [], errors = []; let browser
try {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  page.on('pageerror', e => errors.push(e.message)); await page.setRequestInterception(true)
  page.on('request', req => req.url().startsWith(base) ? req.continue() : req.abort())
  // Puppeteer maps clipboard-write to clipboardReadWrite; text writes require this separate permission.
  await browser.defaultBrowserContext().overridePermissions(base, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'])
  async function press(text) {
    const handle = await page.evaluateHandle(t => [...(document.querySelector('[role=dialog]') ?? document).querySelectorAll('button')].find(b => b.textContent.includes(t)), text)
    const button = handle.asElement(); assert(button, `BUTTON_NOT_FOUND:${text}`)
    await button.click(); await handle.dispose()
  }
  async function visit(mode) { await page.goto(`${base}/?mode=${mode}`, { waitUntil: 'networkidle0' }); if (mode !== 'unpublished') await page.waitForFunction(() => !document.querySelector('[role=status]')?.textContent.includes('Consultando')) }
  // Exercise the real component with a safe readiness DTO; never inject a URL secret.
  async function riskWarning() {
    await page.evaluate(() => { window.qa.status.avisoRisco = 'Exceção autorizada somente nesta Preview: a URL contém um segredo que pode aparecer nos logs da hospedagem. O mascaramento não foi comprovado.' })
    await press('Atualizar estado')
    await page.waitForSelector('[role=note][aria-label="Risco aceito na Preview"]')
    assert((await page.$eval('[role=note]', e => e.textContent)).includes('mascaramento não foi comprovado'))
    assert(await page.$$eval('button', buttons => !buttons.find(b => b.textContent.includes('Rotacionar'))?.disabled))
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.equal(await page.evaluate(() => window.qa.calls.length), 0)
  }
  for (const [width, height, dark] of [[1440, 1000, false], [375, 812, true], [812, 375, false]]) {
    await page.setViewport({ width, height }); await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    for (const mode of ['empty', 'active', 'disabled', 'unpublished']) {
      await visit(mode); await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'HORIZONTAL_OVERFLOW')
      assert.equal(await page.evaluate(() => window.qa.calls.length), 0)
      if (mode === 'unpublished') assert((await page.$eval('body', e => e.textContent)).includes('Publique a integração'))
      if (mode === 'disabled') assert(await page.$$eval('button', buttons => buttons.find(b => b.textContent.includes('Rotacionar'))?.getAttribute('aria-disabled') === 'true' || buttons.find(b => b.textContent.includes('Rotacionar'))?.disabled))
      await page.screenshot({ path: resolve(output, `${mode}-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true })
      checks.push(`${mode}-${width}:responsive-no-auto-mutation`)
    }
  }
  for (const [width, height, dark] of [[1440, 1000, false], [375, 812, true], [812, 375, false]]) {
    await page.setViewport({ width, height }); await visit('active')
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark)
    await riskWarning()
    await page.screenshot({ path: resolve(output, `risk-accepted-${width}.png`), fullPage: true })
    checks.push(`risk-accepted-${width}:visible-warning-enabled-no-auto-mutation`)
  }
  await page.setViewport({ width: 375, height: 812 })
  for (const mode of ['empty', 'active']) {
    await visit(mode); await press(mode === 'empty' ? 'Gerar URL de callback' : 'Rotacionar e gerar')
    await page.waitForSelector('[role=dialog]'); assert(await page.$eval('#admin-sensitive-mfa', e => e.getAttribute('autocomplete') === 'one-time-code'))
    if (mode === 'active') assert((await page.$eval('[role=dialog]', e => e.textContent)).includes('anterior deixa de funcionar imediatamente'))
    await page.type('#admin-sensitive-mfa', '123456')
    await page.evaluate(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find(b => /Gerar URL|Rotacionar e gerar/.test(b.textContent)); b.click(); b.click() })
    await page.waitForSelector('#vortx-callback-url')
    assert.equal(await page.evaluate(() => window.qa.calls.length), 1)
    assert.equal(await page.$eval('#vortx-callback-url', e => e.type), 'password')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await press('Copiar URL'); await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(e => e.textContent.includes('área de transferência')))
    await press('Mostrar URL'); assert.equal(await page.$eval('#vortx-callback-url', e => e.type), 'text')
    await press('Ocultar URL'); await page.screenshot({ path: resolve(output, `${mode}-secret-masked-375.png`), fullPage: true })
    await press('Concluir e ocultar'); await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
    assert(!(await page.content()).includes('f'.repeat(64)), 'SECRET_REMAINS_IN_DOM')
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage)), '{}{}')
    const calls = await page.evaluate(() => window.qa.calls.length); await press('Atualizar estado'); assert.equal(await page.evaluate(() => window.qa.calls.length), calls)
    checks.push(`${mode}:totp-confirm-double-click-one-secret-copy-discard-no-storage`)
  }
  await visit('error'); await press('Gerar URL de callback'); await page.waitForSelector('#admin-sensitive-mfa'); await page.type('#admin-sensitive-mfa', '123456'); await press('Gerar URL')
  await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.includes('TOTP inválido'))
  assert(await page.$('[role=dialog]')); assert.equal(await page.$('#vortx-callback-url'), null); checks.push('totp-error-retained-inline-no-secret')
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
  await visit('active'); await press('Revogar recebimento'); await page.waitForSelector('#admin-sensitive-mfa'); await page.type('#admin-sensitive-mfa', '123456');
  await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.includes('Revogar recebimento'))?.click())
  await page.waitForFunction(() => document.body.textContent.includes('Recebimento revogado')); checks.push('revocation-confirmed-no-secret-modal')
  assert.deepEqual(errors, [])
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify({ scope: 'LOCAL_SYNTHETIC_COMPONENT_ONLY', authenticatedSmoke: false, checks, errors }, null, 2))
  console.log(JSON.stringify({ output, checks: checks.length, errors }))
} catch (error) {
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify({ scope: 'LOCAL_SYNTHETIC_COMPONENT_ONLY', passed: false, checks, errors, failure: { name: error.name, message: error.message } }, null, 2))
  throw error
} finally { if (browser) await browser.close(); await new Promise(r => server.close(r)) }
