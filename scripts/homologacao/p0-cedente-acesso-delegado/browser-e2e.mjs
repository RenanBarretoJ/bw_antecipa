#!/usr/bin/env node
// P0 (incidente real, reportado ao vivo pelo usuario): um usuario CONVIDADO
// como acesso delegado a um cedente (cedente_acessos, perfil administrador
// -- distinto do dono, cedentes.user_id) ficava travado em
// "/cedente/cadastro" em toda navegacao (middleware) e via menu restrito de
// onboarding para sempre (CedenteLayout), mesmo com o cedente ativo --
// porque as duas checagens filtravam cedentes so por user_id (o dono),
// nunca considerando cedente_acessos. A tela "Acessos Vinculados" do gestor
// tambem mostrava "Nenhum usuario adicional vinculado" mesmo com convites
// ativos (cedente_acessos so tem GRANT para service_role desde a
// canonicalizacao de ACL/RLS 20260817150507; a leitura direta pelo client
// autenticado falhava em silencio).
//
// Confirma no browser real, contra o servidor Next local (`npm run
// dev:homolog`, porta 3001) apontando para homolog, que um usuario
// convidado (nao dono) enxerga o menu completo do Cedente e navega
// normalmente para /cedente/dashboard (sem ser preso em /cedente/cadastro),
// e que o gestor ve o convite em "Acessos Vinculados". Fixture committed-
// then-deactivated (mesmo padrao ja usado nesta sessao: o Next server le
// via conexao HTTP separada da do script).

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

const ownerEmail = `qa-acesso-vinc-owner-${randomUUID()}@example.invalid`
const ownerPassword = `Qa!${randomUUID().replace(/-/g, '').slice(0, 20)}`
const invitedEmail = `qa-acesso-vinc-invited-${randomUUID()}@example.invalid`
const invitedPassword = `Qa!${randomUUID().replace(/-/g, '').slice(0, 20)}`
const gestorEmail = `qa-acesso-vinc-gestor-${randomUUID()}@example.invalid`
const gestorPassword = `Qa!${randomUUID().replace(/-/g, '').slice(0, 20)}`
let ownerId = null
let invitedId = null
let gestorId = null
let fundoId = null
let cedenteId = null

