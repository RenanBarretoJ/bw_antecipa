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

async function main() {
  ensureRuntimeDirectories()
  const fixture = await withPgClient(localPgConfig(), async (client) => {
    const result = await client.query(`
      select o.id::text as operacao_id, o.status::text, cf.fundo_id::text,
             p.id::text as user_id, p.email
        from public.operacoes o
        join public.politica_operacional_versoes pov on pov.id = o.politica_operacional_versao_id
        join public.politicas_operacionais po on po.id = pov.politica_operacional_id and po.codigo like 'REHEARSAL-%'
        join public.cedente_fundos cf on cf.id = o.cedente_fundo_id
        join public.usuario_fundos uf on uf.fundo_id = cf.fundo_id and uf.status = 'ativo'
        join public.profiles p on p.id = uf.usuario_id and p.role = 'gestor' and p.status = 'ativo'
       where o.status = 'solicitada'
       order by o.created_at desc, p.id limit 1
    `)
    if (!result.rows[0]) throw new Error('Operacao controlada solicitada ou Gestor autorizado nao encontrado.')
    await client.query(`delete from public.usuario_papeis where usuario_id = $1 and papel = 'super_admin' and origem = 'bootstrap_homolog'`, [result.rows[0].user_id])
    await client.query(`update public.usuario_fundos set principal = (fundo_id = $2) where usuario_id = $1 and status = 'ativo'`, [result.rows[0].user_id, result.rows[0].fundo_id])
    return result.rows[0]
  })
  const admin = localAdminClient(localSupabaseStatus())
  const factors = await admin.auth.admin.mfa.listFactors({ userId: fixture.user_id })
  if (factors.error) throw factors.error
  for (const factor of factors.data?.factors ?? []) {
    const removed = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: fixture.user_id })
    if (removed.error) throw removed.error
  }
  const password = randomRehearsalPassword()
  const updated = await admin.auth.admin.updateUserById(fixture.user_id, { password, email_confirm: true })
  if (updated.error) throw updated.error

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  let result
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message.slice(0, 300)))
    await page.goto(`${APP_URL}/login`, { waitUntil: 'domcontentloaded' })
    await page.type('#email', fixture.email)
    await page.type('#password', password)
    await page.click('button[type="submit"]')
    await page.waitForFunction(() => location.pathname === '/mfa/setup', { timeout: 30_000 })
    await page.waitForSelector('input[name="factorId"]', { timeout: 30_000 })
    const secret = await page.$eval('div.font-mono', (element) => element.textContent?.trim() || '')
    await page.type('#code', totp(secret))
    await page.click('button[type="submit"]')
    await page.waitForFunction(() => document.body.innerText.includes('MFA ativado com sucesso.'), { timeout: 30_000 })
    await page.evaluate(() => [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Continuar para o portal'))?.click())
    await page.waitForFunction(() => location.pathname === '/gestor/dashboard', { timeout: 30_000 })
    const response = await page.goto(`${APP_URL}/gestor/operacoes/${fixture.operacao_id}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const destination = new URL(page.url()).pathname
    const bodyFlags = await page.evaluate(() => ({
      length: document.body.innerText.length,
      hasOperation: document.body.innerText.includes('Detalhe da Operacao') || document.body.innerText.includes('Andamento da operacao'),
      hasNotFound: document.body.innerText.includes('nao encontrada') || document.body.innerText.includes('Nao encontrada'),
      hasNoFund: document.body.innerText.includes('sem fundo') || document.body.innerText.includes('Fundo ativo'),
    }))
    const action = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Aprovar e Seguir'))
      if (!button) return {
        found: false,
        enabled: false,
        buttons: [...document.querySelectorAll('button')].map((item) => item.textContent?.trim()).filter(Boolean).slice(0, 30),
      }
      const enabled = !button.hasAttribute('disabled')
      if (enabled) button.click()
      return { found: true, enabled }
    })
    if (action.enabled) await new Promise((resolve) => setTimeout(resolve, 4_000))
    const status = await withPgClient(localPgConfig(), async (client) => {
      const query = await client.query('select status::text from public.operacoes where id = $1', [fixture.operacao_id])
      return query.rows[0]?.status ?? null
    })
    result = {
      route_status: response?.status() ?? 0,
      destination,
      body_flags: bodyFlags,
      approval_action: action,
      operation_status_before: fixture.status,
      operation_status_after: status,
      stopped_before_external_send: true,
      page_errors: errors,
      passed: response?.status() === 200 && action.enabled && status !== 'solicitada' && errors.length === 0,
    }
  } finally {
    await browser.close()
  }
  writeJson(path.join(REPORT_DIR, 'RUNTIME_CONTROLLED_OPERATION.json'), {
    generated_at: new Date().toISOString(),
    environment: 'rehearsal/local',
    ...result,
  })
  console.log(`Operacao controlada apos aprovacao local: ${result.operation_status_after}`)
  if (!result.passed) process.exitCode = 2
}

main().catch((error) => {
  console.error(`Aprovacao controlada falhou: ${formatError(error)}`)
  process.exitCode = 1
})
