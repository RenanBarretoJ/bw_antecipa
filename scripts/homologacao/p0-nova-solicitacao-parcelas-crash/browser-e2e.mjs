#!/usr/bin/env node
// P0: "Nova solicitacao quebra ao selecionar NF com parcelas" (rota
// /cedente/operacoes/nova). Causa raiz REAL, achada pelo usuario ao vivo
// no deploy do Vercel testando a NF real 3493 (nao a NF-56/78, que
// nunca tiveram parcela vencida): uma parcela cujo vencimento
// INDIVIDUAL ja passou (ontem, por exemplo), mesmo quando o vencimento
// AGREGADO da NF (a ultima parcela) ainda esta no futuro -- essa NF
// passa pelo filtro de elegibilidade da listagem (que so olha o
// vencimento agregado), mas ao selecionar a NF a parcela vencida entra
// em `calcularAntecipacaoEmLote`, que lanca `CalculoFinanceiroError`
// (NF_VENCIDA) sem nenhum tratamento no corpo do render do componente
// cliente -- quebrando a pagina inteira ("This page couldn't load").
// Confirmado isolando o calculo com os numeros reais da NF-3493
// (`src/lib/operacoes/calculo.ts`, via vitest) antes de tocar em codigo.
//
// Corrigido em duas camadas (`src/lib/operacoes/nova-solicitacao.server.ts`
// e `src/app/cedente/operacoes/nova/nova-solicitacao-client.tsx`) -- ver
// relatorio para o detalhe completo. Este script cobre os 3 cenarios
// reais (NF-78, NF-56, NF-3493) num unico fluxo, contra um servidor Next
// local apontando para homolog (`npm run dev:homolog`, porta 3001) e
// Chrome instalado localmente (mesmo padrao de scripts/perf9a/browser-
// final-homolog.mjs). Cria e aprova uma fixture real (nao revertida -- o
// servidor Next precisa le-la por uma conexao HTTP separada), e a
// desativa (fundo inativo, politica desativada) ao final -- documentos
// aprovados e a versao de politica publicada permanecem por imutabilidade
// de auditoria (mesma regra do sistema; sem qualquer dado de cliente real
// afetado).

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

const email = `qa-nova-solic-crash-${randomUUID()}@example.invalid`
const password = `Qa!${randomUUID().replace(/-/g, '').slice(0, 20)}`
let userId = null
let gestorId = null
let fundoId = null

