import crypto from 'node:crypto'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import {
  REPORT_DIR,
  ensureRuntimeDirectories,
  formatError,
  localPgConfig,
  withPgClient,
  writeJson,
} from './lib.mjs'
import { localAdminClient, localSupabaseStatus, randomRehearsalPassword, totp } from './runtime-lib.mjs'

const APP_URL = 'http://localhost:3001'
const MAILPIT_URL = 'http://127.0.0.1:55324'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

function cnpjValido(seed) {
  const base = String(seed).replace(/\D/gu, '').padEnd(12, '7').slice(0, 12)
  const digito = (digits, weights) => {
    const sum = [...digits].reduce((total, value, index) => total + Number(value) * weights[index], 0)
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }
  const first = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const second = digito(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base}${first}${second}`
}

async function fixtures() {
  return withPgClient(localPgConfig(), async (client) => {
    const gestor = await client.query(`
      select p.id::text, p.email, uf.fundo_id::text
        from public.profiles p
        join public.usuario_fundos uf on uf.usuario_id = p.id and uf.status = 'ativo'
       where p.role = 'gestor' and p.status = 'ativo'
       order by coalesce(uf.principal, false) desc, p.id
       limit 1
    `)
    if (!gestor.rows[0]) throw new Error('Gestor historico local nao encontrado.')
    await client.query(`
      insert into public.usuario_papeis (usuario_id, papel, ativo, origem)
      values ($1, 'super_admin', true, 'bootstrap_homolog')
      on conflict (usuario_id, papel)
      do update set ativo = true, revogado_em = null, origem = 'bootstrap_homolog'
    `, [gestor.rows[0].id])
    return gestor.rows[0]
  })
}

async function clearFactors(admin, userId) {
  const listed = await admin.auth.admin.mfa.listFactors({ userId })
  if (listed.error) throw listed.error
  for (const factor of listed.data?.factors ?? []) {
    const removed = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId })
    if (removed.error) throw removed.error
  }
}

async function loginWithFreshMfa(page, user) {
  await page.goto(`${APP_URL}/login`, { waitUntil: 'domcontentloaded' })
  await page.type('#email', user.email)
  await page.type('#password', user.password)
  await page.click('button[type="submit"]')
  await page.waitForFunction(() => location.pathname === '/mfa/setup', { timeout: 30_000 })
  await page.waitForSelector('input[name="factorId"]', { timeout: 30_000 })
  const secret = await page.$eval('div.font-mono', (element) => element.textContent?.trim() || '')
  if (!secret) throw new Error('Secret TOTP local nao foi exibido.')
  await page.type('#code', totp(secret))
  await page.click('button[type="submit"]')
  await page.waitForFunction(() => document.body.innerText.includes('MFA ativado com sucesso.'), { timeout: 30_000 })
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Continuar para o portal'))
    if (!button) throw new Error('Botao para continuar apos MFA nao encontrado.')
    button.click()
  })
  await page.waitForFunction(() => !location.pathname.startsWith('/mfa') && location.pathname !== '/login', { timeout: 30_000 })
  return secret
}

async function waitForNextTotpWindow(secret) {
  const current = totp(secret)
  while (totp(secret) === current) await new Promise((resolve) => setTimeout(resolve, 500))
  return totp(secret)
}

async function enrollInvitedMfa(page) {
  await page.waitForFunction(() => location.pathname === '/mfa/setup', { timeout: 30_000 })
  await page.waitForSelector('input[name="factorId"]', { timeout: 30_000 })
  const secret = await page.$eval('div.font-mono', (element) => element.textContent?.trim() || '')
  if (!secret) throw new Error('Secret TOTP do convidado nao foi exibido.')
  await page.type('#code', totp(secret))
  await page.click('button[type="submit"]')
  await page.waitForFunction(() => document.body.innerText.includes('MFA ativado com sucesso.'), { timeout: 30_000 })
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Continuar para o portal'))
    if (!button) throw new Error('Botao de conclusao do MFA convidado nao encontrado.')
    button.click()
  })
  await page.waitForFunction(() => !location.pathname.startsWith('/mfa'), { timeout: 30_000 })
  return new URL(page.url()).pathname
}

async function clearMailpit() {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' })
}

async function waitForMail(recipient) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const listing = await fetch(`${MAILPIT_URL}/api/v1/messages`).then((response) => response.json())
    const message = (listing.messages ?? []).find((item) => (item.To ?? []).some((target) => target.Address === recipient))
    if (message) return fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`).then((response) => response.json())
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Mensagem local nao chegou ao Mailpit.')
}

