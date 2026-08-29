#!/usr/bin/env node
// P0 (Parte A - UI): valida ao vivo, num browser real contra o servidor Next
// local apontando para homolog, que "Parcelas da Nota Fiscal" aparece na
// ordem exigida pelo ticket (Dados da Nota Fiscal -> Emitente -> Destinatario
// -> Valores -> Parcelas da Nota Fiscal) e que "Data de Vencimento" some do
// card "Dados da Nota Fiscal"/"Dados da NF" quando a NF tem parcelas -- nas
// duas paginas de detalhe de NF (Cedente e Gestor), nos dois modos do
// Cedente (formulario editavel em rascunho e somente-leitura pos-aprovacao).
// NF sem parcelas preserva o legado (Data de Vencimento continua visivel).

import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import puppeteer from 'puppeteer-core'

const EXPECTED_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const CHROME_PATH = process.env.QA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const baseUrl = process.env.QA_BASE_URL || 'http://localhost:3001'
const checks = []

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

const cedenteEmail = `qa-ui-parcelas-nf-${randomUUID()}@example.invalid`
const cedentePassword = `Qa!${randomUUID().replace(/-/g, '').slice(0, 20)}`
const gestorEmail = `qa-ui-parcelas-nf-gestor-${randomUUID()}@example.invalid`
const gestorPassword = `Qa!${randomUUID().replace(/-/g, '').slice(0, 20)}`
let cedenteUserId = null
let gestorUserId = null
let fundoId = null

