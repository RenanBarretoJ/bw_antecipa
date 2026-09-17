#!/usr/bin/env node
// P9.1/P9.5: browser smoke against local or deployed homolog Next + homolog Supabase. Synthetic data only.
import { createHmac, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import puppeteer from 'puppeteer-core'

function loadEnv(path) {
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const split = line.indexOf('=')
    if (split < 1 || line.trimStart().startsWith('#')) continue
    const key = line.slice(0, split).trim()
    let value = line.slice(split + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
function required(key) {
  if (!process.env[key]) throw new Error(`${key} ausente`)
  return process.env[key]
}
function makeCnpj(base12) {
  const digits = base12.replace(/\D/g, '').padStart(12, '0').slice(-12).split('').map(Number)
  const digit = (values, weights) => {
    const rest = values.reduce((sum, value, i) => sum + value * weights[i], 0) % 11
    return rest < 2 ? 0 : 11 - rest
  }
  const d1 = digit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${digits.join('')}${d1}${digit([...digits, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`
}
function makePdf(targetBytes) {
  // One valid page with a long whitespace content stream; no confidential content.
  const chunks = ['%PDF-1.4\n']
  const offsets = [0]
  const add = (body) => { offsets.push(Buffer.byteLength(chunks.join(''))); chunks.push(`${offsets.length - 1} 0 obj\n${body}\nendobj\n`) }
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>')
  const head = 'BT /F1 12 Tf 40 740 Td (P9.1 synthetic PDF) Tj ET\n'
  const pad = Math.max(0, targetBytes - 800 - Buffer.byteLength(chunks.join('')) - head.length)
  add(`<< /Length ${head.length + pad} >>\nstream\n${head}${' '.repeat(pad)}\nendstream`)
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const xref = Buffer.byteLength(chunks.join(''))
  chunks.push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`)
  for (const offset of offsets.slice(1)) chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  chunks.push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.from(chunks.join(''))
}
if (process.argv.includes('--validate-pdf-only')) {
  const parsePdf = (await import('pdf-parse/lib/pdf-parse.js')).default
  const parsed = await parsePdf(makePdf(Math.ceil(5.1 * 1024 * 1024)))
  console.log(JSON.stringify({ syntheticPdf: 'valid', pages: parsed.numpages, textPresent: parsed.text.includes('P9.1 synthetic PDF') }))
  process.exit(parsed.numpages === 1 && parsed.text.includes('P9.1 synthetic PDF') ? 0 : 1)
}
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.toUpperCase().replace(/=+$/, '')) {
    const idx = alphabet.indexOf(char)
    if (idx >= 0) bits += idx.toString(2).padStart(5, '0')
  }
  const key = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', key).update(counter).digest()
  const offset = digest[digest.length - 1] & 15
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]
  return String(binary % 1000000).padStart(6, '0')
}
async function enroll(email, password, label) {
  const client = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
  const sign = await client.auth.signInWithPassword({ email, password })
  if (sign.error) throw new Error(`Login de fixture: ${sign.error.message}`)
  const factor = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: label })
  if (factor.error || !factor.data?.totp?.secret) throw new Error(`Enroll MFA: ${factor.error?.message}`)
  const challenge = await client.auth.mfa.challenge({ factorId: factor.data.id })
  if (challenge.error) throw new Error(`Challenge MFA: ${challenge.error.message}`)
  const verify = await client.auth.mfa.verify({ factorId: factor.data.id, challengeId: challenge.data.id, code: totp(factor.data.totp.secret) })
  if (verify.error) throw new Error(`Verify MFA: ${verify.error.message}`)
  await client.auth.signOut()
  return factor.data.totp.secret
}
async function login(page, email, password, secret) {
  await page.goto(`${appBaseUrl}/login`, { waitUntil: 'networkidle2', timeout: 45000 })
  await page.type('#email', email)
  await page.type('#password', password)
  await Promise.all([page.waitForFunction(() => location.pathname !== '/login', { timeout: 45000 }), page.click('button[type=submit]')])
  if (new URL(page.url()).pathname === '/mfa/desafio') {
    await page.waitForSelector('input[name=code]', { timeout: 45000 })
    await page.type('input[name=code]', totp(secret))
    await Promise.all([page.waitForFunction(() => location.pathname !== '/mfa/desafio', { timeout: 45000 }), page.click('form button[type=submit]')])
  }
}

