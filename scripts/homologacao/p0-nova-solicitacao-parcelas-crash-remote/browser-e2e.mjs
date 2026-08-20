#!/usr/bin/env node
// P0: reproduzir (ou nao) o crash de "Nova solicitacao quebra ao
// selecionar NF com parcelas" contra o deploy REAL de homolog no Vercel
// -- nao localhost. O mesmo fluxo NAO reproduziu contra `npm run
// dev:homolog` local (ver scripts/homologacao/p0-nova-solicitacao-
// parcelas-crash/browser-e2e.mjs, 10/10 PASS), entao este script mira
// exatamente `QA_BASE_URL` (default: a URL do Vercel homolog informada no
// ticket) para descartar/confirmar divergencia de deploy/runtime.
//
// Backend: o mesmo Supabase de homologacao (fhgkmggthxikfpogrvaa,
// confirmado pelo header Content-Security-Policy do deploy real) -- a
// fixture criada aqui (mesma politica XML/DANFE/CTE+BOLETO por_parcela
// das NF-56/78 reais, 100% aprovada) fica visivel para QUALQUER frontend
// que aponte para esse projeto, local ou remoto.
//
// Captura obrigatoria por cenario: console errors, pageerror (excecao JS
// nao tratada), requestfailed, responses HTTP >=400, screenshot antes/
// depois do clique (salvos localmente, fora do repositorio).

import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import puppeteer from 'puppeteer-core'

const EXPECTED_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const CHROME_PATH = process.env.QA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const baseUrl = process.env.QA_BASE_URL || 'https://bw-antecipa-env-homolog-renanbarretoj.vercel.app'
const screenshotDir = process.env.QA_SCREENSHOT_DIR || resolve('.')
const findings = []
const results = []

loadEnv(resolve('.env.homolog'))
const apiRef = new URL(required('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0]
const productionRef = required('SUPABASE_PRODUCTION_PROJECT_REF')
if (apiRef !== EXPECTED_PROJECT_REF) throw new Error(`Projeto de homologacao inesperado: ${apiRef}`)
if (apiRef === productionRef) throw new Error('Projeto de producao bloqueado.')
const databaseUrl = new URL(required('SUPABASE_DB_URL'))
databaseUrl.password = required('SUPABASE_PASSWORD')

const db = new pg.Client({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } })
await db.connect()
const admin = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
})

const email = `qa-nova-solic-remote-${randomUUID()}@example.invalid`
const password = `Qa!${randomUUID().replace(/-/g, '').slice(0, 20)}`
let userId = null
let gestorId = null
let fundoId = null

