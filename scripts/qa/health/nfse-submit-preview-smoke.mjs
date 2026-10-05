// Authenticated UI smoke, restricted to the isolated Preview and synthetic actors.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { base, connect, details, loadCredentials, ref, saveCredentials } from './nfse-submit-runtime.mjs'

assert.equal(process.argv.length, 2)
const state = loadCredentials(), d = details(), db = await connect(d)
assert(state.seeded)
const actor = state.actors.cedente
assert(actor.email === 'qa-nfse-submit-cedente@example.invalid')
const client = createClient(d.SUPABASE_URL, d.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
function val(result) { assert(!result.error, result.error?.code || 'AUTH_FAILED'); return result.data }
function totp(secret) {
  const bits = [...secret.replace(/=/g, '').toUpperCase()].map(c => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')).join('')
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)))).update(counter).digest()
  return String((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0')
}
const report = { at: new Date().toISOString(), ref, success: false, checks: [] }
let browser
try {
  val(await client.auth.signInWithPassword({ email: actor.email, password: actor.password }))
  if (!actor.factor) {
    const factor = val(await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'NFSE Submit QA' }))
    actor.factor = factor.id; actor.secret = factor.totp.secret; saveCredentials(state)
  }
  if (actor.lastTick === Math.floor(Date.now() / 30000)) await new Promise(r => setTimeout(r, 30100 - Date.now() % 30000))
  const challenge = val(await client.auth.mfa.challenge({ factorId: actor.factor }))
  actor.lastTick = Math.floor(Date.now() / 30000); saveCredentials(state)
  val(await client.auth.mfa.verify({ factorId: actor.factor, challengeId: challenge.id, code: totp(actor.secret) }))
  val(await client.rpc('registrar_sessao_mfa_atual', { p_factor_id: actor.factor }))
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.createBrowserContext()
  const session = val(await client.auth.getSession()).session
  const chunks = ('base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')).match(/.{1,3180}/g)
  await context.setCookie(...chunks.map((value, i) => ({ name: chunks.length === 1 ? `sb-${ref}-auth-token` : `sb-${ref}-auth-token.${i}`, value, domain: new URL(base).hostname, path: '/', secure: true, sameSite: 'Lax' })))
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.name))
  const omitted = ['status', 'submetida_em', 'submetida_por', 'updated_at']
  const facts = row => Object.fromEntries(Object.entries(row).filter(([key]) => !omitted.includes(key)))
  const read = async id => (await db.query('select to_jsonb(n) row from public.notas_fiscais n where id=$1', [id])).rows[0].row
  for (const [name, id] of [['nfse', state.ids['3b000000-0000-4000-8000-000000000001']], ['nfe', state.ids['2a000000-0000-4000-8000-000000000004']]]) {
    const response = await page.goto(`${base}/cedente/notas-fiscais/${id}`, { waitUntil: 'networkidle2', timeout: 60000 })
    assert(response.status() < 400)
    assert((response.headers()['content-security-policy'] || '').includes(`${ref}.supabase.co`), 'WRONG_DATABASE')
    assert.equal(new URL(page.url()).pathname, `/cedente/notas-fiscais/${id}`, 'AUTH_REDIRECT')
    await page.waitForSelector('h1', { timeout: 30000 })
    const before = await read(id)
    assert.equal(before.status, 'rascunho', 'UNSUBMITTED_FIXTURE_REQUIRED')
    const auditsBefore = (await db.query("select count(*) n from public.logs_auditoria where entidade_id=$1 and tipo_evento='NFSE_VENCIMENTO_MANUAL'", [id])).rows[0].n
    if (name === 'nfse') {
      assert((await page.$eval('body', e => e.textContent)).includes('Não informado'))
      assert.equal(await page.$$eval('input[type="hidden"]', fields => fields.some(f => /valor|cnpj|numero_nf/.test(f.name))), false)
    }
    let actionId
    const onRequest = request => {
      if (request.method() === 'POST' && request.postData()?.includes('"nfId"')) actionId = request.headers()['next-action']
    }
    page.on('request', onRequest)
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Submeter para analise') && !b.disabled), { timeout: 45000 })
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Submeter para analise')).click())
    await page.waitForSelector('[role="dialog"]', { timeout: 30000 })
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Confirmar submissão')).click())
    await page.waitForFunction(() => document.body.textContent.includes('NF submetida para analise com sucesso'), { timeout: 45000 })
    page.off('request', onRequest)
    const after = await read(id)
    assert.equal(after.status, 'submetida')
    if (name === 'nfse') {
      assert.deepEqual(facts(after), facts(before), 'FISCAL_DATA_CHANGED')
      assert.equal((await db.query("select count(*) n from public.logs_auditoria where entidade_id=$1 and tipo_evento='NFSE_VENCIMENTO_MANUAL'", [id])).rows[0].n, auditsBefore)
      assert(actionId, 'ACTION_ID_NOT_CAPTURED')
      for (const field of ['valor_bruto', 'cnpj_emitente', 'numero_nf', 'data_emissao', 'tipo_documento_fiscal']) {
        const result = await page.evaluate(async ({ actionId, id, field }) => {
          const r = await fetch(`/cedente/notas-fiscais/${id}`, { method: 'POST', headers: { 'Next-Action': actionId, Accept: 'text/x-component', 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify([{ nfId: id, [field]: 'FORGED' }]) })
          return (await r.text()).includes('NF_SUBMISSAO_PAYLOAD_INVALIDO')
        }, { actionId, id, field })
        assert(result, `TAMPER_NOT_REJECTED:${field}`)
      }
      assert.deepEqual(await read(id), after, 'TAMPERING_MUTATED_RECORD')
      report.checks.push('real-action-tampering-denied', 'null-net-and-manual-due-and-provenance-preserved')
    }
    report.checks.push(`${name}-authenticated-ui-submit`)
  }
  assert.deepEqual(errors, [])
  report.success = true
} catch (e) {
  report.error = { code: e.code || 'ASSERTION', message: String(e.message).split('\n')[0].slice(0, 180) }
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  await client.auth.signOut().catch(() => {})
  await db.end()
  writeFileSync('rehearsal/reports/NFSE_SUBMIT_PREVIEW_SMOKE.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