try {
  const createdOwner = await admin.auth.admin.createUser({ email: ownerEmail, password: ownerPassword, email_confirm: true, user_metadata: { role: 'cedente', nome_completo: 'QA Owner' } })
  if (createdOwner.error) throw new Error(`Falha ao criar owner: ${createdOwner.error.message}`)
  ownerId = createdOwner.data.user.id

  const createdInvited = await admin.auth.admin.createUser({ email: invitedEmail, password: invitedPassword, email_confirm: true, user_metadata: { role: 'cedente', nome_completo: 'QA Invited Admin' } })
  if (createdInvited.error) throw new Error(`Falha ao criar convidado: ${createdInvited.error.message}`)
  invitedId = createdInvited.data.user.id
  const totpSecretInvited = await enrollTotp({ email: invitedEmail, password: invitedPassword, label: 'qa-acesso-vinc-invited' })

  const createdGestor = await admin.auth.admin.createUser({ email: gestorEmail, password: gestorPassword, email_confirm: true, user_metadata: { role: 'gestor', nome_completo: 'QA Gestor Acesso' } })
  if (createdGestor.error) throw new Error(`Falha ao criar gestor: ${createdGestor.error.message}`)
  gestorId = createdGestor.data.user.id
  const totpSecretGestor = await enrollTotp({ email: gestorEmail, password: gestorPassword, label: 'qa-acesso-vinc-gestor' })

  await db.query('BEGIN')
  fundoId = randomUUID()
  const seed = String(Date.now()).slice(-9)
  const cnpjMatriz = makeCnpj(`9${seed}1`)
  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Acesso Vinculado Fundo',$2,'QA Admin',$3,'QA Gestora',$4,true,$5)`, [
    fundoId, makeCnpj(`9${seed}2`), makeCnpj(`9${seed}3`), makeCnpj(`9${seed}4`), ownerId,
  ])
  cedenteId = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente Acesso Vinculado','ativo') returning id`, [ownerId, cnpjMatriz])).rows[0].id
  await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo')`, [cedenteId, fundoId])
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [gestorId, fundoId])
  await db.query('COMMIT')
  ok('Fixture (owner + fundo + cedente ativo) criada e commitada em homolog', true)

  // Convite feito exatamente como convidarUsuarioCedente faz (via admin/
  // service_role) -- so apos o COMMIT acima, para o cedente ja estar
  // visivel pela conexao HTTP separada do admin client.
  const insertAcesso = await admin.from('cedente_acessos').insert({ cedente_id: cedenteId, user_id: invitedId, perfil: 'administrador', convidado_por: gestorId }).select('id')
  if (insertAcesso.error) throw new Error(`Falha ao inserir cedente_acessos: ${insertAcesso.error.message}`)
  ok('cedente_acessos inserido com sucesso (via admin/service_role)', Boolean(insertAcesso.data?.[0]?.id))

  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => { pageErrors.push(String(error)) })

    await loginComTotp(page, invitedEmail, invitedPassword, totpSecretInvited)
    ok('Login do usuario CONVIDADO (nao dono) concluido sem erro', new URL(page.url()).pathname !== '/login')

    await page.goto(`${baseUrl}/cedente/dashboard`, { waitUntil: 'networkidle2', timeout: 45_000 })
    await page.waitForFunction(() => document.body.innerText.includes('Minhas Operacoes') || document.body.innerText.includes('Minhas Operações') || document.body.innerText.includes('Cadastro do Cedente'), { timeout: 15_000 })
    ok(
      'FIX CONFIRMADO (middleware): navegar para /cedente/dashboard chega ao dashboard, sem ser preso em /cedente/cadastro',
      new URL(page.url()).pathname === '/cedente/dashboard',
      new URL(page.url()).pathname,
    )
    const sidebarTexto = await page.evaluate(() => document.body.innerText)
    // "Meus CNPJs" fica escondido por design quando permite_cadastro_filiais=false
    // e nao ha filiais ainda (feature separada, correta) -- nao faz parte desta checagem.
    ok('FIX CONFIRMADO (CedenteLayout): usuario convidado ve o menu COMPLETO (Minhas NFs/Minhas Operacoes), nao mais so o restrito de onboarding', (
      /Minhas NFs/.test(sidebarTexto) && (/Minhas Operacoes/.test(sidebarTexto) || /Minhas Operações/.test(sidebarTexto))
    ))

    // Achado ao vivo pelo usuario, apos o fix inicial: consertar so
    // middleware/CedenteLayout deixava o usuario convidado chegar ao
    // dashboard, mas Meus CNPJs/Minhas NFs/Minhas Operacoes ainda quebravam
    // ("This page couldn't load") ou vinham vazias -- mesmo padrao
    // .eq('user_id', ...) em mais 9 pontos de chamada, corrigidos junto.
    for (const rota of ['/cedente/estabelecimentos', '/cedente/notas-fiscais', '/cedente/operacoes']) {
      await page.goto(`${baseUrl}${rota}`, { waitUntil: 'networkidle2', timeout: 45_000 })
      const textoPagina = await page.evaluate(() => document.body.innerText)
      ok(
        `FIX CONFIRMADO (varredura user_id-only): ${rota} carrega sem "This page couldn't load" para o usuario convidado`,
        !/could(n't| not) load|application error|erro inesperado/i.test(textoPagina) && new URL(page.url()).pathname === rota,
        new URL(page.url()).pathname,
      )
    }

    const gestorContext = await browser.createBrowserContext()
    const gestorPage = await gestorContext.newPage()
    await loginComTotp(gestorPage, gestorEmail, gestorPassword, totpSecretGestor)
    ok('Login do gestor concluido sem erro', new URL(gestorPage.url()).pathname !== '/login')

    await gestorPage.goto(`${baseUrl}/gestor/cedentes/${cedenteId}`, { waitUntil: 'networkidle2', timeout: 45_000 })
    await gestorPage.waitForFunction(() => document.body.innerText.includes('Acessos Vinculados'), { timeout: 15_000 })
    const gestorTexto = await gestorPage.evaluate(() => document.body.innerText)
    ok('FIX CONFIRMADO (listarAcessosVinculadosCedente): gestor ve o acesso convidado em "Acessos Vinculados" (nao mais "Nenhum usuario adicional vinculado")', (
      gestorTexto.includes('QA Invited Admin') && !gestorTexto.includes('Nenhum usuario adicional vinculado')
    ))
    ok(
      'FIX CONFIRMADO (dropdown Fundo Vinculado): mostra o NOME do fundo, nao o uuid cru',
      gestorTexto.includes('QA Acesso Vinculado Fundo') && !gestorTexto.includes(fundoId),
    )

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
  // documento_versoes aprovados e politicas publicadas sao imutaveis por
  // design (mesma regra do sistema) -- nao ha nada assim nesta fixture, so
  // desativamos o fundo (mesmo padrao ja usado nesta sessao).
  try {
    await db.query('ROLLBACK').catch(() => undefined)
    if (fundoId) await db.query(`update public.fundos set ativo=false where id=$1`, [fundoId])
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