loadEnv(resolve('.env.homolog'))
const appBaseUrl = process.env.P9_E2E_BASE_URL || 'http://localhost:3001'
if (!['http://localhost:3001', 'https://bw-antecipa-env-homolog-renanbarretoj.vercel.app'].includes(appBaseUrl)) {
  throw new Error('P9_E2E_BASE_URL nao corresponde ao ambiente local ou ao alias oficial de homolog')
}
const projectRef = new URL(required('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0]
if (projectRef !== 'fhgkmggthxikfpogrvaa' || projectRef === required('SUPABASE_PRODUCTION_PROJECT_REF')) throw new Error('Projeto homolog nao confirmado')
const dbUrl = new URL(required('SUPABASE_DB_URL'))
dbUrl.password = required('SUPABASE_PASSWORD')
const db = new pg.Client({ connectionString: dbUrl.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 })
const admin = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { autoRefreshToken: false, persistSession: false } })
if (process.argv.includes('--cleanup-orphans')) {
  throw new Error('Cleanup legado desabilitado. Use p9-2-orphan-reconciler.mjs em preview; exclusao exige path exato e grace period.')
}
const ids = { owner: null, ownerB: null, gestor: null, fundo: null, cedente: null, cedenteB: null }
const suiteId = randomUUID()
const email = `qa-p91-${suiteId}@example.invalid`
const gestorEmail = `qa-p91-gestor-${suiteId}@example.invalid`
const password = `Qa!${randomUUID().replaceAll('-', '')}`
const tmp = mkdtempSync(join(tmpdir(), 'bw-p91-'))
let browser
let page
let network = []
let phaseEvents = []
try {
  await db.connect()
  for (const [role, address] of [['owner', email], ['gestor', gestorEmail]]) {
    const created = await admin.auth.admin.createUser({ email: address, password, email_confirm: true, user_metadata: { role: role === 'owner' ? 'cedente' : 'gestor', nome_completo: `QA P9.1 ${role}` } })
    if (created.error) throw new Error(`Criacao de fixture ${role}: ${created.error.message}`)
    ids[role] = created.data.user.id
  }
  const ownerTotp = await enroll(email, password, 'qa-p91-owner')
  const gestorTotp = await enroll(gestorEmail, password, 'qa-p91-gestor')
  const seed = String(Date.now()).slice(-9)
  ids.fundo = randomUUID()
  await db.query('BEGIN')
  await db.query(`insert into public.fundos (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA P9.1 Fundo',$2,'QA Admin',$3,'QA Gestora',$4,true,$5)`, [ids.fundo, makeCnpj(`8${seed}2`), makeCnpj(`8${seed}3`), makeCnpj(`8${seed}4`), ids.owner])
  const cnpj = makeCnpj(`8${seed}1`)
  ids.cedente = (await db.query(`insert into public.cedentes (user_id,cnpj,razao_social,status) values ($1,$2,'QA P9.1 Cedente','ativo') returning id`, [ids.owner, cnpj])).rows[0].id
  await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo')`, [ids.cedente, ids.fundo])
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [ids.gestor, ids.fundo])
  await db.query('COMMIT')
  browser = await puppeteer.launch({ executablePath: process.env.QA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  page = await browser.newPage()
  network = []
  const requestStarted = new WeakMap()
  phaseEvents = []
  page.on('console', async (message) => {
    if (!message.text().startsWith('document-upload-phase')) return
    try {
      const args = message.args()
      const item = await args[1]?.jsonValue()
      if (item && ['PREPARE', 'UPLOAD', 'FINALIZE', 'RECONCILE', 'CLEANUP'].includes(item.phase)) phaseEvents.push(item)
    } catch { /* console context may have been destroyed by navigation */ }
  })
  page.on('response', (response) => {
    const started = requestStarted.get(response.request())
    if (started) {
      const metric = { phase: started.phase, durationMs: Date.now() - started.at, httpStatus: response.status() }
      phaseEvents.push(metric)
    }
  })
  page.on('requestfailed', (request) => {
    const started = requestStarted.get(request)
    if (started) phaseEvents.push({ phase: started.phase, durationMs: Date.now() - started.at, httpStatus: null,
      outcome: /ERR_ABORTED/i.test(request.failure()?.errorText || '') ? 'CLIENT_ABORT' : 'NETWORK_FAILURE' })
  })
  let prepareActionId = null
  let finalizeActionId = null
  page.on('request', (request) => {
    if (request.method() !== 'POST' && request.method() !== 'PUT') return
    const url = new URL(request.url())
    const isStorage = url.pathname.includes('/storage/v1/object/upload/sign/')
    const actionId = request.headers()['next-action']
    const isApp = url.origin === appBaseUrl
    if (isApp && actionId) {
      const body = request.postData() || ''
      if (!prepareActionId && body.includes('nomeArquivo')) prepareActionId = actionId
      if (!finalizeActionId && /^\["[0-9a-f-]{36}"\]$/i.test(body)) finalizeActionId = actionId
    }
    if (isStorage || (isApp && actionId)) requestStarted.set(request, { at: Date.now(), phase: isStorage ? 'UPLOAD_HTTP' : 'ACTION_HTTP' })
    if (isStorage || isApp) network.push({ destination: isStorage ? 'supabase-storage' : 'local-next', method: request.method(), host: url.hostname, bodyBytes: isStorage ? null : request.postData()?.length ?? 0, serviceRoleUsed: isStorage && [request.headers().authorization?.replace(/^Bearer /i, ''), request.headers().apikey].includes(required('SUPABASE_SERVICE_ROLE_KEY')) })
  })
  await login(page, email, password, ownerTotp)
  await page.goto(`${appBaseUrl}/cedente/documentos`, { waitUntil: 'networkidle2', timeout: 45000 })
  await page.waitForSelector('input[type=file]', { timeout: 30000 })
  const fullMatrix = [
    ['contrato_social', 100 * 1024],
    ['cartao_cnpj', 1024 * 1024],
    ['comprovante_endereco', 4 * 1024 * 1024],
    ['extrato_bancario', 10 * 1024 * 1024],
    ['balanco_patrimonial', 19 * 1024 * 1024],
    ['dre', 5 * 1024 * 1024],
  ]
  const matrix = process.argv.includes('--single-4m') ? [['contrato_social', 4 * 1024 * 1024]]
    : process.argv.includes('--focus-document-flow') ? fullMatrix.slice(0, 1) : fullMatrix
  const results = []
  for (const [tipo, size] of matrix) {
    const filename = `qa-p91-${tipo}-${size}.pdf`
    const file = join(tmp, filename)
    writeFileSync(file, makePdf(size))
    const start = Date.now()
    const before = network.length
    const metricsBefore = phaseEvents.length
    // After each successful upload its input disappears; the next company type is first.
    const input = (await page.$$('input[type=file]'))[0]
    if (!input) throw new Error(`Input ausente para ${tipo}`)
    await input.uploadFile(file)
    await page.waitForFunction((name) => document.body.innerText.includes(name), { timeout: 150000 }, filename)
    await page.waitForFunction(() => !document.body.innerText.includes('Enviando arquivo...') && !document.body.innerText.includes('Finalizando...'), { timeout: 150000 })
    const docs = await db.query(`select id,versao,status,url_arquivo from public.documentos where cedente_id=$1 and tipo=$2 order by versao`, [ids.cedente, tipo])
    const storage = await db.query(`select owner_id,metadata->>'size' as size,metadata->>'mimetype' as mime from storage.objects where bucket_id='documentos-cedentes' and name=$1`, [docs.rows[0]?.url_arquivo])
    const requests = network.slice(before)
    const result = { tipo, bytes: size, seconds: Math.round((Date.now() - start) / 1000), prepare: requests.some((x) => x.destination === 'local-next'), upload: requests.some((x) => x.destination === 'supabase-storage'), storageRequests: requests.filter((x) => x.destination === 'supabase-storage').length, finalize: docs.rows.length === 1 && docs.rows[0].status === 'enviado', storage: storage.rows.length === 1 && storage.rows[0].mime === 'application/pdf', maxNextBodyBytes: Math.max(0, ...requests.filter((x) => x.destination === 'local-next').map((x) => x.bodyBytes)), phaseMetrics: phaseEvents.slice(metricsBefore).map(({ phase, durationMs, httpStatus, outcome }) => ({ phase, durationMs, httpStatus, outcome })) }
    results.push(result)
    console.log(JSON.stringify({ phase: 'size_matrix', ...result }))
    if (!result.prepare || result.storageRequests !== 1 || !result.finalize || !result.storage || result.maxNextBodyBytes > 100000) throw new Error(`Falha na matriz para ${tipo}`)
  }

  if (process.argv.includes('--matrix-only')) {
    console.log(JSON.stringify({ phase: 'matrix_complete', sizes: results.length,
      maxNextBodyBytes: Math.max(...results.map((item) => item.maxNextBodyBytes)) }))
  } else {

  const overLimitName = 'qa-p91-over-20mib.pdf'
  const overLimit = join(tmp, overLimitName)
  writeFileSync(overLimit, makePdf(20 * 1024 * 1024 + 8192))
  if (statSync(overLimit).size <= 20 * 1024 * 1024) throw new Error('Fixture >20 MiB ficou abaixo do limite')
  const beforeOverLimit = network.length
  const overLimitInput = (await page.$$('input[type=file]'))[0]
  if (!overLimitInput) throw new Error('Input para caso >20 MiB ausente')
  await overLimitInput.uploadFile(overLimit)
  await page.waitForFunction(() => !document.body.innerText.includes('Preparando...') && !document.body.innerText.includes('Enviando arquivo...'), { timeout: 30000 })
  const overLimitRequests = network.slice(beforeOverLimit)
  const rejectedBeforeUpload = !overLimitRequests.some((request) => request.destination === 'supabase-storage')
  const overLimitDocs = await db.query(`select count(*)::integer as count from public.documentos where cedente_id=$1 and nome_arquivo=$2`, [ids.cedente, overLimitName])
  console.log(JSON.stringify({ phase: 'over_limit', blockedBeforeStorage: rejectedBeforeUpload, documentCount: overLimitDocs.rows[0].count, otherRequests: overLimitRequests.map(({ destination, bodyBytes }) => ({ destination, bodyBytes })) }))
  if (!rejectedBeforeUpload || overLimitDocs.rows[0].count !== 0) throw new Error('Arquivo >20MiB nao bloqueado antes do upload')

  const firstVersion = await db.query(`select id,url_arquivo from public.documentos where cedente_id=$1 and tipo='contrato_social' and versao=1`, [ids.cedente])
  const gestor = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), { auth: { autoRefreshToken: false, persistSession: false } })
  const gestorSignIn = await gestor.auth.signInWithPassword({ email: gestorEmail, password })
  if (gestorSignIn.error) throw new Error(`Login gestor: ${gestorSignIn.error.message}`)
  const factors = await gestor.auth.mfa.listFactors()
  const factorId = factors.data?.totp?.[0]?.id
  if (!factorId) throw new Error('Fator MFA gestor indisponivel')
  const challenge = await gestor.auth.mfa.challenge({ factorId })
  if (challenge.error) throw new Error(`Challenge gestor: ${challenge.error.message}`)
  const verified = await gestor.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: totp(gestorTotp) })
  if (verified.error) throw new Error(`Verify gestor: ${verified.error.message}`)
  const requested = await gestor.rpc('solicitar_atualizacao_documento_gestor', { p_documento_id: firstVersion.rows[0].id })
  if (requested.error) throw new Error(`Solicitar atualizacao: ${requested.error.message}`)
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForSelector('input[type=file]', { timeout: 30000 })
  await page.waitForFunction(() => document.body.innerText.includes('Atualização solicitada'), { timeout: 30000 })
  const v2File = join(tmp, 'qa-p91-contrato-v2-5mib.pdf')
  writeFileSync(v2File, makePdf(Math.ceil(5.1 * 1024 * 1024)))
  const beforeV2 = network.length
  const v2Input = (await page.$$('input[type=file]'))[0]
  if (!v2Input) throw new Error('Input de atualizacao do Contrato Social nao exibido')
  await v2Input.uploadFile(v2File)
  await page.waitForFunction(() => document.body.innerText.includes('qa-p91-contrato-v2-5mib.pdf'), { timeout: 150000 })
  const versions = await db.query(`select id,versao,status,url_arquivo from public.documentos where cedente_id=$1 and tipo='contrato_social' order by versao`, [ids.cedente])
  console.log(JSON.stringify({ phase: 'v2', versions: versions.rows.map(({ versao, status }) => ({ versao, status })), directStorageRequest: network.slice(beforeV2).some((x) => x.destination === 'supabase-storage'), v1Preserved: versions.rows[0]?.url_arquivo === firstVersion.rows[0].url_arquivo }))
  if (versions.rows.length !== 2 || versions.rows[1].status !== 'enviado' || versions.rows[0].url_arquivo !== firstVersion.rows[0].url_arquivo) throw new Error('V2 nao persistida como nova versao')

  const gestorContext = await browser.createBrowserContext()
  const gestorPage = await gestorContext.newPage()
  await login(gestorPage, gestorEmail, password, gestorTotp)
  await gestorPage.goto(`${appBaseUrl}/gestor/cedentes/${ids.cedente}`, { waitUntil: 'networkidle2', timeout: 45000 })
  await gestorPage.waitForFunction(() => document.body.innerText.includes('QA P9.1 Cedente') || document.body.innerText.includes('Cedente nao encontrado'), { timeout: 45000 })
  await gestorPage.waitForFunction(() => document.body.innerText.includes('qa-p91-contrato-v2-5mib.pdf') || document.body.innerText.includes('Cedente nao encontrado'), { timeout: 30000 })
  const gestorText = await gestorPage.evaluate(() => document.body.innerText)
  console.log(JSON.stringify({ phase: 'gestor_read', showsVersion2: gestorText.includes('qa-p91-contrato-v2-5mib.pdf'), path: new URL(gestorPage.url()).pathname, excerpt: gestorText.slice(0, 400) }))
  if (!gestorText.includes('qa-p91-contrato-v2-5mib.pdf')) throw new Error('Gestor nao enxerga versao V2')

  const analyzeButton = await gestorPage.$('button')
  if (!analyzeButton) throw new Error('Botoes do gestor ausentes')
  const clickedAnalyze = await gestorPage.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Analisar')
    button?.click()
    return Boolean(button)
  })
  if (!clickedAnalyze) throw new Error('Botao Analisar V2 nao encontrado')
  await gestorPage.waitForSelector('iframe[title="qa-p91-contrato-v2-5mib.pdf"]', { timeout: 45000 })
  const previewFrame = await gestorPage.$('iframe[title="qa-p91-contrato-v2-5mib.pdf"]')
  const previewSrc = await previewFrame.evaluate((element) => element.getAttribute('src'))
  console.log(JSON.stringify({ phase: 'gestor_preview', blobUrl: previewSrc?.startsWith('blob:'), version: 2 }))
  if (!previewSrc?.startsWith('blob:')) throw new Error('Preview V2 nao renderizado')
  const clickedApprove = await gestorPage.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Aprovar')
    button?.click()
    return Boolean(button)
  })
  if (!clickedApprove) throw new Error('Botao Aprovar V2 ausente')
  await gestorPage.waitForFunction(() => !document.querySelector('iframe[title="qa-p91-contrato-v2-5mib.pdf"]'), { timeout: 45000 })
  const approved = await db.query('select status from public.documentos where id=$1', [versions.rows[1].id])
  console.log(JSON.stringify({ phase: 'gestor_approve', status: approved.rows[0]?.status }))
  if (approved.rows[0]?.status !== 'aprovado') throw new Error('Aprovacao V2 falhou')

  const clickedUpdate = await gestorPage.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Solicitar Atualização')
    button?.click()
    return Boolean(button)
  })
  if (!clickedUpdate) throw new Error('Botao Solicitar Atualizacao ausente')
  await gestorPage.waitForFunction(() => document.body.innerText.includes('Atualização solicitada'), { timeout: 45000 })
  const updateV2 = await db.query('select atualizacao_solicitada_em from public.documentos where id=$1', [versions.rows[1].id])
  if (!updateV2.rows[0]?.atualizacao_solicitada_em) throw new Error('Solicitacao de atualizacao V2 nao persistiu')
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForSelector('input[type=file]', { timeout: 30000 })
  const v3File = join(tmp, 'qa-p91-contrato-v3.pdf')
  writeFileSync(v3File, makePdf(100 * 1024))
  await (await page.$$('input[type=file]'))[0].uploadFile(v3File)
  await page.waitForFunction(() => document.body.innerText.includes('qa-p91-contrato-v3.pdf'), { timeout: 120000 })
  const v3 = await db.query(`select id,versao,status from public.documentos where cedente_id=$1 and tipo='contrato_social' and versao=3`, [ids.cedente])
  if (v3.rows[0]?.status !== 'enviado') throw new Error('V3 nao enviada')
  await gestorPage.reload({ waitUntil: 'networkidle2' })
  await gestorPage.waitForFunction(() => document.body.innerText.includes('qa-p91-contrato-v3.pdf'), { timeout: 45000 })
  await gestorPage.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Analisar')?.click())
  await gestorPage.waitForSelector('iframe[title="qa-p91-contrato-v3.pdf"]', { timeout: 45000 })
  await gestorPage.type('textarea[placeholder="Descreva o motivo..."]', 'QA P9.1: rejeicao sintetica controlada')
  const clickedReject = await gestorPage.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Reprovar')
    button?.click()
    return Boolean(button)
  })
  if (!clickedReject) throw new Error('Botao Reprovar V3 ausente')
  await gestorPage.waitForFunction(() => !document.querySelector('iframe[title="qa-p91-contrato-v3.pdf"]'), { timeout: 45000 })
  const rejected = await db.query('select status,motivo_reprovacao from public.documentos where id=$1', [v3.rows[0].id])
  console.log(JSON.stringify({ phase: 'gestor_reject', status: rejected.rows[0]?.status, reasonSaved: Boolean(rejected.rows[0]?.motivo_reprovacao), v1v2Preserved: (await db.query(`select count(*)::integer as count from public.documentos where cedente_id=$1 and tipo='contrato_social'`, [ids.cedente])).rows[0].count === 3 }))
  if (rejected.rows[0]?.status !== 'reprovado' || !rejected.rows[0]?.motivo_reprovacao) throw new Error('Reprovacao V3 falhou')

  // Deterministic Storage failure: the browser must clear its loading state and retry.
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForSelector('input[type=file]', { timeout: 30000 })
  const v4File = join(tmp, 'qa-p91-contrato-v4.pdf')
  writeFileSync(v4File, makePdf(100 * 1024))
  let abortNextStorage = true
  const intercept = (request) => {
    if (abortNextStorage && request.url().includes('/storage/v1/object/upload/sign/')) {
      abortNextStorage = false
      void request.abort('failed')
    } else void request.continue()
  }
  await page.setRequestInterception(true)
  page.on('request', intercept)
  await (await page.$$('input[type=file]'))[0].uploadFile(v4File)
  await page.waitForFunction(() => document.body.innerText.includes('Nao foi possivel enviar o arquivo. Tente novamente.'), { timeout: 60000 })
  await page.waitForFunction(() => !document.body.innerText.includes('Preparando...') && !document.body.innerText.includes('Enviando arquivo...') && !document.body.innerText.includes('Finalizando...'), { timeout: 30000 })
  page.off('request', intercept)
  await page.setRequestInterception(false)
  const failedV4 = await db.query(`select count(*)::integer as count from public.documentos where cedente_id=$1 and tipo='contrato_social'`, [ids.cedente])
  console.log(JSON.stringify({ phase: 'storage_failure_recovery', abortedStorage: !abortNextStorage, loadingCleared: true, documentCount: failedV4.rows[0].count }))
  if (abortNextStorage || failedV4.rows[0].count !== 3) throw new Error('Falha de Storage criou versao ou nao foi interceptada')
  await (await page.$$('input[type=file]'))[0].uploadFile(v4File)
  await page.waitForFunction(() => document.body.innerText.includes('qa-p91-contrato-v4.pdf'), { timeout: 120000 })
  const v4 = await db.query(`select id,versao,status,url_arquivo from public.documentos where cedente_id=$1 and tipo='contrato_social' and versao=4`, [ids.cedente])
  if (v4.rows[0]?.status !== 'enviado') throw new Error('Retry apos falha de Storage nao criou V4')
  console.log(JSON.stringify({ phase: 'retry_after_storage_failure', version: v4.rows[0].versao, status: v4.rows[0].status }))

  const ownerBEmail = `qa-p91-owner-b-${suiteId}@example.invalid`
  const createdB = await admin.auth.admin.createUser({ email: ownerBEmail, password, email_confirm: true, user_metadata: { role: 'cedente', nome_completo: 'QA P9.1 Owner B' } })
  if (createdB.error) throw new Error(`Criacao owner B: ${createdB.error.message}`)
  ids.ownerB = createdB.data.user.id
  const cnpjB = makeCnpj(`7${seed}1`)
  ids.cedenteB = (await db.query(`insert into public.cedentes (user_id,cnpj,razao_social,status) values ($1,$2,'QA P9.1 Cedente B','ativo') returning id`, [ids.ownerB, cnpjB])).rows[0].id
  await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo')`, [ids.cedenteB, ids.fundo])
  const clientOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
  const ownerAClient = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), clientOptions)
  const ownerBClient = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), clientOptions)
  const anonClient = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), clientOptions)
  const loginA = await ownerAClient.auth.signInWithPassword({ email, password })
  const loginB = await ownerBClient.auth.signInWithPassword({ email: ownerBEmail, password })
  if (loginA.error || loginB.error) throw new Error('Login cross-tenant de fixture falhou')
  const intentA = (await db.query(`select id from public.documento_upload_intents where cedente_id=$1 and storage_path=$2`, [ids.cedente, v4.rows[0].url_arquivo])).rows[0]?.id
  if (!intentA) throw new Error('Upload V4 sem intent persistido')
  const ownIntent = await ownerAClient.from('documento_upload_intents').select('id').eq('id', intentA).maybeSingle()
  const foreignIntent = await ownerBClient.from('documento_upload_intents').select('id').eq('id', intentA).maybeSingle()
  const anonIntent = await anonClient.from('documento_upload_intents').select('id').eq('id', intentA).maybeSingle()
  const foreignFinalize = await ownerBClient.rpc('finalizar_documento_upload_intent', { p_intent_id: intentA })
  const unauthorizedUpdate = await ownerAClient.from('documento_upload_intents').update({ status: 'CLEANED' }).eq('id', intentA)
  const gestorUpdate = await gestor.from('documento_upload_intents').update({ status: 'CLEANED' }).eq('id', intentA)
  const intentSecurity = { ownRead: ownIntent.data?.id === intentA, crossTenantHidden: !foreignIntent.data,
    anonDenied: Boolean(anonIntent.error) || !anonIntent.data, crossTenantFinalizeDenied: Boolean(foreignFinalize.error),
    arbitraryUpdateDenied: Boolean(unauthorizedUpdate.error), gestorUpdateDenied: Boolean(gestorUpdate.error) }
  console.log(JSON.stringify({ phase: 'intent_rls', ...intentSecurity }))
  if (Object.values(intentSecurity).some((value) => !value)) throw new Error('RLS/RPC de intent permitiu acesso indevido')
  const retryArgs = { p_tipo: 'contrato_social', p_storage_path: v4.rows[0].url_arquivo, p_nome_arquivo: 'qa-p91-contrato-v4.pdf', p_representante_id: null }
  const retry1 = await ownerAClient.rpc('registrar_documento_cadastral_cedente', retryArgs)
  const retry2 = await ownerAClient.rpc('registrar_documento_cadastral_cedente', retryArgs)
  const versionCount = (await db.query(`select count(*)::integer as count from public.documentos where cedente_id=$1 and tipo='contrato_social'`, [ids.cedente])).rows[0].count
  const idempotent = !retry1.error && !retry2.error && retry1.data?.[0]?.documento_id === v4.rows[0].id && retry2.data?.[0]?.documento_id === v4.rows[0].id && versionCount === 4
  console.log(JSON.stringify({ phase: 'rpc_retry', idempotent, documentCount: versionCount }))
  if (!idempotent) throw new Error('Retry da RPC duplicou versao')
  const pathA = `${cnpj}/contrato_social/${randomUUID()}_qa-cross-tenant.pdf`
  const pathB = `${cnpjB}/contrato_social/${randomUUID()}_qa-cross-tenant.pdf`
  const wrongA = await ownerAClient.storage.from('documentos-cedentes').createSignedUploadUrl(pathB)
  const wrongB = await ownerBClient.storage.from('documentos-cedentes').createSignedUploadUrl(pathA)
  const wrongGestor = await gestor.storage.from('documentos-cedentes').createSignedUploadUrl(pathA)
  const wrongAnon = await anonClient.storage.from('documentos-cedentes').createSignedUploadUrl(pathA)
  const bucket = await db.query(`select public from storage.buckets where id='documentos-cedentes'`)
  const security = { ownerACannotPrepareForB: Boolean(wrongA.error), ownerBCannotPrepareForA: Boolean(wrongB.error), anonCannotPrepare: Boolean(wrongAnon.error), privateBucket: bucket.rows[0]?.public === false, noServiceRoleInBrowser: !network.some((x) => x.serviceRoleUsed) }
  console.log(JSON.stringify({ phase: 'cross_tenant', ...security, gestorExistingInsertPolicyAllows: !wrongGestor.error }))
  if (Object.values(security).some((value) => value !== true)) throw new Error('Politica de Storage cross-tenant falhou')

  if (!prepareActionId || !finalizeActionId || prepareActionId === finalizeActionId) throw new Error('Action IDs de prepare/finalize nao identificados para testes negativos')
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForSelector('input[type=file]', { timeout: 30000 })
  const negativeFile = join(tmp, 'qa-p91-negative-flow.pdf')
  writeFileSync(negativeFile, makePdf(100 * 1024))
  let abortPrepare = true
  let abortFinalize = false
  const interceptAction = (request) => {
    const actionId = request.headers()['next-action']
    if (abortPrepare && actionId === prepareActionId) {
      abortPrepare = false
      void request.abort('failed')
    } else if (abortFinalize && actionId === finalizeActionId) {
      abortFinalize = false
      void request.abort('failed')
    } else void request.continue()
  }
  await page.setRequestInterception(true)
  page.on('request', interceptAction)
  await (await page.$$('input[type=file]'))[0].uploadFile(negativeFile)
  await page.waitForFunction(() => document.body.innerText.includes('Nao foi possivel enviar o arquivo. Tente novamente.'), { timeout: 45000 })
  await page.waitForFunction(() => !document.body.innerText.includes('Preparando...') && !document.body.innerText.includes('Enviando arquivo...'), { timeout: 30000 })
  console.log(JSON.stringify({ phase: 'prepare_failure', intercepted: !abortPrepare, loadingCleared: true }))
  if (abortPrepare) throw new Error('Falha de prepare nao foi interceptada')
  const countObjects = async () => (await db.query(`select count(*)::integer as count from storage.objects where bucket_id='documentos-cedentes' and split_part(name,'/',1)=$1`, [cnpj])).rows[0].count
  const objectsBefore = await countObjects()
  abortFinalize = true
  await (await page.$$('input[type=file]'))[0].uploadFile(negativeFile)
  await page.waitForFunction(() => document.body.innerText.includes('qa-p91-negative-flow.pdf'), { timeout: 90000 })
  await page.waitForFunction(() => !document.body.innerText.includes('Preparando...') && !document.body.innerText.includes('Enviando arquivo...') && !document.body.innerText.includes('Finalizando...'), { timeout: 30000 })
  page.off('request', interceptAction)
  await page.setRequestInterception(false)
  const objectsAfter = await countObjects()
  const failedDocument = (await db.query(`select count(*)::integer as count from public.documentos where cedente_id=$1 and nome_arquivo='qa-p91-negative-flow.pdf'`, [ids.cedente])).rows[0].count
  const reconciledAfterLostResponse = objectsAfter === objectsBefore + 1
  const temporaryOrphans = (await db.query(`select o.name from storage.objects o where o.bucket_id='documentos-cedentes' and split_part(o.name,'/',1)=$1 and not exists (select 1 from public.documentos d where d.url_arquivo=o.name)`, [cnpj])).rows
  console.log(JSON.stringify({ phase: 'finalize_response_lost', intercepted: !abortFinalize, loadingCleared: true, reconciledAfterLostResponse, pendingGracePeriod: temporaryOrphans.length, documentCreated: failedDocument > 0 }))
  if (abortFinalize || failedDocument !== 1 || !reconciledAfterLostResponse || temporaryOrphans.length !== 0) throw new Error('Resposta perdida de finalize nao foi reconciliada')

  await db.query(`update public.documentos set atualizacao_solicitada_em=now() where cedente_id=$1 and tipo='cartao_cnpj' and nome_arquivo='qa-p91-negative-flow.pdf'`, [ids.cedente])
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForSelector('input[type=file]', { timeout: 30000 })

  const beforeDouble = network.length
  const doubleFileBase64 = readFileSync(negativeFile).toString('base64')
  await page.evaluate((content) => {
    const input = document.querySelector('input[type=file]')
    const bytes = Uint8Array.from(atob(content), (char) => char.charCodeAt(0))
    const file = new File([bytes], 'qa-p91-negative-flow.pdf', { type: 'application/pdf' })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const transfer = new DataTransfer()
      transfer.items.add(file)
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, doubleFileBase64)
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const count = (await db.query(`select count(*)::integer as n from public.documentos where cedente_id=$1 and nome_arquivo='qa-p91-negative-flow.pdf'`, [ids.cedente])).rows[0].n
    if (count === 2) break
    if (attempt === 29) throw new Error('Segundo envio do duplo clique nao persistiu')
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  const doubleDoc = await db.query(`select count(*)::integer as count from public.documentos where cedente_id=$1 and nome_arquivo='qa-p91-negative-flow.pdf'`, [ids.cedente])
  const doubleUploads = network.slice(beforeDouble).filter((item) => item.destination === 'supabase-storage').length
  console.log(JSON.stringify({ phase: 'double_click', documentCount: doubleDoc.rows[0].count, directStorageRequests: doubleUploads }))
  if (doubleDoc.rows[0].count !== 2 || doubleUploads !== 1) throw new Error('Duplo clique criou upload duplicado')

  // Force a real domain failure after PREPARE and Storage PUT, without
  // changing shared policies: the latest QA document becomes approved just
  // before FINALIZE. The intent must remain durable and cleanup-protected.
  await db.query(`update public.documentos set atualizacao_solicitada_em=now()
    where cedente_id=$1 and tipo='cartao_cnpj' and versao=2`, [ids.cedente])
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForSelector('input[type=file]', { timeout: 30000 })
  const failedFinalizeFile = join(tmp, 'qa-p91-finalize-fail.pdf')
  writeFileSync(failedFinalizeFile, makePdf(100 * 1024))
  let forceFinalizationFailure = true
  const failFinalization = async (request) => {
    try {
      if (forceFinalizationFailure && request.headers()['next-action'] === finalizeActionId) {
        forceFinalizationFailure = false
        await db.query(`update public.documentos set status='aprovado', atualizacao_solicitada_em=null
          where cedente_id=$1 and tipo='cartao_cnpj' and versao=2`, [ids.cedente])
      }
      await request.continue()
    } catch { await request.abort('failed').catch(() => {}) }
  }
  await page.setRequestInterception(true)
  page.on('request', failFinalization)
  try {
    await (await page.$$('input[type=file]'))[0].uploadFile(failedFinalizeFile)
    let failedIntent
    for (let attempt = 0; attempt < 30; attempt += 1) {
      failedIntent = (await db.query(`select id,status,storage_path from public.documento_upload_intents
        where cedente_id=$1 and nome_original='qa-p91-finalize-fail.pdf' order by created_at desc limit 1`, [ids.cedente])).rows[0]
      if (failedIntent?.status === 'FAILED') break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const failureEvidence = (await db.query(`select
      exists(select 1 from storage.objects o where o.bucket_id='documentos-cedentes' and o.name=$1) as object_present,
      exists(select 1 from public.documentos d where d.url_arquivo=$1) as document_present`, [failedIntent?.storage_path || ''])).rows[0]
    console.log(JSON.stringify({ phase: 'failed_finalize_persisted', intentId: failedIntent?.id,
      status: failedIntent?.status, objectPresent: failureEvidence.object_present,
      documentPresent: failureEvidence.document_present, intercepted: !forceFinalizationFailure }))
    if (forceFinalizationFailure || failedIntent?.status !== 'FAILED' || !failureEvidence.object_present || failureEvidence.document_present) {
      throw new Error('Falha real de FINALIZE nao preservou intent e objeto sem documento')
    }
  } finally {
    page.off('request', failFinalization)
    await page.setRequestInterception(false)
  }

  await db.query(`update public.documentos set atualizacao_solicitada_em=now() where cedente_id=$1 and tipo='cartao_cnpj' and versao=2`, [ids.cedente])
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForSelector('input[type=file]', { timeout: 30000 })

  const navigationFile = join(tmp, 'qa-p91-navigation.pdf')
  writeFileSync(navigationFile, makePdf(5 * 1024 * 1024))
  let heldNavigationUpload
  let navigationRequestTimeout
  let navigationRequestStartedResolve
  const navigationRequestStarted = new Promise((resolve, reject) => {
    navigationRequestStartedResolve = resolve
    navigationRequestTimeout = setTimeout(() => reject(new Error('Upload de navegacao nao iniciou')), 30000)
  })
  const holdNavigationUpload = (request) => {
    if (request.url().includes('/storage/v1/object/upload/sign/') && request.method() === 'PUT' && !heldNavigationUpload) {
      heldNavigationUpload = request
      clearTimeout(navigationRequestTimeout)
      navigationRequestStartedResolve()
      return
    }
    void request.continue().catch(() => {})
  }
  await page.setRequestInterception(true)
  page.on('request', holdNavigationUpload)
  try {
    await (await page.$$('input[type=file]'))[0].uploadFile(navigationFile)
    await navigationRequestStarted
    const navigation = page.goto(`${appBaseUrl}/cedente/dashboard`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await heldNavigationUpload.abort('failed').catch(() => {})
    await navigation
  } finally {
    clearTimeout(navigationRequestTimeout)
    page.off('request', holdNavigationUpload)
    if (heldNavigationUpload) await heldNavigationUpload.abort('failed').catch(() => {})
    await page.setRequestInterception(false)
  }
  const routeAfterNavigation = new URL(page.url()).pathname
  await page.goto(`${appBaseUrl}/cedente/documentos`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForSelector('input[type=file]', { timeout: 30000 })
  const visibleLoading = await page.evaluate(() => /Preparando\.\.\.|Enviando arquivo\.\.\.|Finalizando\.\.\./.test(document.body.innerText))
  const orphanRows = (await db.query(`select o.name from storage.objects o where o.bucket_id='documentos-cedentes' and split_part(o.name,'/',1)=$1 and not exists (select 1 from public.documentos d where d.url_arquivo=o.name)`, [cnpj])).rows
  const orphanPaths = orphanRows.map(({ name }) => name).filter((name) => name.startsWith(`${cnpj}/`))
  console.log(JSON.stringify({ phase: 'navigation_during_upload', reachedDashboard: routeAfterNavigation === '/cedente/dashboard', returnedToDocuments: new URL(page.url()).pathname === '/cedente/documentos', visibleLoading, pendingGracePeriod: orphanPaths.length }))
  if (routeAfterNavigation !== '/cedente/dashboard' || visibleLoading) throw new Error('Navegacao durante upload deixou UI bloqueada')

  await db.query(`update public.documentos set atualizacao_solicitada_em=now() where id=(select id from public.documentos where cedente_id=$1 and tipo='cartao_cnpj' order by versao desc limit 1)`, [ids.cedente])
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForSelector('input[type=file]', { timeout: 30000 })
  const closeFile = join(tmp, 'qa-p91-tab-close.pdf')
  writeFileSync(closeFile, makePdf(100 * 1024))
  const storageCommitted = new Promise((resolveStorage) => {
    page.on('response', function storageResponse(response) {
      if (!response.url().includes('/storage/v1/object/upload/sign/') || response.request().method() !== 'PUT') return
      page.off('response', storageResponse)
      resolveStorage({ status: response.status(), closing: page.close() })
    })
  })
  await (await page.$$('input[type=file]'))[0].uploadFile(closeFile)
  const { status: storageStatus, closing } = await storageCommitted
  await closing
  let tabCloseState
  for (let attempt = 0; attempt < 5; attempt += 1) {
    tabCloseState = (await db.query(`select
      (select count(*)::integer from storage.objects where bucket_id='documentos-cedentes' and name like $1) as objects,
      (select count(*)::integer from public.documentos where cedente_id=$2 and nome_arquivo='qa-p91-tab-close.pdf') as documents`, [`${cnpj}/%_qa-p91-tab-close.pdf`, ids.cedente])).rows[0]
    if (tabCloseState.objects) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  console.log(JSON.stringify({ phase: 'tab_close_before_finalize', storageStatus, pendingObjects: tabCloseState.objects, activeDocuments: tabCloseState.documents }))
  if (storageStatus !== 200 || tabCloseState.objects !== 1 || tabCloseState.documents !== 0) throw new Error('Fechamento de aba nao deixou objeto pendente e sem documento ativo')
  const tabIntent = (await db.query(`select id,status,cleanup_after from public.documento_upload_intents
    where cedente_id=$1 and storage_path like $2 order by created_at desc limit 1`,
  [ids.cedente, `${cnpj}/%_qa-p91-tab-close.pdf`])).rows[0]
  console.log(JSON.stringify({ phase: 'tab_close_persistent_intent', intentId: tabIntent?.id,
    status: tabIntent?.status, cleanupInFuture: Date.parse(tabIntent?.cleanup_after || '') > Date.now() }))
  if (!tabIntent || !['PREPARED','UPLOADED'].includes(tabIntent.status) || Date.parse(tabIntent.cleanup_after) <= Date.now()) {
    throw new Error('Fechamento de aba perdeu intent ou grace period')
  }

  console.log(JSON.stringify({ projectRef, fixture: 'synthetic_deactivated', matrix: results.length, directStorageRequests: network.filter((x) => x.destination === 'supabase-storage').length, maxNextBodyBytes: Math.max(0, ...network.filter((x) => x.destination === 'local-next').map((x) => x.bodyBytes)), serviceRoleUsedInBrowser: network.some((x) => x.serviceRoleUsed) }))
  }
} catch (error) {
  let ui = null
  try {
    ui = page && !page.isClosed() ? await page.evaluate(() => ({
      route: location.pathname,
      preparing: document.body.innerText.includes('Preparando...'),
      sending: document.body.innerText.includes('Enviando arquivo...'),
      finalizing: document.body.innerText.includes('Finalizando...'),
      confirming: document.body.innerText.includes('Estamos confirmando o envio...'),
      uploadErrorVisible: document.body.innerText.includes('Nao foi possivel enviar o arquivo.'),
    })) : null
  } catch { /* Browser may have navigated or closed. */ }
  console.error(JSON.stringify({ projectRef, error: error instanceof Error ? error.message : String(error), ui,
    recentPhases: phaseEvents.slice(-16).map(({ phase, durationMs, httpStatus, outcome }) => ({ phase, durationMs, httpStatus, outcome })),
    recentDestinations: network.slice(-8).map(({ destination, method, bodyBytes }) => ({ destination, method, bodyBytes })) }))
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  try { await db.query('ROLLBACK') } catch { /* no open transaction */ }
  if (ids.fundo) {
    try { await db.query('update public.fundos set ativo=false where id=$1', [ids.fundo]) } catch (error) { console.error('Fixture requer desativacao manual:', error.message) }
  }
  await db.end().catch(() => {})
  if (!tmp.startsWith(join(tmpdir(), 'bw-p91-'))) throw new Error('Diretorio temporario fora do escopo esperado')
  await rm(tmp, { recursive: true, force: true })
}