try {
  const createdCedente = await admin.auth.admin.createUser({ email: cedenteEmail, password: cedentePassword, email_confirm: true, user_metadata: { role: 'cedente', nome_completo: 'QA UI Parcelas NF Cedente' } })
  if (createdCedente.error) throw new Error(`Falha ao criar usuario cedente: ${createdCedente.error.message}`)
  cedenteUserId = createdCedente.data.user.id
  const totpSecretCedente = await enrollTotp({ email: cedenteEmail, password: cedentePassword, label: 'qa-ui-parcelas-nf-cedente' })

  const createdGestor = await admin.auth.admin.createUser({ email: gestorEmail, password: gestorPassword, email_confirm: true, user_metadata: { role: 'gestor', nome_completo: 'QA UI Parcelas NF Gestor' } })
  if (createdGestor.error) throw new Error(`Falha ao criar usuario gestor: ${createdGestor.error.message}`)
  gestorUserId = createdGestor.data.user.id
  const totpSecretGestor = await enrollTotp({ email: gestorEmail, password: gestorPassword, label: 'qa-ui-parcelas-nf-gestor' })

  await db.query('BEGIN')
  fundoId = randomUUID()
  const seed = String(Date.now()).slice(-9)
  const cnpjMatriz = makeCnpj(`9${seed}1`)
  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA UI Parcelas NF Fundo',$2,'QA Admin',$3,'QA Gestora',$4,true,$5)`, [
    fundoId, makeCnpj(`9${seed}2`), makeCnpj(`9${seed}3`), makeCnpj(`9${seed}4`), cedenteUserId,
  ])
  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA UI Parcelas NF Cedente','ativo') returning id`, [cedenteUserId, cnpjMatriz])).rows[0].id
  const cedenteFundoId = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente, fundoId])).rows[0].id
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [gestorUserId, fundoId])

  async function asActor(actorUserId) {
    const claims = { sub: actorUserId, role: 'authenticated', aal: 'aal2', session_id: randomUUID() }
    await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)])
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [actorUserId])
    await db.query(`select set_config('request.jwt.claim.role','authenticated',true)`)
    await db.query('SET LOCAL ROLE authenticated')
  }

  async function novaNf(numero, valorBruto, dataVencimento, status) {
    return (await db.query(`insert into public.notas_fiscais
      (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
       cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
      values ($1,$2,$3,$4,'1','2026-09-10',$5,$6,'QA Emitente','12345678000199','QA Sacado',$7,$8)
      returning id`, [cedente, cedenteFundoId, fundoId, numero, dataVencimento, cnpjMatriz, valorBruto, status])).rows[0].id
  }

  // NF-A: com parcelas, rascunho (exercita o formulario EDITAVEL do cedente).
  const nfComParcelasRascunho = await novaNf('UI-PARC-01', 10000.00, '2026-10-26', 'rascunho')
  await asActor(cedenteUserId)
  await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb) resultado`, [nfComParcelasRascunho, JSON.stringify([
    { numero_parcela: 1, valor_nominal: 5000.00, data_vencimento: '2026-10-11' },
    { numero_parcela: 2, valor_nominal: 5000.00, data_vencimento: '2026-10-26' },
  ])])

  // NF-B: com parcelas, aprovada (exercita o modo SOMENTE-LEITURA do cedente e a pagina do gestor).
  const nfComParcelasAprovada = await novaNf('UI-PARC-02', 10000.00, '2026-10-26', 'aprovada')
  await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb) resultado`, [nfComParcelasAprovada, JSON.stringify([
    { numero_parcela: 1, valor_nominal: 5000.00, data_vencimento: '2026-10-11' },
    { numero_parcela: 2, valor_nominal: 5000.00, data_vencimento: '2026-10-26' },
  ])])

  // NF-C: sem parcelas, aprovada (regressao -- legado deve permanecer intacto).
  const nfSemParcelas = await novaNf('UI-PARC-03', 8000.00, '2026-10-26', 'aprovada')

  await db.query('RESET ROLE')
  await db.query('COMMIT')
  ok('Fixture (3 NFs: com parcelas em rascunho, com parcelas aprovada, sem parcelas aprovada) criada em homolog', true)

  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => { pageErrors.push(String(error)) })

    await loginComTotp(page, cedenteEmail, cedentePassword, totpSecretCedente)
    ok('Login do cedente de teste concluido sem erro', new URL(page.url()).pathname !== '/login')

    // ---- NF-A: cedente, rascunho, COM parcelas -> formulario editavel ----
    await page.goto(`${baseUrl}/cedente/notas-fiscais/${nfComParcelasRascunho}`, { waitUntil: 'networkidle2', timeout: 45_000 })
    await page.waitForFunction(() => document.body.innerText.includes('Parcelas da Nota Fiscal'), { timeout: 15_000 })
    const textoRascunho = await page.evaluate(() => document.body.innerText)
    const ordemRascunho = [
      textoRascunho.indexOf('Dados da Nota Fiscal'),
      textoRascunho.indexOf('Emitente (Cedente)'),
      textoRascunho.indexOf('Destinatario (Sacado / Devedor)'),
      textoRascunho.indexOf('Valores'),
      textoRascunho.indexOf('Parcelas da Nota Fiscal'),
    ]
    ok('Cedente/rascunho (NF com parcelas, form editavel): ordem Dados -> Emitente -> Destinatario -> Valores -> Parcelas', (
      ordemRascunho.every((value) => value > -1) && ordemRascunho.every((value, index) => index === 0 || value > ordemRascunho[index - 1])
    ), JSON.stringify(ordemRascunho))
    ok('Cedente/rascunho (NF com parcelas): "Data de Vencimento *" NAO aparece no formulario', !textoRascunho.includes('Data de Vencimento *'))

    // ---- NF-B: cedente, aprovada, COM parcelas -> somente-leitura ----
    await page.goto(`${baseUrl}/cedente/notas-fiscais/${nfComParcelasAprovada}`, { waitUntil: 'networkidle2', timeout: 45_000 })
    await page.waitForFunction(() => document.body.innerText.includes('Parcelas da Nota Fiscal'), { timeout: 15_000 })
    const textoAprovadaCedente = await page.evaluate(() => document.body.innerText)
    const ordemAprovadaCedente = [
      textoAprovadaCedente.indexOf('Dados da Nota Fiscal'),
      textoAprovadaCedente.indexOf('Emitente'),
      textoAprovadaCedente.indexOf('Destinatário'),
      textoAprovadaCedente.indexOf('Valores'),
      textoAprovadaCedente.indexOf('Parcelas da Nota Fiscal'),
    ]
    ok('Cedente/aprovada (NF com parcelas, somente-leitura): ordem Dados -> Emitente -> Destinatario -> Valores -> Parcelas', (
      ordemAprovadaCedente.every((value) => value > -1) && ordemAprovadaCedente.every((value, index) => index === 0 || value > ordemAprovadaCedente[index - 1])
    ), JSON.stringify(ordemAprovadaCedente))
    const cardDadosCedenteAprovada = textoAprovadaCedente.slice(ordemAprovadaCedente[0], ordemAprovadaCedente[1])
    ok('Cedente/aprovada (NF com parcelas): label "Vencimento" do card "Dados da Nota Fiscal" NAO aparece', !cardDadosCedenteAprovada.includes('Vencimento'), cardDadosCedenteAprovada)

    // ---- NF-C: cedente, aprovada, SEM parcelas -> legado preservado ----
    await page.goto(`${baseUrl}/cedente/notas-fiscais/${nfSemParcelas}`, { waitUntil: 'networkidle2', timeout: 45_000 })
    await page.waitForFunction(() => document.body.innerText.includes('Dados da Nota Fiscal'), { timeout: 15_000 })
    const textoSemParcelas = await page.evaluate(() => document.body.innerText)
    ok('Cedente/aprovada (NF SEM parcelas): "Parcelas da Nota Fiscal" nao renderiza (legado)', !textoSemParcelas.includes('Parcelas da Nota Fiscal'))
    ok('Cedente/aprovada (NF SEM parcelas): label "Vencimento" continua visivel no card "Dados da Nota Fiscal" (legado preservado)', /vencimento/i.test(textoSemParcelas))

    // ---- Gestor: NF-B (com parcelas) -- contexto incognito separado, para nao herdar a sessao do cedente ----
    const gestorContext = await browser.createBrowserContext()
    const gestorPage = await gestorContext.newPage()
    await loginComTotp(gestorPage, gestorEmail, gestorPassword, totpSecretGestor)
    ok('Login do gestor de teste concluido sem erro', new URL(gestorPage.url()).pathname !== '/login')

    await gestorPage.goto(`${baseUrl}/gestor/notas-fiscais/${nfComParcelasAprovada}`, { waitUntil: 'networkidle2', timeout: 45_000 })
    await gestorPage.waitForFunction(() => document.body.innerText.includes('Parcelas da Nota Fiscal') || document.body.innerText.includes('Nota fiscal nao encontrada'), { timeout: 15_000 })
    const textoGestor = await gestorPage.evaluate(() => document.body.innerText)
    ok('Gestor consegue ver a NF (fundo ativo resolvido -- nao cai em "nao encontrada")', !textoGestor.includes('Nota fiscal nao encontrada'), textoGestor.slice(0, 200))
    const ordemGestor = [
      textoGestor.indexOf('Dados da NF'),
      textoGestor.indexOf('Emitente'),
      textoGestor.indexOf('Destinatario'),
      textoGestor.indexOf('Valores'),
      textoGestor.indexOf('Parcelas da Nota Fiscal'),
    ]
    ok('Gestor (NF com parcelas): ordem Dados da NF -> Emitente -> Destinatario -> Valores -> Parcelas', (
      ordemGestor.every((value) => value > -1) && ordemGestor.every((value, index) => index === 0 || value > ordemGestor[index - 1])
    ), JSON.stringify(ordemGestor))
    ok('Gestor (NF com parcelas): "Data Vencimento" NAO aparece no card "Dados da NF"', !textoGestor.slice(0, ordemGestor[3]).includes('Data Vencimento'))
    ok('Gestor (NF com parcelas): sidebar "Dias ate vencimento" (agregado legado) continua visivel -- nao foi removido', textoGestor.includes('Dias ate vencimento'))

    ok('Nenhuma excecao JS (pageerror) disparada durante toda a sequencia', pageErrors.length === 0, JSON.stringify(pageErrors))
  } finally {
    await browser.close()
  }

  console.log(JSON.stringify({
    project_ref: apiRef,
    fixture: 'committed_then_deactivated',
    passed: checks.filter((item) => item.status === 'PASS').length,
    failed: checks.filter((item) => item.status === 'FAIL').length,
    checks,
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ project_ref: apiRef, error: error instanceof Error ? error.message : String(error), checks }, null, 2))
  process.exitCode = 1
} finally {
  try {
    await db.query('ROLLBACK').catch(() => undefined)
    await db.query('RESET ROLE').catch(() => undefined)
    if (fundoId) {
      await db.query(`update public.fundos set ativo=false where id=$1`, [fundoId])
    }
  } catch (cleanupError) {
    console.error('Falha ao desativar a fixture -- requer verificacao manual:', cleanupError.message)
  }
  await db.end()
}

async function loginComTotp(page, email, password, totpSecret) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle2', timeout: 45_000 })
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
}

async function enrollTotp({ email: userEmail, password: userPassword, label }) {
  const client = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const signIn = await client.auth.signInWithPassword({ email: userEmail, password: userPassword })
  if (signIn.error) throw new Error(`Falha ao autenticar para enroll MFA: ${signIn.error.message}`)
  const enrollment = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: label })
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

function wait(ms) {
  return new Promise((done) => setTimeout(done, ms))
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

function ok(name, condition, evidence = null) {
  checks.push({ name, status: condition ? 'PASS' : 'FAIL', ...(evidence ? { evidence } : {}) })
  if (!condition) throw new Error(`Falha E2E: ${name}${evidence ? ` (${evidence})` : ''}`)
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
