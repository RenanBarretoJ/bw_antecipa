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
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CONTROLLED_OPERATION = process.argv.includes('--controlled-operation')

function safeMessage(value) {
  return String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/giu, '[uuid]')
    .slice(0, 500)
}

async function fixtures() {
  return withPgClient(localPgConfig(), async (client) => {
    const gestor = await client.query(`
      select p.id::text, p.email, uf.fundo_id::text
        from public.profiles p
        join public.usuario_fundos uf on uf.usuario_id = p.id and uf.status = 'ativo'
       where p.role = 'gestor' and p.status = 'ativo'
         and uf.fundo_id = (select fundo_id from public.operacoes group by fundo_id order by count(*) desc limit 1)
       order by coalesce(uf.principal, false) desc, p.id limit 1
    `)
    const controlledOperationEligibility = CONTROLLED_OPERATION
      ? `and exists (
           select 1 from public.notas_fiscais nf
           left join public.operacoes_nfs onf on onf.nota_fiscal_id = nf.id
           where nf.cedente_id = ca.cedente_id and nf.status = 'aprovada' and nf.data_vencimento >= current_date
             and onf.nota_fiscal_id is null
         )`
      : ''
    const cedente = await client.query(`
      select p.id::text, p.email, ca.cedente_id::text,
             (select cf.fundo_id::text from public.cedente_fundos cf where cf.cedente_id = ca.cedente_id and cf.status = 'ativo' order by cf.created_at limit 1) as fundo_id
        from public.profiles p
        join public.cedente_acessos ca on ca.user_id = p.id and ca.perfil = 'ADMIN' and ca.status = 'ATIVO' and ca.ativo is true
       where p.role = 'cedente' and p.status = 'ativo'
         and exists (select 1 from public.operacoes o where o.cedente_id = ca.cedente_id)
         ${controlledOperationEligibility}
       order by exists (
         select 1 from public.cedente_fundo_politicas cfp
         join public.politicas_operacionais po on po.id = cfp.politica_operacional_id
         join public.politica_operacional_versoes pov on pov.politica_operacional_id = po.id
         where cfp.cedente_fundo_id in (select id from public.cedente_fundos where cedente_id = ca.cedente_id)
           and cfp.status = 'ativa' and po.status = 'ativa' and pov.status = 'publicada'
       ) desc, p.id limit 1
    `)
    const sacado = await client.query(`
      select p.id::text, p.email
        from public.profiles p
       where p.role = 'sacado' and p.status = 'ativo'
         and exists (select 1 from public.sacados s where s.user_id = p.id)
       order by p.id limit 1
    `)
    const operations = await client.query(`select id::text, status::text from public.operacoes order by status::text, id`)
    const cedenteSamples = cedente.rows[0]
      ? await client.query(`
          select
            (select id::text from public.operacoes where cedente_id = $1 order by created_at desc limit 1) as operacao_id,
            (select id::text from public.notas_fiscais where cedente_id = $1 order by created_at desc limit 1) as nf_id
        `, [cedente.rows[0].cedente_id])
      : { rows: [{}] }
    if (!gestor.rows[0] || !cedente.rows[0] || !sacado.rows[0]) throw new Error('Fixtures historicas insuficientes para Gestor, Cedente e Sacado.')
    return {
      gestor: gestor.rows[0],
      cedente: { ...cedente.rows[0], ...cedenteSamples.rows[0] },
      sacado: sacado.rows[0],
      operations: operations.rows,
    }
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

async function prepareUser(admin, user) {
  await clearFactors(admin, user.id)
  const password = randomRehearsalPassword()
  const updated = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true })
  if (updated.error) throw updated.error
  return { ...user, password }
}

async function waitForPortal(page) {
  await page.waitForFunction(() => !location.pathname.startsWith('/mfa') && location.pathname !== '/login', { timeout: 30_000 })
}

async function loginWithFreshMfa(page, user) {
  await page.goto(`${APP_URL}/login`, { waitUntil: 'domcontentloaded' })
  await page.type('#email', user.email)
  await page.type('#password', user.password)
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForFunction(() => location.pathname.startsWith('/mfa/'), { timeout: 30_000 }),
  ])
  if (!page.url().includes('/mfa/setup')) throw new Error(`Usuario sem fator nao foi direcionado ao setup MFA: ${page.url()}`)
  await page.waitForSelector('input[name="factorId"]', { timeout: 30_000 })
  const secret = await page.$eval('div.font-mono', (element) => element.textContent?.trim() || '')
  if (!secret) throw new Error('Secret TOTP local nao foi exibido no setup.')
  await page.type('#code', totp(secret))
  await page.click('button[type="submit"]')
  await page.waitForFunction(() => document.body.innerText.includes('MFA ativado com sucesso.'), { timeout: 30_000 })
  const clicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Continuar para o portal'))
    button?.click()
    return Boolean(button)
  })
  if (!clicked) throw new Error('Acao de continuar apos MFA nao encontrada.')
  await waitForPortal(page)
  const security = await page.evaluate(async () => {
    const response = await fetch('/api/auth/session-security')
    return { status: response.status, body: await response.json() }
  })
  return { destination: new URL(page.url()).pathname, session_security: { status: security.status, valid: security.body?.valid === true } }
}