try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'cedente', nome_completo: 'QA Nova Solicitacao Crash' } })
  if (created.error) throw new Error(`Falha ao criar usuario cedente: ${created.error.message}`)
  userId = created.data.user.id
  const totpSecret = await enrollTotp({ email, password })

  const gestorEmail = `qa-nova-solic-crash-gestor-${randomUUID()}@example.invalid`
  const createdGestor = await admin.auth.admin.createUser({ email: gestorEmail, password: `Qa!${randomUUID().replace(/-/g, '').slice(0, 20)}`, email_confirm: true, user_metadata: { role: 'gestor', nome_completo: 'QA Nova Solicitacao Crash Gestor' } })
  if (createdGestor.error) throw new Error(`Falha ao criar usuario gestor: ${createdGestor.error.message}`)
  gestorId = createdGestor.data.user.id

  await db.query('BEGIN')
  fundoId = randomUUID()
  const seed = String(Date.now()).slice(-9)
  const cnpjMatriz = makeCnpj(`9${seed}1`)
  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Nova Solicitacao Crash Fundo',$2,'QA Admin',$3,'QA Gestora',$4,true,$5)`, [
    fundoId, makeCnpj(`9${seed}2`), makeCnpj(`9${seed}3`), makeCnpj(`9${seed}4`), userId,
  ])
  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Nova Solicitacao Crash Cedente','ativo') returning id`, [userId, cnpjMatriz])).rows[0].id
  const cedenteFundoId = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente, fundoId])).rows[0].id
  await db.query(`insert into public.taxas_cedente (cedente_id, prazo_min, prazo_max, taxa_percentual) values ($1, 1, 400, 2.5)`, [cedente])
  const matriz = (await db.query(`select id from public.cedente_estabelecimentos where cedente_id=$1 and tipo='matriz'`, [cedente])).rows[0].id
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [gestorId, fundoId])

  const politica = (await db.query(`insert into public.politicas_operacionais
    (fundo_id, codigo, nome, status, created_by) values ($1,'QA-NOVA-SOLIC-CRASH','QA Politica Nova Solicitacao Crash','ativa',$2) returning id`, [fundoId, userId])).rows[0].id
  const politicaVersao = (await db.query(`insert into public.politica_operacional_versoes
    (politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde, conteudo_hash, metodo_calculo_financeiro)
    values ($1,$2,$3,1,now(),'qa-hash-nova-solic-crash','DIAS_UTEIS_252') returning id`, [politica, cedenteFundoId, fundoId])).rows[0].id
  // Reproduz a politica REAL da NF-56/78: XML/DANFE/CTE (por_nf) + BOLETO
  // (por_parcela), todos obrigatorios.
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
    await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb) resultado`, [nfId, JSON.stringify(parcelas)])
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

    await db.query('RESET ROLE')
    await db.query(`update public.notas_fiscais set status='aprovada' where id=$1`, [nfId])
    return nfId
  }

  await criarNfTotalmenteSatisfeita('78-QACRASH', 110160.00, '2026-11-25', [
    { numero_parcela: 1, valor_nominal: 27540.00, data_vencimento: '2026-10-11' },
    { numero_parcela: 2, valor_nominal: 27540.00, data_vencimento: '2026-10-26' },
    { numero_parcela: 3, valor_nominal: 27540.00, data_vencimento: '2026-11-10' },
    { numero_parcela: 4, valor_nominal: 27540.00, data_vencimento: '2026-11-25' },
  ])
  await criarNfTotalmenteSatisfeita('56-QACRASH', 13396.00, '2026-10-19', [
    { numero_parcela: 1, valor_nominal: 4465.33, data_vencimento: '2026-08-31' },
    { numero_parcela: 2, valor_nominal: 4465.33, data_vencimento: '2026-09-21' },
    { numero_parcela: 3, valor_nominal: 4465.34, data_vencimento: '2026-10-19' },
  ])
  // Reproduz a NF-3493 real (achada pelo usuario ao vivo no Vercel): a
  // parcela 1 vence ONTEM em relacao a data-base de hoje, mas o
  // vencimento agregado da NF (a ultima parcela) ainda esta no futuro --
  // por isso a NF passa pela elegibilidade da listagem, mas selecionar
  // essa NF alimentava a parcela vencida em calcularAntecipacaoEmLote,
  // que lancava CalculoFinanceiroError sem tratamento no render e
  // quebrava a pagina inteira.
  const ontem = new Date(Date.parse(new Date().toISOString().slice(0, 10)) - 86_400_000).toISOString().slice(0, 10)
  await criarNfTotalmenteSatisfeita('3493-QACRASH', 3162.00, '2026-09-16', [
    { numero_parcela: 1, valor_nominal: 1054.00, data_vencimento: ontem },
    { numero_parcela: 2, valor_nominal: 1054.00, data_vencimento: '2026-09-02' },
    { numero_parcela: 3, valor_nominal: 1054.00, data_vencimento: '2026-09-16' },
  ])
  await db.query('RESET ROLE')
  await db.query('COMMIT')
  ok('Fixture (politica XML/DANFE/CTE+BOLETO por_parcela, 2 NFs 100% aprovadas) criada em homolog', true)

  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const page = await browser.newPage()
    const consoleErrors = []
    const pageErrors = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('pageerror', (error) => { pageErrors.push(String(error)) })

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
    ok('Login do cedente de teste concluido sem erro', new URL(page.url()).pathname !== '/login')

    await page.goto(`${baseUrl}/cedente/operacoes/nova`, { waitUntil: 'networkidle2', timeout: 45_000 })
    const initialText = await page.evaluate(() => document.body.innerText)
    ok('Pagina inicial lista as 3 NFs com a contagem de parcelas correta', (
      initialText.includes('78-QACRASH') && initialText.includes('4 parcela(s)')
      && initialText.includes('56-QACRASH') && initialText.includes('3 parcela(s)')
      // NF-3493: 3 parcelas no banco, mas so 2 sao "disponiveis para
      // antecipacao" apos a correcao (a vencida e excluida do carregamento).
      && initialText.includes('3493-QACRASH') && initialText.includes('2 parcela(s)')
    ))

    await clickButtonContaining(page, '78-QACRASH')
    await wait(1200)
    const afterNf78 = await page.evaluate(() => document.body.innerText)
    ok('Selecionar a NF de 4 parcelas expande a lista sem crash (invariante: expandir)', (
      !crashDetectado(afterNf78) && afterNf78.includes('Parcela 004')
    ))
    ok('Todas as 4 parcelas vem selecionadas por padrao (resumo = R$ 110.160,00 bruto)', afterNf78.includes('110.160,00'))

    await clickButtonContaining(page, 'Parcela 001')
    await wait(800)
    const afterDeselectParcela = await page.evaluate(() => document.body.innerText)
    ok('Desmarcar 1 parcela atualiza o resumo (bruto cai para R$ 82.620,00 = 3x27.540) sem crash', (
      !crashDetectado(afterDeselectParcela) && afterDeselectParcela.includes('82.620,00')
    ))
    await clickButtonContaining(page, 'Parcela 001')
    await wait(800)

    await clickButtonContaining(page, '56-QACRASH')
    await wait(1200)
    const afterAmbas = await page.evaluate(() => document.body.innerText)
    ok('Selecionar as 2 NFs simultaneamente coexiste sem crash (bruto = R$ 123.556,00)', (
      !crashDetectado(afterAmbas) && afterAmbas.includes('123.556,00') && afterAmbas.includes('2 selecionada')
    ))

    await clickButtonContaining(page, '78-QACRASH')
    await wait(600)
    await clickButtonContaining(page, '78-QACRASH')
    await wait(1000)
    const afterToggle = await page.evaluate(() => document.body.innerText)
    ok('Desmarcar e remarcar a NF de 4 parcelas restaura estado consistente sem crash', (
      !crashDetectado(afterToggle) && afterToggle.includes('Parcela 004') && afterToggle.includes('123.556,00')
    ))

    // Cenario real da NF-3493: parcela 1 vencida (ontem), vencimento
    // agregado da NF ainda no futuro. Antes da correcao, isso quebrava a
    // pagina inteira ao selecionar a NF. Desmarca as outras duas NFs
    // primeiro para isolar o resumo desta selecao.
    await clickButtonContaining(page, '78-QACRASH')
    await clickButtonContaining(page, '56-QACRASH')
    await wait(500)
    await clickButtonContaining(page, '3493-QACRASH')
    await wait(1200)
    const afterNf3493 = await page.evaluate(() => document.body.innerText)
    ok('Selecionar a NF com parcela vencida (cenario real da NF-3493) NAO quebra a pagina', !crashDetectado(afterNf3493))
    ok('A parcela vencida (001) e excluida da lista selecionavel -- so parcelas 002/003 aparecem', (
      !afterNf3493.includes('Parcela 001') && afterNf3493.includes('Parcela 002') && afterNf3493.includes('Parcela 003')
    ))
    ok('Resumo soma corretamente so as 2 parcelas vigentes (R$ 2.108,00 = 2x1.054,00)', afterNf3493.includes('2.108,00'))

    ok('Nenhum console.error disparado durante toda a sequencia', consoleErrors.length === 0, JSON.stringify(consoleErrors))
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
  // Documentos aprovados (documento_versoes) e a versao de politica
  // publicada sao imutaveis por design (triggers de auditoria) -- nao e
  // possivel purgar. A fixture e apenas desativada (fundo inativo,
  // politica desativada), inerte e sem qualquer dado de cliente real
  // afetado -- mesmo padrao de tolerancia do dataset PERF9A (scripts/
  // perf9a/seed-homolog.mjs), que tambem permanece em homolog.
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
}

async function clickButtonContaining(page, text) {
  const clicked = await page.evaluate((needle) => {
    const target = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes(needle))
    if (!target) return false
    target.click()
    return true
  }, text)
  if (!clicked) throw new Error(`Botao contendo "${text}" nao encontrado.`)
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
  const enrollment = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'qa-nova-solic-crash' })
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
  return `qa/nova-solicitacao-crash/${randomUUID()}.dat`
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