function extractLocalLink(message, pathname) {
  const body = `${message.HTML || ''}\n${message.Text || ''}`.replaceAll('&amp;', '&')
  const match = body.match(/https?:\/\/[^\s"'<>]+/gu)?.find((candidate) => new URL(candidate).pathname === pathname)
  if (!match) throw new Error(`Link ${pathname} nao encontrado no e-mail local.`)
  const parsed = new URL(match)
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== '3001') {
    throw new Error('Convite tentou usar origem fora do runtime local.')
  }
  return parsed.toString()
}

async function inviteGestor(adminPage, browser, mfaSecret, email) {
  console.log('Convite Gestor: abrindo formulario administrativo...')
  await adminPage.goto(`${APP_URL}/admin/usuarios/novo`, { waitUntil: 'domcontentloaded' })
  await adminPage.type('#invite-name', 'Gestor Rehearsal P2')
  await adminPage.type('#invite-email', email)
  const selected = await adminPage.evaluate(() => {
    const checkbox = [...document.querySelectorAll('input[name="fundoIds"]')]
      .find((input) => [...(input.closest('label')?.querySelectorAll('span') || [])]
        .some((span) => span.textContent?.trim() === 'Ativo'))
    checkbox?.click()
    return Boolean(checkbox)
  })
  if (!selected) throw new Error('Fundo para convite de Gestor nao encontrado.')
  console.log('Convite Gestor: aguardando nova janela TOTP para impedir replay...')
  await adminPage.type('#invite-mfa', await waitForNextTotpWindow(mfaSecret))
  await adminPage.$eval('#invite-email', (input) => {
    const form = input.closest('form')
    if (!form) throw new Error('Formulario administrativo nao encontrado.')
    form.requestSubmit()
  })
  await adminPage.waitForFunction(() => /^\/admin\/usuarios\/[0-9a-f-]+$/u.test(location.pathname), { timeout: 45_000 })
  console.log('Convite Gestor: provisionado; validando Mailpit e aceite...')

  const message = await waitForMail(email)
  const link = extractLocalLink(message, '/convite/gestor')
  const scanner = await fetch(link, { method: 'HEAD', redirect: 'manual' })
  if (scanner.status !== 200) throw new Error(`HEAD scanner-safe do Gestor retornou ${scanner.status}.`)

  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  const password = randomRehearsalPassword()
  try {
    await page.goto(link, { waitUntil: 'domcontentloaded' })
    await page.type('#gestor-invite-password', password)
    await page.type('#gestor-invite-confirm-password', password)
    await page.click('button[type="submit"]')
    const destination = await enrollInvitedMfa(page)
    return { delivered: true, scanner_safe: true, accepted: true, mfa_enrolled: true, destination }
  } finally {
    await context.close()
  }
}

async function inviteCedente(adminPage, browser, email, cnpj) {
  console.log('Convite Cedente: abrindo onboarding...')
  await adminPage.goto(`${APP_URL}/gestor/onboarding-cedentes`, { waitUntil: 'domcontentloaded' })
  await adminPage.waitForFunction(
    () => document.body.innerText.includes('Convidar novo Cedente'),
    { timeout: 30_000 },
  )
  await adminPage.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Convidar novo Cedente'))
    if (!button) throw new Error('Acao de convite de Cedente nao encontrada.')
    button.click()
  })
  await adminPage.waitForSelector('#convite-cnpj')
  await adminPage.type('#convite-cnpj', cnpj)
  await adminPage.type('#convite-email', email)
  await adminPage.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Enviar convite')
    if (!button) throw new Error('Botao Enviar convite nao encontrado.')
    button.click()
  })
  await adminPage.waitForFunction(() => !document.querySelector('#convite-cnpj'), { timeout: 30_000 })
  console.log('Convite Cedente: provisionado; validando Mailpit e aceite...')

  const message = await waitForMail(email)
  const link = extractLocalLink(message, '/auth/confirm')
  const scanner = await fetch(link, { method: 'HEAD', redirect: 'manual' })
  if (scanner.status !== 200) throw new Error(`HEAD scanner-safe do Cedente retornou ${scanner.status}.`)

  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  const password = randomRehearsalPassword()
  try {
    await page.goto(link, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => location.pathname === '/convite/cedente', { timeout: 30_000 })
    await page.type('#invite-password', password)
    await page.type('#invite-confirm-password', password)
    await page.click('button[type="submit"]')
    const destination = await enrollInvitedMfa(page)
    return { delivered: true, scanner_safe: true, accepted: true, mfa_enrolled: true, destination }
  } finally {
    await context.close()
  }
}