try {
  console.log(`Alvo remoto: ${baseUrl}`)
  console.log(`Projeto Supabase: ${apiRef}`)

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'cedente', nome_completo: 'QA Nova Solicitacao Remote' } })
  if (created.error) throw new Error(`Falha ao criar usuario cedente: ${created.error.message}`)
  userId = created.data.user.id
  const totpSecret = await enrollTotp({ email, password })

  const gestorEmail = `qa-nova-solic-remote-gestor-${randomUUID()}@example.invalid`
  const createdGestor = await admin.auth.admin.createUser({ email: gestorEmail, password: `Qa!${randomUUID().replace(/-/g, '').slice(0, 20)}`, email_confirm: true, user_metadata: { role: 'gestor', nome_completo: 'QA Nova Solicitacao Remote Gestor' } })
  if (createdGestor.error) throw new Error(`Falha ao criar usuario gestor: ${createdGestor.error.message}`)
  gestorId = createdGestor.data.user.id

  await db.query('BEGIN')
  fundoId = randomUUID()
  const seed = String(Date.now()).slice(-9)
  const cnpjMatriz = makeCnpj(`9${seed}1`)
  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Nova Solicitacao Remote Fundo',$2,'QA Admin',$3,'QA Gestora',$4,true,$5)`, [
    fundoId, makeCnpj(`9${seed}2`), makeCnpj(`9${seed}3`), makeCnpj(`9${seed}4`), userId,
  ])
  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Nova Solicitacao Remote Cedente','ativo') returning id`, [userId, cnpjMatriz])).rows[0].id
  const cedenteFundoId = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente, fundoId])).rows[0].id
  await db.query(`insert into public.taxas_cedente (cedente_id, prazo_min, prazo_max, taxa_percentual) values ($1, 1, 400, 2.5)`, [cedente])
  const matriz = (await db.query(`select id from public.cedente_estabelecimentos where cedente_id=$1 and tipo='matriz'`, [cedente])).rows[0].id
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [gestorId, fundoId])

  const politica = (await db.query(`insert into public.politicas_operacionais
    (fundo_id, codigo, nome, status, created_by) values ($1,'QA-NOVA-SOLIC-REMOTE','QA Politica Nova Solicitacao Remote','ativa',$2) returning id`, [fundoId, userId])).rows[0].id
  const politicaVersao = (await db.query(`insert into public.politica_operacional_versoes
    (politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde, conteudo_hash, metodo_calculo_financeiro)
    values ($1,$2,$3,1,now(),'qa-hash-nova-solic-remote','DIAS_UTEIS_252') returning id`, [politica, cedenteFundoId, fundoId])).rows[0].id
  await db.query(`insert into public.politica_requisitos_documentais
    (politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id, codigo, escopo, momento_obrigatorio, categoria, tipo_documento_codigo, obrigatorio, bloqueia_fluxo, responsavel_upload, responsavel_aprovacao) values
    ($1,$2,$3,'XML_NF','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_xml',true,true,'cedente','gestor'),
    ($1,$2,$3,'DANFE','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_danfe_pdf',true,true,'cedente','gestor'),
    ($1,$2,$3,'CTE','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','cte',true,true,'cedente','gestor'),
    ($1,$2,$3,'BOLETO_PARCELA','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','boleto',true,true,'cedente','gestor')`, [politicaVersao, politica, cedenteFundoId])
  await db.query(`update public.politica_operacional_versoes set publicada_por=$1, publicada_em=now() where id=$2`, [userId, politicaVersao])
  await db.query(`insert into public.cedente_fundo_politicas (cedente_fundo_id, politica_operacional_id, status, atribuido_por)
    values ($1,$2,'ativa',$3)`, [cedenteFundoId, politica, userId])

  const tipos = (await db.query(`select codigo, id from public.documento_tipos where codigo in ('nf_xml','nf_danfe_pdf','cte_xml','boleto')`)).rows
  const tipoId = Object.fromEntries(tipos.map((row) => [row.codigo, row.id]))

  async function criarNfTotalmenteSatisfeita(numero, valorBruto, dataVencimento, parcelas) {
    const nfId = (await db.query(`insert into public.notas_fiscais
      (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
       cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
      values ($1,$2,$3,$4,'1','2026-09-10',$5,$6,'QA Emitente','12345678000199','QA Sacado',$7,'rascunho')
      returning id`, [cedente, cedenteFundoId, fundoId, numero, dataVencimento, cnpjMatriz, valorBruto])).rows[0].id
    await asActor(userId)
    if (parcelas.length) {
      await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb) resultado`, [nfId, JSON.stringify(parcelas)])
    }
    await db.query(`select public.instanciar_requisitos_nota($1,$2,$3) resultado`, [nfId, politica, politicaVersao])

    for (const [codigo, tipoCodigo] of [['nf_xml', 'nf_xml'], ['nf_danfe_pdf', 'nf_danfe_pdf'], ['cte', 'cte_xml']]) {
      const requisito = (await db.query(`select id from public.documento_requisito_instancias where nota_fiscal_id=$1 and tipo_documento_codigo_snapshot=$2`, [nfId, codigo])).rows[0]
      await asActor(userId)
      const upload = (await db.query(`select public.registrar_documento_upload(
        $1,$2,$3,$4,'application/octet-stream',2048,$5,'documentos-v2',$6,$7) resultado`,
        [nfId, requisito.id, tipoId[tipoCodigo], `${codigo}.dat`, sha(), path(), userId])).rows[0].resultado
      await asActor(gestorId)
      await db.query(`select public.analisar_documento_versao($1,'aprovado',null)`, [upload.versao_id])
    }

    if (parcelas.length) {
      const requisitosBoleto = (await db.query(`select dri.id, nfp.numero_parcela
        from public.documento_requisito_instancias dri
        join public.nota_fiscal_parcelas nfp on nfp.id = dri.parcela_id
        where dri.nota_fiscal_id=$1 and dri.tipo_documento_codigo_snapshot='boleto' order by nfp.numero_parcela`, [nfId])).rows
      for (const requisito of requisitosBoleto) {
        await asActor(userId)
        const upload = (await db.query(`select public.registrar_documento_boleto_parcela(
          $1,$2,$3,$4,'boleto.pdf','application/pdf',1000,$5,'documentos-v2',$6,$7,null) resultado`,
          [nfId, requisito.id, tipoId.boleto, matriz, sha(), path(), userId])).rows[0].resultado
        await asActor(gestorId)
        await db.query(`select public.analisar_documento_boleto_gestor($1,'aprovado',null)`, [upload.versao_id])
      }
    }

    await db.query('RESET ROLE')
    await db.query(`update public.notas_fiscais set status='aprovada' where id=$1`, [nfId])
    return nfId
  }

  await criarNfTotalmenteSatisfeita('78-QAREMOTE', 110160.00, '2026-11-25', [
    { numero_parcela: 1, valor_nominal: 27540.00, data_vencimento: '2026-10-11' },
    { numero_parcela: 2, valor_nominal: 27540.00, data_vencimento: '2026-10-26' },
    { numero_parcela: 3, valor_nominal: 27540.00, data_vencimento: '2026-11-10' },
    { numero_parcela: 4, valor_nominal: 27540.00, data_vencimento: '2026-11-25' },
  ])
  await criarNfTotalmenteSatisfeita('56-QAREMOTE', 13396.00, '2026-10-19', [
    { numero_parcela: 1, valor_nominal: 4465.33, data_vencimento: '2026-08-31' },
    { numero_parcela: 2, valor_nominal: 4465.33, data_vencimento: '2026-09-21' },
    { numero_parcela: 3, valor_nominal: 4465.34, data_vencimento: '2026-10-19' },
  ])
  await criarNfTotalmenteSatisfeita('SEMPARC-QAREMOTE', 5000.00, '2026-10-30', [])
  await db.query('RESET ROLE')
  await db.query('COMMIT')
  record('Fixture criada e aprovada no Supabase de homologacao (visivel para o deploy remoto)', true)

  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const page = await browser.newPage()
    const consoleErrors = []
    const pageErrors = []
    const requestFailures = []
    const httpErrors = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('pageerror', (error) => { pageErrors.push(String(error)) })
    page.on('requestfailed', (request) => { requestFailures.push({ url: request.url(), error: request.failure()?.errorText || 'failed' }) })
    page.on('response', (response) => {
      if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() })
    })

    const loginResponse = await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle2', timeout: 45_000 })
    record('GET /login responde 200', loginResponse?.status() === 200, `status=${loginResponse?.status()}`)
    await page.type('#email', email)
    await page.type('#password', password)
    await Promise.all([
      page.waitForFunction(() => !location.pathname.endsWith('/login'), { timeout: 45_000 }),
      page.click('button[type="submit"]'),
    ])
    if (new URL(page.url()).pathname === '/mfa/desafio') {
      await page.waitForSelector('input[name="code"]', { timeout: 45_000 })
      await page.type('input[name="code"]', generateTotp(totpSecret))
      await Promise.all([
        page.waitForFunction(() => !location.pathname.endsWith('/mfa/desafio'), { timeout: 45_000 }),
        page.click('form button[type="submit"]'),
      ])
    }
    record('Login do cedente de teste concluido sem erro (deploy remoto)', new URL(page.url()).pathname !== '/login', `url final=${page.url()}`)

    await page.goto(`${baseUrl}/cedente/operacoes/nova`, { waitUntil: 'networkidle2', timeout: 45_000 })
    await screenshot(page, '01-lista-inicial')
    const initialText = await page.evaluate(() => document.body.innerText)
    record('Pagina /cedente/operacoes/nova lista as 3 NFs de teste', (
      initialText.includes('78-QAREMOTE') && initialText.includes('56-QAREMOTE') && initialText.includes('SEMPARC-QAREMOTE')
    ), initialText.slice(0, 500))

    for (const label of ['78-QAREMOTE (4 parcelas)', '56-QAREMOTE (3 parcelas)', 'SEMPARC-QAREMOTE (sem parcelas)']) {
      const needle = label.split(' ')[0]
      const before = await page.evaluate(() => document.body.innerText)
      let clicked = false
      let clickError = null
      try {
        clicked = await clickButtonContaining(page, needle)
      } catch (error) {
        clickError = error instanceof Error ? error.message : String(error)
      }
      await wait(1500)
      const after = await page.evaluate(() => document.body.innerText)
      await screenshot(page, `02-apos-clicar-${needle}`)
      const crashed = crashDetectado(after)
      record(`Selecionar ${label} nao quebra a pagina`, clicked && !crashed && !clickError, JSON.stringify({ clicked, clickError, crashed, httpErrorsAteAqui: [...httpErrors], requestFailuresAteAqui: [...requestFailures] }))
      if (crashed || clickError) {
        findings.push({ label, before: before.slice(0, 800), after: after.slice(0, 2000), consoleErrors: [...consoleErrors], pageErrors: [...pageErrors] })
      }
      // Desmarca de novo para nao acumular estado entre os 3 casos.
      if (clicked && !crashed) {
        try { await clickButtonContaining(page, needle) } catch { /* melhor esforco */ }
        await wait(500)
      }
    }

    record('Nenhum requestfailed durante toda a sessao', requestFailures.length === 0, JSON.stringify(requestFailures))
    record('Nenhuma resposta HTTP >=400 durante toda a sessao', httpErrors.length === 0, JSON.stringify(httpErrors))
    record('Nenhum console.error durante toda a sessao', consoleErrors.length === 0, JSON.stringify(consoleErrors))
    record('Nenhuma excecao JS (pageerror) durante toda a sessao', pageErrors.length === 0, JSON.stringify(pageErrors))
  } finally {
    await browser.close()
  }
} catch (error) {
  record('Execucao completou sem erro fatal do script', false, error instanceof Error ? error.message : String(error))
} finally {
  try {
    await db.query('ROLLBACK').catch(() => undefined)
    await db.query('RESET ROLE').catch(() => undefined)
    if (fundoId) {
      await db.query(`update public.politicas_operacionais set status='desativada' where fundo_id=$1`, [fundoId])
      await db.query(`update public.fundos set ativo=false where id=$1`, [fundoId])
    }
  } catch (cleanupError) {
    console.error('Falha ao desativar a fixture -- requer verificacao manual:', cleanupError.message)
  }
  await db.end()

  console.log(JSON.stringify({
    base_url: baseUrl,
    supabase_project: apiRef,
    passed: results.filter((item) => item.status === 'PASS').length,
    failed: results.filter((item) => item.status === 'FAIL').length,
    checks: results,
    findings,
  }, null, 2))
  if (results.some((item) => item.status === 'FAIL')) process.exitCode = 1
}

async function clickButtonContaining(page, text) {
  return page.evaluate((needle) => {
    const target = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes(needle))
    if (!target) return false
    target.click()
    return true
  }, text)
}

async function screenshot(page, name) {
  try {
    await page.screenshot({ path: resolve(screenshotDir, `${name}.png`), fullPage: true })
  } catch (error) {
    console.error(`Falha ao capturar screenshot ${name}:`, error.message)
  }
}

function crashDetectado(text) {
  return /This page could not be found|Application error|couldn.?t load|erro inesperado|unhandled runtime error/i.test(text)
}

function wait(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

async function enrollTotp({ email: userEmail, password: userPassword }) {
  const client = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const signIn = await client.auth.signInWithPassword({ email: userEmail, password: userPassword })
  if (signIn.error) throw new Error(`Falha ao autenticar para enroll MFA: ${signIn.error.message}`)
  const enrollment = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'qa-nova-solic-remote' })
  if (enrollment.error || !enrollment.data?.id || !enrollment.data.totp?.secret) {
    throw new Error(`Falha ao cadastrar TOTP: ${enrollment.error?.message || 'retorno incompleto'}`)
  }
  const challenge = await client.auth.mfa.challenge({ factorId: enrollment.data.id })
  if (challenge.error || !challenge.data?.id) throw new Error(`Falha ao criar desafio TOTP: ${challenge.error?.message || 'retorno incompleto'}`)
  let verifyError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const verify = await client.auth.mfa.verify({ factorId: enrollment.data.id, challengeId: challenge.data.id, code: generateTotp(enrollment.data.totp.secret) })
    verifyError = verify.error
    if (!verifyError) break
    await wait(1000)
  }
  await client.auth.signOut()
  if (verifyError) throw new Error(`Falha ao confirmar TOTP: ${verifyError.message}`)
  return enrollment.data.totp.secret
}

function generateTotp(secret, now = Date.now()) {
  const key = decodeBase32(secret)
  const counter = Math.floor(now / 30_000)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  )
  return String(binary % 1_000_000).padStart(6, '0')
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const cleaned = value.toUpperCase().replace(/=+$/, '')
  let bits = ''
  for (const char of cleaned) {
    const index = alphabet.indexOf(char)
    if (index === -1) continue
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

async function asActor(actorUserId) {
  const claims = { sub: actorUserId, role: 'authenticated', aal: 'aal2', session_id: randomUUID() }
  await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)])
  await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [actorUserId])
  await db.query(`select set_config('request.jwt.claim.role','authenticated',true)`)
  await db.query('SET LOCAL ROLE authenticated')
}

function sha() {
  return randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64)
}
function path() {
  return `qa/nova-solicitacao-remote/${randomUUID()}.dat`
}
function makeCnpj(base12) {
  const digits = base12.replace(/\D/g, '').padStart(12, '0').slice(-12).split('').map(Number)
  const digit = (values, weights) => {
    const rest = values.reduce((sum, value, index) => sum + value * weights[index], 0) % 11
    return rest < 2 ? 0 : 11 - rest
  }
  const d1 = digit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digit([...digits, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${digits.join('')}${d1}${d2}`
}
function record(name, condition, evidence = null) {
  results.push({ name, status: condition ? 'PASS' : 'FAIL', ...(evidence ? { evidence } : {}) })
  console.log(`[${condition ? 'PASS' : 'FAIL'}] ${name}${evidence ? ` -- ${typeof evidence === 'string' ? evidence.slice(0, 300) : JSON.stringify(evidence).slice(0, 300)}` : ''}`)
}
function required(key) {
  const value = process.env[key]
  if (!value) throw new Error(`${key} ausente em .env.homolog.`)
  return value
}
function loadEnv(path) {
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
