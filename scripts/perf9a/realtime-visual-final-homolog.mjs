#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { generateTotp } from './dataset.mjs'
import { assertHomologEnvironment, createAdminClient, getPerf9aLocalDir, loadEnvFile, writeRestrictedJson } from './common.mjs'

const baseUrl = String(process.argv.find((value) => value.startsWith('--base-url='))?.split('=')[1] || 'http://localhost:3001').replace(/\/$/, '')
await main().catch((error) => { console.error(`Realtime visual 9A.3 falhou: ${safe(error)}`); process.exitCode = 1 })

async function main() {
  loadEnvFile('.env.homolog'); const env = assertHomologEnvironment(); const admin = createAdminClient(env)
  const credentials = JSON.parse(readFileSync(resolve(getPerf9aLocalDir('credentials'), `users-${env.projectRef}.json`), 'utf8'))
  const users = new Map(credentials.users.map((user) => [user.key, user])); const userA = users.get('gestor_multi'); const userB = users.get('gestor_b')
  const { data: before, error: beforeError } = await admin.from('notificacoes').select('id,lida').eq('usuario_id', userA.id)
  if (beforeError) throw beforeError
  const title = `PERF9A3_REALTIME_${Date.now()}`
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, protocolTimeout: 120_000, args: ['--no-sandbox'] })
  let fixtureId = null
  const checks = []; const latencies = []; const errors = []
  try {
    const contextA = await browser.createBrowserContext(); const contextB = await browser.createBrowserContext()
    const pageA = await contextA.newPage(); const pageA2 = await contextA.newPage(); const pageB = await contextB.newPage()
    for (const page of [pageA, pageA2, pageB]) page.on('pageerror', (error) => errors.push(safe(error)))
    console.log('Realtime visual: autenticando sessões A/B...')
    await login(pageA, userA); await login(pageB, userB)
    console.log('Realtime visual: abrindo páginas independentes...')
    await pageA.goto(`${baseUrl}/gestor/notificacoes`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await pageA2.goto(`${baseUrl}/gestor/notificacoes`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await pageB.goto(`${baseUrl}/gestor/notificacoes`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await new Promise((done) => setTimeout(done, 1_000))

    const insertedAt = Date.now()
    const { data: fixture, error: insertError } = await admin.from('notificacoes').insert({ usuario_id: userA.id, titulo: title, mensagem: 'Evento temporário de homologação visual.', tipo: 'info', lida: false, dedupe_key: title }).select('id,created_at').single()
    if (insertError) throw insertError; fixtureId = fixture.id
    await pageA.waitForFunction((value) => document.body.innerText.includes(value), { timeout: 10_000 }, title)
    latencies.push({ event: 'insert_visual_A', ms: Date.now() - insertedAt })
    checks.push(check('A recebeu INSERT', await contains(pageA, title)))
    checks.push(check('segunda aba de A recebeu INSERT', await contains(pageA2, title)))
    checks.push(check('B não recebeu INSERT', !(await contains(pageB, title))))

    const card = await pageA.waitForFunction((value) => [...document.querySelectorAll('p')].find((node) => node.textContent?.includes(value))?.closest('[data-slot="card"]') || null, { timeout: 10_000 }, title)
    if (!card) throw new Error('Card temporário não localizado para marcação individual.')
    const button = await card.evaluateHandle((node) => [...node.querySelectorAll('button')].find((item) => item.textContent?.includes('Marcar como lida')))
    const oneStarted = Date.now(); await button.click(); await waitDb(admin, fixtureId, true)
    latencies.push({ event: 'marcar_uma', ms: Date.now() - oneStarted }); checks.push(check('marcar uma persistiu', true))

    await admin.from('notificacoes').update({ lida: false }).eq('id', fixtureId); await new Promise((done) => setTimeout(done, 400))
    const allStarted = Date.now(); await pageA.getByText?.('Marcar todas como lidas')
    await pageA.evaluate(() => [...document.querySelectorAll('button')].find((node) => node.textContent?.includes('Marcar todas como lidas'))?.click())
    await waitAllRead(admin, userA.id)
    latencies.push({ event: 'marcar_todas', ms: Date.now() - allStarted }); checks.push(check('marcar todas persistiu', true))

    await restore(admin, before)
    checks.push(check('estado lida restaurado', await sameState(admin, userA.id, before)))

    await pageA.setOfflineMode(true); await new Promise((done) => setTimeout(done, 300)); await pageA.setOfflineMode(false)
    await pageA.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }); checks.push(check('reconexão sem 500', !(await contains(pageA, 'Application error'))))
    await pageA.goto(`${baseUrl}/gestor/dashboard`, { waitUntil: 'domcontentloaded', timeout: 45_000 }); await pageA.goto(`${baseUrl}/gestor/notificacoes`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    checks.push(check('troca de rota preserva página', (await pageA.title()).length > 0))

    const deleteStarted = Date.now(); await admin.from('notificacoes').delete().eq('id', fixtureId); fixtureId = null
    await pageA.waitForFunction((value) => !document.body.innerText.includes(value), { timeout: 10_000 }, title)
    latencies.push({ event: 'delete_visual_A', ms: Date.now() - deleteStarted }); checks.push(check('DELETE refletiu visualmente', true))
    await contextA.close(); await contextB.close()
  } finally {
    if (fixtureId) await admin.from('notificacoes').delete().eq('id', fixtureId)
    await restore(admin, before).catch(() => {})
    await browser.close()
  }
  const status = checks.every((item) => item.status === 'PASSOU') && errors.length === 0 ? 'APROVADO_NOS_CENARIOS_EXECUTADOS' : 'FALHOU'
  const evidencePath = resolve(getPerf9aLocalDir('evidence'), `realtime-visual-escopo9a3-${env.projectRef}-${stamp()}.json`)
  writeRestrictedJson(evidencePath, { scope: '9A.3', gate: 'realtime-visual', baseUrl, executedAt: new Date().toISOString(), users: ['gestor_multi', 'gestor_b'], status, checks, latencies, errors, restoration: 'Estado lida de todas as notificações de gestor_multi restaurado; fixture removida.' })
  console.log(`Realtime visual: ${status}. Evidência local restrita: ${evidencePath}`)
}

async function login(page, user) {
  console.log(`Realtime visual: login ${user.key}...`)
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 45_000 }); await page.waitForSelector('#email', { timeout: 45_000 }); await page.type('#email', user.email); await page.type('#password', user.password)
  await page.click('button[type="submit"]'); await waitPathChange(page, '/login')
  if (new URL(page.url()).pathname === '/mfa/desafio') { console.log(`Realtime visual: AAL2 ${user.key}...`); await page.waitForSelector('input[name="code"]'); await page.type('input[name="code"]', generateTotp(user.totpSecret)); await page.click('form button[type="submit"]'); await waitPathChange(page, '/mfa/desafio') }
  console.log(`Realtime visual: sessão ${user.key} pronta.`)
}
async function waitPathChange(page, previous) { for (let i = 0; i < 90; i += 1) { if (new URL(page.url()).pathname !== previous) return; await new Promise((done) => setTimeout(done, 500)) } throw new Error(`Timeout aguardando saída de ${previous}.`) }
async function contains(page, text) { return page.evaluate((value) => document.body.innerText.includes(value), text) }
async function waitDb(admin, id, expected) { for (let i = 0; i < 20; i += 1) { const { data } = await admin.from('notificacoes').select('lida').eq('id', id).single(); if (data?.lida === expected) return; await new Promise((done) => setTimeout(done, 100)) } throw new Error('Timeout aguardando persistência da notificação.') }
async function waitAllRead(admin, userId) { for (let i = 0; i < 30; i += 1) { const { count } = await admin.from('notificacoes').select('id', { head: true, count: 'exact' }).eq('usuario_id', userId).eq('lida', false); if (count === 0) return; await new Promise((done) => setTimeout(done, 100)) } throw new Error('Timeout aguardando marcação de todas.') }
async function restore(admin, rows) { for (const state of [false, true]) { const ids = rows.filter((row) => row.lida === state).map((row) => row.id); for (let i = 0; i < ids.length; i += 100) { const { error } = await admin.from('notificacoes').update({ lida: state }).in('id', ids.slice(i, i + 100)); if (error) throw error } } }
async function sameState(admin, userId, before) { const { data } = await admin.from('notificacoes').select('id,lida').eq('usuario_id', userId); const expected = new Map(before.map((row) => [row.id, row.lida])); return data?.filter((row) => expected.has(row.id)).every((row) => expected.get(row.id) === row.lida) ?? false }
function check(name, passed) { return { name, status: passed ? 'PASSOU' : 'FALHOU' } }
function safe(error) { return (error instanceof Error ? error.message : String(error)).replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>') }
function stamp() { return new Date().toISOString().replaceAll(':', '-') }