async function databaseProof(gestorEmail, cedenteEmail) {
  return withPgClient(localPgConfig(), async (client) => {
    const result = await client.query(`
      select
        exists (
          select 1 from public.profiles p
          join private.gestor_usuario_convites gc on gc.usuario_id = p.id
          where lower(p.email) = lower($1) and p.role = 'gestor' and p.status = 'ativo' and gc.status = 'ACEITO'
        ) as gestor_aceito,
        exists (
          select 1 from public.cedente_acessos ca
          join public.profiles p on p.id = ca.user_id
          join public.cedente_fundos cf on cf.cedente_id = ca.cedente_id and cf.status = 'ativo'
          where lower(p.email) = lower($2) and ca.perfil = 'ADMIN' and ca.status = 'ATIVO'
        ) as cedente_aceito,
        (select count(*)::integer from auth.mfa_factors mf join auth.users u on u.id = mf.user_id
          where lower(u.email) in (lower($1), lower($2)) and mf.status = 'verified') as fatores_verificados
    `, [gestorEmail, cedenteEmail])
    return result.rows[0]
  })
}

async function main() {
  ensureRuntimeDirectories()
  await fetch(APP_URL, { signal: AbortSignal.timeout(5_000) })
  await clearMailpit()
  const fixture = await fixtures()
  const admin = localAdminClient(localSupabaseStatus())
  await clearFactors(admin, fixture.id)
  const password = randomRehearsalPassword()
  const updated = await admin.auth.admin.updateUserById(fixture.id, { password, email_confirm: true })
  if (updated.error) throw updated.error

  const runId = crypto.randomBytes(6).toString('hex')
  const gestorEmail = `p2-gestor-${runId}@bw-antecipa.invalid`
  const cedenteEmail = `p2-cedente-${runId}@bw-antecipa.invalid`
  const cnpj = cnpjValido(`98${runId}`)
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 120_000, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    console.log('Contexto Super Admin: autenticando com MFA local novo...')
    const mfaSecret = await loginWithFreshMfa(page, { ...fixture, password })
    const gestor = await inviteGestor(page, browser, mfaSecret, gestorEmail)
    const cedente = await inviteCedente(page, browser, cedenteEmail, cnpj)
    await context.close()
    const database = await databaseProof(gestorEmail, cedenteEmail)
    const report = {
      generated_at: new Date().toISOString(),
      environment: 'rehearsal/local',
      recipients: 'synthetic_invalid_domain_only',
      mail_transport: 'mailpit_local',
      gestor,
      cedente,
      database,
      cleanup: 'clone_rebuild_required_after_certification',
      passed: gestor.accepted && gestor.mfa_enrolled && cedente.accepted && cedente.mfa_enrolled
        && database.gestor_aceito && database.cedente_aceito && Number(database.fatores_verificados) === 2,
    }
    writeJson(path.join(REPORT_DIR, 'POST_RUNTIME_INVITES.json'), report)
    console.log(`Convite Gestor: ${report.gestor.accepted ? 'PASS' : 'FAIL'}`)
    console.log(`Convite Cedente: ${report.cedente.accepted ? 'PASS' : 'FAIL'}`)
    console.log(`MFA de convidados: ${database.fatores_verificados}/2`)
    if (!report.passed) process.exitCode = 2
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(`Certificacao de convites falhou: ${formatError(error)}`)
  process.exitCode = 1
})