async function visit(page, route, pageErrors) {
  const before = pageErrors.length
  const response = await page.goto(`${APP_URL}${route}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await new Promise((resolve) => setTimeout(resolve, 150))
  const body = await page.evaluate(() => document.body.innerText.slice(0, 20_000))
  return {
    route: route.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/giu, '[id]'),
    status: response?.status() ?? 0,
    redirected_to: new URL(page.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/giu, '[id]'),
    runtime_error: /Application error|Runtime Error|Internal Server Error/iu.test(body) || pageErrors.length > before,
  }
}

async function createControlledOperation(page) {
  await page.goto(`${APP_URL}/cedente/operacoes/nova`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await new Promise((resolve) => setTimeout(resolve, 500))
  const selected = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim().startsWith('NF ') && !item.hasAttribute('disabled'))
    button?.click()
    return Boolean(button)
  })
  if (!selected) return { success: false, reason: 'nenhuma_nf_elegivel' }
  await new Promise((resolve) => setTimeout(resolve, 300))
  const submitted = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Solicitar antecipacao') && !item.hasAttribute('disabled'))
    button?.click()
    return Boolean(button)
  })
  if (!submitted) return { success: false, reason: 'acao_solicitar_indisponivel' }
  try {
    await page.waitForFunction(() => location.pathname === '/cedente/operacoes', { timeout: 30_000 })
    return { success: true, destination: '/cedente/operacoes' }
  } catch {
    return { success: false, reason: 'operacao_nao_criada' }
  }
}

async function runContext(browser, name, user, routes, options = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(safeMessage(error.message)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(safeMessage(message.text()))
  })
  try {
    const auth = await loginWithFreshMfa(page, user)
    const visits = []
    for (const route of routes) visits.push(await visit(page, route, pageErrors))
    const controlledOperation = options.controlledOperation ? await createControlledOperation(page) : null
    return {
      name,
      auth,
      routes: visits,
      page_errors: pageErrors,
      console_errors: consoleErrors.filter((message) => !message.includes('favicon')),
      controlled_operation: controlledOperation,
      passed: auth.session_security.valid && visits.every((item) => item.status < 500 && !item.runtime_error) && pageErrors.length === 0
        && (!options.controlledOperation || controlledOperation?.success === true),
    }
  } finally {
    await context.close()
  }
}

async function main() {
  ensureRuntimeDirectories()
  await fetch(APP_URL, { signal: AbortSignal.timeout(5_000) })
  const data = await fixtures()
  const admin = localAdminClient(localSupabaseStatus())
  const [gestor, cedente, sacado] = await Promise.all([
    prepareUser(admin, data.gestor),
    prepareUser(admin, data.cedente),
    prepareUser(admin, data.sacado),
  ])

  await withPgClient(localPgConfig(), (client) => client.query(`
    insert into public.usuario_papeis (usuario_id, papel, ativo, origem)
    values ($1, 'super_admin', true, 'bootstrap_homolog')
    on conflict (usuario_id, papel) do update set ativo = true, revogado_em = null, origem = 'bootstrap_homolog'
  `, [gestor.id]))

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 120_000, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const operationRoutes = data.operations.map((operation) => `/gestor/operacoes/${operation.id}`)
    const gestorRoutes = [
      '/gestor/dashboard', '/gestor/fundos', '/gestor/cedentes', '/gestor/onboarding-cedentes', '/gestor/operacoes',
      '/gestor/notas-fiscais', '/gestor/documentos', '/gestor/conciliacao', `/gestor/fundos/${gestor.fundo_id}?tab=integracoes`,
      `/gestor/fundos/${gestor.fundo_id}?tab=templates`, ...operationRoutes,
      '/admin', '/admin/usuarios', '/admin/fundos', `/admin/fundos/${gestor.fundo_id}?tab=integracoes`,
    ]
    const cedenteRoutes = [
      '/cedente/dashboard', '/cedente/estabelecimentos', '/cedente/notas-fiscais', '/cedente/operacoes/nova',
      '/cedente/operacoes', '/cedente/documentos',
      ...(cedente.operacao_id ? [`/cedente/operacoes/${cedente.operacao_id}`] : []),
      ...(cedente.nf_id ? [`/cedente/notas-fiscais/${cedente.nf_id}`] : []),
    ]
    const sacadoRoutes = ['/sacado/dashboard', '/sacado/notas-fiscais', '/sacado/aprovacao', '/sacado/pagamentos']
    const results = []
    results.push(await runContext(browser, 'gestor_super_admin_local', gestor, gestorRoutes))
    results.push(await runContext(browser, 'cedente_admin_historico', cedente, cedenteRoutes, { controlledOperation: CONTROLLED_OPERATION }))
    results.push(await runContext(browser, 'sacado_historico', sacado, sacadoRoutes))

    const operationVisits = results[0].routes.filter((item) => item.route.startsWith('/gestor/operacoes/[id]'))
    const report = {
      generated_at: new Date().toISOString(),
      environment: 'rehearsal/local',
      identities: 'historicas_com_credencial_e_mfa_somente_locais',
      contexts: results,
      operation_detail_runtime: {
        expected: 46,
        visited: operationVisits.length,
        passed: operationVisits.filter((item) => item.status < 500 && !item.runtime_error).length,
      },
      external_effects: 'disabled_by_environment',
      controlled_operation_requested: CONTROLLED_OPERATION,
      passed: results.every((result) => result.passed) && operationVisits.length === 46,
    }
    writeJson(path.join(REPORT_DIR, 'POST_RUNTIME_BROWSER.json'), report)
    console.log(`Contextos autenticados aprovados: ${results.filter((result) => result.passed).length}/${results.length}`)
    console.log(`Detalhes de operacao no runtime: ${report.operation_detail_runtime.passed}/${report.operation_detail_runtime.expected}`)
    if (!report.passed) process.exitCode = 2
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(`Certificacao browser falhou: ${formatError(error)}`)
  process.exitCode = 1
})
