import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHmac } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...secret.replace(/=/g, '').toUpperCase()].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('')
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)))
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', key).update(counter).digest(), offset = digest[19] & 15
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0')
}

/** Finite read smoke. No credential creation, subscription, metadata fetch or external mail. */
export async function verifyLocalInbox(db) {
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57861')
  assert.equal(process.env.EMAIL_INTAKE_DISPOSABLE_SMOKE, 'true')
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options)
  const human = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
  const value = (r, stage) => { assert.ok(!r.error, `${stage}:${r.error?.code ?? 'UNKNOWN'}`); return r.data }
  const email = `scoped-inbox-${randomUUID()}@example.invalid`, password = `QA!A1${randomBytes(24).toString('base64url')}`
  let server, browser, ready = false, startup = ''
  try {
    const { user } = value(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'CREATE')
    await db.query("update public.profiles set role='super_admin',status='ativo' where id=$1", [user.id])
    await db.query("insert into public.usuario_papeis(usuario_id,papel,ativo,origem) values($1,'super_admin',true,'administracao') on conflict(usuario_id,papel) do update set ativo=true,revogado_em=null", [user.id])
    value(await human.auth.signInWithPassword({ email, password }), 'LOGIN')
    const factor = value(await human.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Scoped inbox' }), 'ENROLL')
    const challenge = value(await human.auth.mfa.challenge({ factorId: factor.id }), 'CHALLENGE')
    value(await human.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code: totp(factor.totp.secret) }), 'VERIFY')
    value(await human.rpc('registrar_sessao_mfa_atual', { p_factor_id: factor.id }), 'MFA_SESSION')
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '57869'], { windowsHide: true, env: { ...process.env, NODE_ENV: 'production', EMAIL_INTAKE_AUTOMATION_ENABLED: 'false' } })
    for (const stream of [server.stdout, server.stderr]) stream.on('data', bytes => { if (!ready) { startup += bytes; ready = /Ready in/.test(stripVTControlCharacters(startup)) } })
    for (let i = 0; i < 600 && !ready; i++) { assert.equal(server.exitCode, null, 'INBOX_SERVER_EXITED'); await new Promise(r => setTimeout(r, 100)) }
    assert.ok(ready, 'INBOX_SERVER_NOT_READY')
    browser = await puppeteer.launch({ executablePath: process.env.EMAIL_INTAKE_QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run', '--disable-dev-shm-usage'] })
    const context = await browser.createBrowserContext(), page = await context.newPage()
    const session = value(await human.auth.getSession(), 'SESSION').session
    const chunks = ('base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')).match(/.{1,3180}/g)
    await context.setCookie(...chunks.map((entry, i) => ({ name: chunks.length === 1 ? 'sb-127-auth-token' : `sb-127-auth-token.${i}`, value: entry, domain: '127.0.0.1', path: '/', secure: false, httpOnly: false, sameSite: 'Lax' })))
    const errors = [], bodies = []
    page.on('pageerror', () => errors.push('PAGE_ERROR'))
    page.on('response', r => { if (r.status() >= 500) errors.push('HTTP_SERVER_ERROR'); if (/text|json/.test(r.headers()['content-type'] ?? '')) bodies.push(r.text().catch(() => '')) })
    const path = 'http://127.0.0.1:57869/admin/integracoes-email?fundo=22000000-0000-4000-8000-000000000001&tab=inbox'
    await page.goto(path, { waitUntil: 'networkidle2', timeout: 45000 })
    await page.waitForSelector('section[aria-label="Importações por e-mail"] a[aria-label^="Ver detalhe:"]', { timeout: 30000 })
    const rowCount = await page.$$eval('section[aria-label="Importações por e-mail"] a[aria-label^="Ver detalhe:"]', rows => rows.length)
    assert.ok(rowCount > 0, 'INBOX_EMPTY_AFTER_IMPORT')
    const content = (await Promise.all(bodies)).join('\n')
    for (const secret of [process.env.SUPABASE_SERVICE_ROLE_KEY, ...Object.values(JSON.parse(process.env.PORTAL_FIDC_CREDENTIAL_KEYS_JSON))]) assert.ok(!content.includes(secret), 'BROWSER_SECRET_EXPOSURE')
    assert.deepEqual(errors, [], 'INBOX_BROWSER_FAILURE')
    return ['OFFICIAL_INBOX_REAL_OPERATOR_AUTH_MFA_ROWS', 'INBOX_HTML_RESPONSES_NO_SERVICE_KEY_OR_KEYRING', 'INBOX_NO_BROWSER_OR_SERVER_ERROR']
  } finally {
    await browser?.close()
    await human.auth.signOut()
    if (server?.exitCode === null && server.pid) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      else server.kill('SIGTERM')
    }
  }
}
