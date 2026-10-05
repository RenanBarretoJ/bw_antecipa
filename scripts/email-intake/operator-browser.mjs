import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHmac } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { prepareEmailBrowserRuntime } from './browser-runtime.mjs'
import { diagnosticPath, instrumentEmailBrowser } from './browser-diagnostics.mjs'
import { waitEmailScreen, waitEmailDestination } from './browser-readiness.mjs'
import { inspectEmailResponses, secretClasses } from './browser-redaction.mjs'
import { verifyFundSwitchBrowser } from './fund-switch-browser.mjs'

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...secret.replace(/=/g, '').toUpperCase()].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('')
  const bytes = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)))
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', bytes).update(counter).digest(), offset = digest[19] & 15
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0')
}

/** Uses real Auth, MFA, Server Actions and Postgres. All data is disposable and synthetic. */
export async function verifyEmailOperatorBrowser({ db, url, serviceKey, anonKey, environment, root }) {
  assert.equal(url, 'http://127.0.0.1:57841')
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const human = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const fund = '22000000-0000-4000-8000-000000000001'
  const value = (result, stage) => { assert.ok(!result.error, `${stage}:${result.error?.code ?? 'UNKNOWN'}`); return result.data }
  let server, browser, page, diagnostics, redaction, stage = 'AUTH', startup = '', ready = false
  const checks = [], screenshots = [], accessibility = [], serverLogMatches = new Set()
  const secret = `SYNTHETIC-OAUTH-${randomBytes(20).toString('hex')}`
  const password = `QA!A1${randomBytes(24).toString('base64url')}`, email = `email05-${randomUUID()}@example.invalid`
  const screenshotDir = resolve(root, 'email05-screenshots')
  await mkdir(screenshotDir, { recursive: true })
  try {
    const { user } = value(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'CREATE')
    await db.query("update public.profiles set role='super_admin',status='ativo' where id=$1", [user.id])
    await db.query("insert into public.usuario_papeis(usuario_id,papel,ativo,origem) values($1,'super_admin',true,'administracao') on conflict(usuario_id,papel) do update set ativo=true,revogado_em=null", [user.id])
    value(await human.auth.signInWithPassword({ email, password }), 'LOGIN')
    assert.ok((await human.rpc('email_operator_dashboard', { p_fundo: fund })).error, 'AAL1 operator read denied')
    const factor = value(await human.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'EMAIL05 disposable' }), 'ENROLL')
    const challenge = value(await human.auth.mfa.challenge({ factorId: factor.id }), 'CHALLENGE')
    let previousCode = totp(factor.totp.secret)
    value(await human.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code: previousCode }), 'VERIFY')
    const freshCode = async () => {
      while (totp(factor.totp.secret) === previousCode) await new Promise(r => setTimeout(r, 500))
      previousCode = totp(factor.totp.secret); return previousCode
    }
    value(await human.rpc('registrar_sessao_mfa_atual', { p_factor_id: factor.id }), 'SESSION')
    checks.push('REAL_AUTH_AAL1_DENIED_AAL2_ACCEPTED')
    const serverEnvironment = { ...environment, NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey, PORTAL_FIDC_CREDENTIAL_KEYS_JSON: JSON.stringify({ qa: randomBytes(32).toString('base64') }), PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION: 'qa' }
    const knownSecrets = [{ value: secret, kind: 'CREDENTIAL_RAW_SECRET' }, { value: serviceKey, kind: 'SERVICE_ROLE_KEY' },
      ...Object.values(JSON.parse(serverEnvironment.PORTAL_FIDC_CREDENTIAL_KEYS_JSON)).map(value => ({ value, kind: 'CREDENTIAL_ENCRYPTION_KEY' })),
      ...Object.entries(serverEnvironment).filter(([name]) => /SECRET|CREDENTIAL|SERVICE_ROLE/.test(name)).map(([, value]) => ({ value, kind: 'SERVER_ENV_VALUE' }))]
    // Test the deployable runtime. Development HMR can remount forms during Server Action compilation.
    stage = 'BUILD'
    await prepareEmailBrowserRuntime(serverEnvironment, root)
    stage = 'SERVER'
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '57849'], {
      windowsHide: true, env: serverEnvironment,
    })
    let logTail = ''
    for (const stream of [server.stdout, server.stderr]) stream.on('data', bytes => {
      if (!ready) { startup += bytes.toString(); ready = /Ready in/.test(stripVTControlCharacters(startup)) }
      const text = logTail + bytes.toString()
      for (const kind of secretClasses(text, knownSecrets)) serverLogMatches.add(kind)
      logTail = text.slice(-2048)
    })
    for (let i = 0; i < 600 && !ready; i++) { assert.equal(server.exitCode, null, 'NEXT_EXITED'); await new Promise(r => setTimeout(r, 100)) }
    assert.ok(ready, 'NEXT_NOT_READY')
    browser = await puppeteer.launch({ executablePath: environment.EMAIL_INTAKE_QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run', '--disable-dev-shm-usage'] })
    const context = await browser.createBrowserContext()
    page = await context.newPage()
    diagnostics = await instrumentEmailBrowser(page, resolve(root, 'email05-network.json'))
    redaction = await inspectEmailResponses(page, { file: resolve(root, 'email05-redaction.json'), phase: () => stage, knownSecrets })
    redaction.expectReadiness(() => waitEmailDestination(page, diagnostics))
    const session = (await human.auth.getSession()).data.session
    const cookie = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), chunks = cookie.match(/.{1,3180}/g)
    await context.setCookie(...chunks.map((entry, i) => ({ name: chunks.length === 1 ? 'sb-127-auth-token' : `sb-127-auth-token.${i}`, value: entry, domain: '127.0.0.1', path: '/', secure: false, httpOnly: false, sameSite: 'Lax' })))
    let consoleErrors = 0
    page.on('pageerror', () => { consoleErrors++ })
    const base = `http://127.0.0.1:57849/admin/integracoes-email?fundo=${fund}`
    const goto = (...args) => redaction.beforeNavigation(() => page.goto(...args))
    const reload = (...args) => redaction.beforeNavigation(() => page.reload(...args))
    const click = async label => {
      await redaction.assertHealthy()
      await page.waitForFunction(text => [...document.querySelectorAll('button,a')].some(e => e.textContent.trim() === text), { timeout: 30000 }, label)
      const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === text), label)
      assert.ok(handle.asElement(), `MISSING_CONTROL:${label}`); await redaction.beforeNavigation(() => handle.asElement().click()); await handle.dispose()
    }
    const fill = async (label, text) => {
      await page.evaluate((name, value) => {
        const parent = [...document.querySelectorAll('label')].find(e => e.textContent.trim().startsWith(name))
        const input = parent?.querySelector('input')
        if (!input) throw new Error('MISSING_LABELED_INPUT')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }))
      }, label, text)
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    }
    const screenshot = async (name, widths = [390, 430, 820, 1440, 1920]) => {
      const screen = name.replace('-empty', '')
      if (['inbox', 'review', 'message', 'detail'].includes(screen)) await waitEmailScreen(page, diagnostics, screen)
      await diagnostics.idle(name)
      await redaction.assertHealthy()
      await diagnostics.phase(`${name}:DOCUMENT_COMPLETE`)
      await page.waitForFunction(() => document.readyState === 'complete' && document.documentElement && document.body, { timeout: 30000 })
      if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({ path: resolve('node_modules/axe-core/axe.min.js') })
      for (const theme of ['light', 'dark']) for (const width of widths) {
        await redaction.beforeNavigation(() => page.setViewport({ width, height: 1000 })); await page.evaluate(value => { document.documentElement.classList.toggle('dark', value === 'dark') }, theme)
        // Allow the existing responsive sidebar transition to finish before measuring or capturing.
        await new Promise(r => setTimeout(r, 350))
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
        assert.equal(overflow, false, `OVERFLOW:${name}:${width}:${theme}`)
        if (width === 390 || width === 1440) {
          await diagnostics.phase(`${name}:ACCESSIBILITY:${width}:${theme}`)
          const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('[role="dialog"]') ?? document.querySelector('main') ?? document.body,
            { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })))
          accessibility.push({ name, width, theme, violations })
          assert.equal(violations.length, 0, `ACCESSIBILITY:${name}:${width}:${theme}:${violations.map(v => v.id).join(',')}`)
        }
        await diagnostics.phase(`${name}:SCREENSHOT:${width}:${theme}`)
        const file = `${name}-${width}-${theme}.png`; await page.screenshot({ path: resolve(screenshotDir, file), fullPage: true }); screenshots.push(file)
      }
    }
    stage = 'LIST'
    await goto(base, { waitUntil: 'networkidle2', timeout: 90000 })
    assert.ok(new URL(page.url()).pathname === '/admin/integracoes-email', 'AUTH_REDIRECT')
    assert.ok(await page.$('nav[aria-label="Fundos"] a'), 'SUPER_ADMIN_FUND_NAVIGATION')
    await screenshot('integrations')
    stage = 'INTEGRATION_FIRST_DRAFT'
    await click('Criar integração'); await page.waitForSelector('input[placeholder]')
    await fill('Nome da integração', 'EMAIL05 Browser draft')
    await click('2. Conta de e-mail'); await fill('Endereço de e-mail', 'qa-browser@example.invalid')
    await click('1. Identificação')
    assert.equal(await page.$eval('input[placeholder]', e => e.value), 'EMAIL05 Browser draft')
    await fill('Código MFA para salvar', '000000'); await click('Salvar rascunho')
    await page.waitForSelector('[role="alert"]', { timeout: 30000 })
    assert.equal(await page.$eval('input[placeholder]', e => e.value), 'EMAIL05 Browser draft')
    checks.push('WIZARD_BACK_PRESERVES_FIELDS', 'FAILED_MFA_PRESERVES_FORM')
    await fill('Código MFA para salvar', await freshCode()); await click('Salvar rascunho')
    await page.waitForFunction(() => new URL(location.href).searchParams.has('integration'), { timeout: 45000 })
    const integration = new URL(page.url()).searchParams.get('integration')
    assert.ok(integration)
    await waitEmailScreen(page, diagnostics, 'detail', 'EMAIL05 Browser draft')
    await reload({ waitUntil: 'networkidle2' })
    assert.ok((await page.content()).includes('EMAIL05 Browser draft'))
    const persisted = (await db.query('select credential_id,enabled from private.email_integrations where id=$1', [integration])).rows[0]
    assert.equal(persisted.credential_id, null); assert.equal(persisted.enabled, false)
    checks.push('OFFICIAL_ACTION_DRAFT_RELOAD_NO_CREDENTIAL')
    await screenshot('detail')
    await page.$eval('[aria-label="Saúde e alertas"]', element => { element.querySelector('details')?.setAttribute('open', ''); element.scrollIntoView({ block: 'start' }) })
    await screenshot('health')
    stage = 'INLINE_CREDENTIAL'
    await click('Editar configuração'); await click('3. Credencial'); await click('Criar credencial')
    await page.waitForSelector('[role="dialog"]')
    await screenshot('credential-dialog')
    await fill('Nome da credencial', 'EMAIL05 Browser OAuth'); await fill('Identificador da organização', randomUUID()); await fill('Identificador da aplicação', randomUUID()); await fill('Segredo da aplicação', secret)
    await fill('Código de confirmação MFA', await freshCode()); await click('Salvar credencial')
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]') && [...document.querySelectorAll('select option:checked')].some(e => e.textContent.includes('EMAIL05 Browser OAuth')), { timeout: 45000 })
    await screenshot('credential-select')
    await click('4. Cedentes'); await click('Buscar'); await page.waitForFunction(() => document.body.innerText.includes('Cedente QA C2.1'))
    await screenshot('allowlist')
    await page.evaluate(() => [...document.querySelectorAll('label')].find(e => e.textContent.trim() === 'Cedente QA C2.1').querySelector('input').click())
    await page.evaluate(() => [...document.querySelectorAll('label')].find(e => e.textContent.includes('Conferi as alterações')).querySelector('input').click())
    await fill('Código MFA para salvar', await freshCode()); await click('Salvar rascunho')
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('edit'), { timeout: 45000 })
    await reload({ waitUntil: 'networkidle2' })
    const saved = (await db.query('select credential_id from private.email_integrations where id=$1', [integration])).rows[0]
    assert.ok(saved.credential_id)
    checks.push('OFFICIAL_INLINE_CREDENTIAL_ENCRYPTED', 'AUTO_SELECT_AND_PERSIST', 'OFFICIAL_ALLOWLIST')
    stage = 'CREDENTIAL_FIRST'
    await goto(base, { waitUntil: 'networkidle2' })
    await click('Nova credencial de e-mail'); await page.waitForSelector('[role="dialog"]')
    await fill('Nome da credencial', 'EMAIL05 Credential first'); await fill('Identificador da organização', randomUUID()); await fill('Identificador da aplicação', randomUUID()); await fill('Segredo da aplicação', secret)
    await fill('Código de confirmação MFA', await freshCode()); await click('Salvar credencial')
    await page.waitForFunction(() => document.body.innerText.includes('Credencial salva. Crie uma integração'), { timeout: 45000 })
    const standalone = (await db.query('select id from public.credenciais_integracao where fundo_id=$1 and criada_por=$2 and nome=$3', [fund, user.id, 'EMAIL05 Credential first'])).rows[0]
    assert.ok(standalone)
    await click('Criar integração'); await page.waitForSelector('input[placeholder]')
    await fill('Nome da integração', 'EMAIL05 Credential-first integration'); await click('3. Credencial')
    await page.select('select', standalone.id)
    await fill('Código MFA para salvar', await freshCode()); await click('Salvar rascunho')
    await page.waitForFunction(() => new URL(location.href).searchParams.has('integration'), { timeout: 45000 })
    const credentialFirstIntegration = new URL(page.url()).searchParams.get('integration')
    await waitEmailScreen(page, diagnostics, 'detail', 'EMAIL05 Credential-first integration')
    await reload({ waitUntil: 'networkidle2' })
    assert.equal((await db.query('select credential_id from private.email_integrations where id=$1', [credentialFirstIntegration])).rows[0].credential_id, standalone.id)
    checks.push('OFFICIAL_CREDENTIAL_FIRST_RELOAD_LINK_PERSISTS')
    stage = 'INBOX_AND_REVIEW'
    await diagnostics.phase('INBOX:NAVIGATION')
    await goto(`${base}&tab=inbox&filterIntegration=${credentialFirstIntegration}`, { waitUntil: 'domcontentloaded' })
    await screenshot('inbox-empty', [390, 1440])
    assert.ok((await page.content()).includes('Nenhuma mensagem encontrada nestes filtros.'))
    await goto(`${base}&tab=inbox`, { waitUntil: 'domcontentloaded' }); await screenshot('inbox')
    const fixtureIntegration = (await db.query("select id from private.email_integrations where name='EMAIL05 configuration QA'")).rows[0].id
    await goto(`${base}&tab=inbox&filterIntegration=${fixtureIntegration}`, { waitUntil: 'domcontentloaded' })
    await waitEmailScreen(page, diagnostics, 'inbox')
    const rowCount = () => page.$$eval('section[aria-label="Importações por e-mail"] article', rows => rows.length)
    assert.equal(await rowCount(), 25)
    await click('Próxima')
    await page.waitForFunction(() => new URL(location.href).searchParams.get('page') === '2'
      && document.querySelectorAll('section[aria-label="Importações por e-mail"] article').length === 2, { timeout: 15000 })
    await waitEmailScreen(page, diagnostics, 'inbox')
    await screenshot('inbox-page-two', [390, 1440])
    await click('Duplicados')
    await page.waitForFunction(() => new URL(location.href).searchParams.get('status') === 'DUPLICATE'
      && document.querySelector('section[aria-label="Importações por e-mail"]').textContent.includes('26 mensagem(ns)'), { timeout: 15000 })
    await waitEmailScreen(page, diagnostics, 'inbox')
    assert.equal(await rowCount(), 25)
    assert.equal(new URL(page.url()).searchParams.has('page'), false)
    await page.select('select[name="errorCode"]', 'UNKNOWN_CEDENTE')
    await click('Aplicar filtros')
    await page.waitForFunction(() => new URL(location.href).searchParams.get('errorCode') === 'UNKNOWN_CEDENTE', { timeout: 15000 })
    await waitEmailScreen(page, diagnostics, 'inbox')
    assert.equal(await rowCount(), 0, 'SERVER_FILTER_INTERSECTION')
    await goto(`${base}&tab=inbox&page=invalid`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].some(el => el.textContent.includes('Há filtros inválidos.')), { timeout: 15000 })
    await screenshot('inbox-invalid-filter', [390, 1440])
    checks.push('INBOX_SERVER_PAGINATION_BROWSER', 'INBOX_STATUS_AND_FORM_FILTERS', 'INBOX_INVALID_FILTER_TERMINAL')
    const message = (await db.query("select m.id from private.email_intake_messages m join private.email_integrations i on i.id=m.integration_id where i.name='EMAIL05 configuration QA' limit 1")).rows[0]
    assert.ok(message)
    await diagnostics.phase('MESSAGE:NAVIGATION')
    await goto(`${base}&tab=inbox&message=${message.id}`, { waitUntil: 'domcontentloaded' }); await screenshot('message')
    await diagnostics.phase('REVIEW:NAVIGATION')
    await goto(`${base}&tab=review&filterIntegration=${credentialFirstIntegration}`, { waitUntil: 'domcontentloaded' })
    await screenshot('review-empty', [390, 1440])
    assert.ok((await page.content()).includes('Não há documentos aguardando revisão nestes filtros.'))
    await goto(`${base}&tab=review`, { waitUntil: 'domcontentloaded' }); await screenshot('review')
    await page.keyboard.press('Tab')
    assert.ok(await page.evaluate(() => document.activeElement !== document.body), 'KEYBOARD_FOCUS')
    await redaction.awaitDrain()
    checks.push(...await verifyFundSwitchBrowser({ db, browser, url, serviceKey, anonKey, root }))
    const redactionSummary = await redaction.settleAndAssertClean()
    assert.equal(serverLogMatches.size, 0, 'SERVER_LOG_SECRET_PATTERN_MATCH')
    await diagnostics.assertClean()
    assert.equal(consoleErrors, 0)
    checks.push('ALL_WIDTHS_LIGHT_DARK_NO_OVERFLOW', 'KEYBOARD_FOCUS', 'RESPONSE_SECRET_REDACTION', 'NO_BROWSER_ERRORS')
    checks.push('WCAG_AA_AUTOMATED_MOBILE_DESKTOP_LIGHT_DARK')
    checks.push('INBOX_REVIEW_EMPTY_TERMINAL_READINESS', 'CONSOLE_AND_REJECTION_CLEAN', 'NO_STALLED_REQUESTS')
    checks.push('MUST_INSPECT_100_PERCENT', 'ABORTED_REQUESTS_CLASSIFIED')
    await writeFile(resolve(root, 'email05-ui.json'), JSON.stringify({ result: 'PASS', checks, screenshots, accessibility, redactionSummary }, null, 2))
    return checks
  } catch (error) {
    if (page) await page.screenshot({ path: resolve(screenshotDir, 'failure.png'), fullPage: true }).catch(() => undefined)
    const ui = page ? await page.evaluate(() => ({ mainPresent: Boolean(document.querySelector('main')), alertCount: document.querySelectorAll('[role="alert"]').length })).catch(() => null) : null
    if (ui) ui.path = diagnosticPath(page.url())
    await writeFile(resolve(root, 'email05-ui.json'), JSON.stringify({ result: 'FAIL', stage, error: error.name, checks, screenshots, accessibility, ui }, null, 2))
    throw new Error(`EMAIL05_BROWSER:${stage}:${error.message.replace(/[A-Za-z0-9_~-]{40,}/g, '[redacted]')}`)
  } finally {
    try {
      await redaction?.save(); await diagnostics?.save()
      await writeFile(resolve(root, 'email05-log-redaction.json'), JSON.stringify({ matchedSecretClasses: [...serverLogMatches] }))
    }
    finally {
      try {
        if (redaction) await redaction.closeAfterDrain(() => browser?.close())
        else if (browser) await browser.close()
      }
      finally {
        if (server?.exitCode === null && server.pid) {
          if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
          else server.kill('SIGTERM')
        }
      }
    }
  }
}
