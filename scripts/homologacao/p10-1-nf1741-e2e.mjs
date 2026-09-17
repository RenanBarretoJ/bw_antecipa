#!/usr/bin/env node
// P10.1/P10.2: local Next or homolog deploy. Synthetic PDF; no production mutations.
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import puppeteer from 'puppeteer-core'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'

function loadEnv(file) {
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const i = raw.indexOf('=')
    if (i < 1 || raw.trimStart().startsWith('#')) continue
    const key = raw.slice(0, i).trim()
    let value = raw.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
function env(key) { if (!process.env[key]) throw new Error(`${key} ausente`); return process.env[key] }
function assert(ok, label) { if (!ok) throw new Error(label); console.log(JSON.stringify({ check: label, status: 'PASS' })) }
function cnpj(base) {
  const digit = (v, weights) => { const r = [...v].reduce((s, d, i) => s + Number(d) * weights[i], 0) % 11; return r < 2 ? 0 : 11 - r }
  const first = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base}${first}${digit(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`
}
function accessKey(emitente, numero = 1741) {
  const first43 = `292609${emitente}55001${String(numero).padStart(9, '0')}1${randomBytes(4).readUInt32BE().toString().padStart(8, '0').slice(-8)}`
  if (first43.length !== 43) throw new Error('Chave sintética inválida')
  let weight = 2; let sum = 0
  for (const digit of [...first43].reverse()) { sum += Number(digit) * weight; weight = weight === 9 ? 2 : weight + 1 }
  const mod = 11 - (sum % 11)
  return `${first43}${mod >= 10 ? 0 : mod}`
}
function pdf(lines) {
  const chunks = ['%PDF-1.4\n']
  const offsets = [0]
  const add = (body) => { offsets.push(Buffer.byteLength(chunks.join(''))); chunks.push(`${offsets.length - 1} 0 obj\n${body}\nendobj\n`) }
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>')
  const message = lines.join(' | ').replace(/[\\()]/g, '\\$&')
  const head = `BT /F1 8 Tf 40 740 Td (${message}) Tj ET\n`
  const pad = ' '.repeat(100000)
  add(`<< /Length ${head.length + pad.length} >>\nstream\n${head}${pad}\nendstream`)
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const xref = Buffer.byteLength(chunks.join(''))
  chunks.push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`)
  for (const offset of offsets.slice(1)) chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  chunks.push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.from(chunks.join(''))
}
function pdfTwoPages(firstLines, secondLines) {
  const chunks = ['%PDF-1.4\n']
  const offsets = [0]
  const add = (body) => { offsets.push(Buffer.byteLength(chunks.join(''))); chunks.push(`${offsets.length - 1} 0 obj\n${body}\nendobj\n`) }
  const stream = (lines) => {
    const message = lines.join(' | ').replace(/[\\()]/g, '\\$&')
    const head = `BT /F1 8 Tf 40 740 Td (${message}) Tj ET\n`
    const pad = ' '.repeat(100000)
    return `<< /Length ${head.length + pad.length} >>\nstream\n${head}${pad}\nendstream`
  }
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>')
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>')
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>')
  add(stream(firstLines))
  add(stream(secondLines))
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const xref = Buffer.byteLength(chunks.join(''))
  chunks.push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`)
  for (const offset of offsets.slice(1)) chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  chunks.push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.from(chunks.join(''))
}
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.toUpperCase().replace(/=+$/, '')) bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  const key = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2)))
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', key).update(counter).digest(); const i = digest[19] & 15
  return String(((((digest[i] & 127) << 24) | (digest[i + 1] << 16) | (digest[i + 2] << 8) | digest[i + 3]) >>> 0) % 1000000).padStart(6, '0')
}

loadEnv(resolve('.env.homolog'))
const apiUrl = env('NEXT_PUBLIC_SUPABASE_URL')
const project = new URL(apiUrl).hostname.split('.')[0]
const dbUrl = new URL(env('SUPABASE_DB_URL')); dbUrl.password = env('SUPABASE_PASSWORD')
if (project !== 'fhgkmggthxikfpogrvaa' || project === env('SUPABASE_PRODUCTION_PROJECT_REF') || !`${dbUrl.hostname} ${decodeURIComponent(dbUrl.username)}`.includes(project)) throw new Error('Destino homolog não confirmado')
const app = (process.env.P10_APP_URL || 'http://localhost:3001').replace(/\/$/, '')
const appUrl = new URL(app)
if (!['http://localhost:3001', 'https://bw-antecipa-env-homolog-renanbarretoj.vercel.app'].includes(appUrl.origin) || appUrl.pathname !== '/') throw new Error('Destino da aplicacao nao autorizado para QA P10')
const admin = createClient(apiUrl, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { autoRefreshToken: false, persistSession: false } })
const db = new pg.Client({ connectionString: dbUrl.toString(), ssl: { rejectUnauthorized: false }, application_name: 'bw_p10_1_nf1741_e2e' })
const qa = { user: null, cedente: randomUUID(), fundo: null, emitente: null, nfs: [], paths: [] }
const temp = mkdtempSync(join(tmpdir(), 'bw-p10-1-'))
let browser
let failure
try {
  await db.connect()
  const fund = await db.query('select id from public.fundos where ativo is true order by created_at, id limit 1')
  assert(fund.rowCount === 1, 'Fundo de homolog ativo')
  qa.fundo = fund.rows[0].id
  const stamp = String(Date.now()).slice(-9)
  const emitente = cnpj(`81${stamp}1`)
  qa.emitente = emitente
  const dest = cnpj(`82${stamp}1`)
  const chave = accessKey(emitente)
  const chaveXml = accessKey(emitente, 1742)
  const email = `qa-p101-${randomUUID()}@example.invalid`
  const password = `Qa!${randomUUID().replaceAll('-', '')}`
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'cedente', nome_completo: 'QA P10.1' } })
  if (created.error) throw created.error
  qa.user = created.data.user.id
  await db.query("insert into public.cedentes(id,user_id,cnpj,razao_social,status) values ($1,$2,$3,'QA P10.1 Cedente','ativo')", [qa.cedente, qa.user, emitente])
  await db.query("insert into public.cedente_fundos(cedente_id,fundo_id,status) values ($1,$2,'ativo')", [qa.cedente, qa.fundo])
  await db.query("insert into public.cedente_acessos(user_id,cedente_id,perfil,status,ativo,aceito_em) values ($1,$2,'ADMIN','ATIVO',true,now())", [qa.user, qa.cedente])
  const matriz = await db.query("select id from public.cedente_estabelecimentos where cedente_id=$1 and tipo='matriz'", [qa.cedente])
  if (matriz.rowCount) await db.query("update public.cedente_estabelecimentos set status='aprovado',ativo=true,aprovado_em=now() where id=$1", [matriz.rows[0].id])
  else await db.query("insert into public.cedente_estabelecimentos(cedente_id,cnpj,razao_social,tipo,status,ativo,aprovado_em) values ($1,$2,'QA P10.1 Cedente','matriz','aprovado',true,now())", [qa.cedente, emitente])

  const auth = createClient(apiUrl, env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), { auth: { autoRefreshToken: false, persistSession: false } })
  const sign = await auth.auth.signInWithPassword({ email, password }); if (sign.error) throw sign.error
  const enrolled = await auth.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'QA P10.1' }); if (enrolled.error) throw enrolled.error
  const secret = enrolled.data.totp.secret
  const challenge = await auth.auth.mfa.challenge({ factorId: enrolled.data.id }); if (challenge.error) throw challenge.error
  const verified = await auth.auth.mfa.verify({ factorId: enrolled.data.id, challengeId: challenge.data.id, code: totp(secret) }); if (verified.error) throw verified.error
  await auth.auth.signOut()

  const valid = join(temp, 'qa-p10-1-nf1741.pdf')
  const invalid = join(temp, 'qa-p10-1-sem-valor.pdf')
  const common = ['DANFE QA P10.1', 'NF-e', `CHAVE DE ACESSO ${chave}`, 'DATA DE EMISSAO 16/09/2026', 'DESTINATARIO / REMETENTE', `EMPRESA QA ${dest.slice(0, 2)}.${dest.slice(2, 5)}.${dest.slice(5, 8)}/${dest.slice(8, 12)}-${dest.slice(12)}`, 'DUPLICATAS 29/10/2026']
  for (const [file, lines] of [
    [valid, [...common, 'VALOR TOTAL DA NOTA', '0,0097.792,260,000,000,000,00', 'VALOR TOTAL DOS PRODUTOSVALOR DO ICMS ST', '0,000,000,00', '0,00', '97.792,26', 'EMISSAO: 16-09-2026 - VALOR TOTAL: R$ 97.792,26']],
    [invalid, [...common, 'VALOR TOTAL DA NOTA', '0,00']],
  ]) {
    writeFileSync(file, pdf(lines))
  }
  for (const file of [valid, invalid]) {
    const buffer = readFileSync(file)
    const parsed = await pdfParse(buffer)
    const parserModule = await import('../../src/lib/pdf-nf-parser.ts')
    const fn = parserModule.extractDanfeFromText || parserModule.default.extractDanfeFromText
    const extracted = fn(parsed.text)
    console.log(JSON.stringify({ phase: 'pdf_fixture', kind: file === valid ? 'valid' : 'invalid', textLength: parsed.text.length, keyPresent: parsed.text.includes(chave), numberPresent: parsed.text.includes('1741'), parsedNumber: extracted.numero_nf, parsedValue: extracted.valor_bruto, origin: extracted.origem_valor_bruto }))
  }
  const twoPages = await pdfParse(pdfTwoPages(common, ['VALOR TOTAL DA NOTA', '0,0097.792,260,000,000,000,00', 'VALOR TOTAL: R$ 97.792,26']))
  const parserModule = await import('../../src/lib/pdf-nf-parser.ts')
  const extractText = parserModule.extractDanfeFromText || parserModule.default.extractDanfeFromText
  assert(twoPages.numpages === 2 && extractText(twoPages.text).valor_bruto === 97792.26, 'Regressão PDF binário de duas páginas')
  browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage()
  await page.goto(`${app}/login`, { waitUntil: 'networkidle2', timeout: 60000 })
  await page.type('#email', email); await page.type('#password', password)
  await Promise.all([page.waitForFunction(() => location.pathname !== '/login', { timeout: 60000 }), page.click('button[type=submit]')])
  if (new URL(page.url()).pathname === '/mfa/desafio') {
    await page.waitForSelector('input[name=code]', { timeout: 60000 })
    await page.type('input[name=code]', totp(secret))
    await Promise.all([page.waitForFunction(() => location.pathname !== '/mfa/desafio', { timeout: 60000 }), page.click('form button[type=submit]')])
  }
  async function upload(file) {
    await page.goto(`${app}/cedente/notas-fiscais`, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForSelector('input[type=file]', { timeout: 30000 })
    await (await page.$('input[type=file]')).uploadFile(file)
    await page.waitForFunction(() => /Enviar 1 arquivo/.test(document.body.innerText), { timeout: 15000 })
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Enviar 1 arquivo/.test(b.innerText))?.click())
    await page.waitForFunction(() => document.body.innerText.includes('Enviando...') || document.body.innerText.includes('Não foi possível identificar') || location.pathname.match(/\/cedente\/notas-fiscais\/[0-9a-f-]{36}/), { timeout: 60000 })
    await page.waitForFunction(() => !document.body.innerText.includes('Enviando...'), { timeout: 60000 })
  }
  await upload(invalid)
  const invalidText = await page.evaluate(() => document.body.innerText)
  assert(invalidText.includes('Não foi possível identificar corretamente o valor total'), 'Valor inválido: mensagem de domínio')
  assert(!/notas_fiscais_valor_bruto_check|SQLSTATE|stack trace/i.test(invalidText), 'Valor inválido: sem detalhes internos')
  const before = await db.query('select count(*)::int n from public.notas_fiscais where cedente_id=$1', [qa.cedente])
  const storageBefore = await db.query("select count(*)::int n from storage.objects where bucket_id='notas-fiscais' and name like $1", [`${emitente}/nf/%qa-p10-1-sem-valor.pdf`])
  assert(before.rows[0].n === 0 && storageBefore.rows[0].n === 0, 'Valor inválido antes de INSERT/Storage')

  await upload(valid)
  const row = await db.query('select id,numero_nf,serie,chave_acesso,data_emissao,data_vencimento,cnpj_emitente,cnpj_destinatario,valor_bruto,arquivo_url,status from public.notas_fiscais where cedente_id=$1 order by created_at desc', [qa.cedente])
  assert(row.rowCount === 1, 'Upload E2E persistiu uma NF')
  const nf = row.rows[0]; qa.nfs.push(nf.id); qa.paths.push(nf.arquivo_url)
  console.log(JSON.stringify({ phase: 'nf_row', numero: nf.numero_nf, serie: nf.serie, bruto: nf.valor_bruto, datesValid: new Date(nf.data_emissao).toISOString().slice(0, 10) === '2026-09-16' && new Date(nf.data_vencimento).toISOString().slice(0, 10) === '2026-10-29', keyMatches: nf.chave_acesso === chave, cnpjsMatch: nf.cnpj_emitente === emitente && nf.cnpj_destinatario === dest }))
  assert(nf.numero_nf === '1741' && nf.serie === '1' && nf.chave_acesso === chave && Number(nf.valor_bruto) === 97792.26 && new Date(nf.data_emissao).toISOString().slice(0, 10) === '2026-09-16' && new Date(nf.data_vencimento).toISOString().slice(0, 10) === '2026-10-29' && nf.cnpj_emitente === emitente && nf.cnpj_destinatario === dest, 'Campos financeiros/fiscais da NF íntegros')
  const object = await db.query("select bucket_id from storage.objects where bucket_id='notas-fiscais' and name=$1", [nf.arquivo_url])
  assert(object.rowCount === 1, 'Storage referenciado pela NF')
  const documentLinks = await db.query('select count(*)::int n from public.documento_vinculos where nota_fiscal_id=$1', [nf.id])
  assert(documentLinks.rows[0].n === 0, 'Fundo QA sem requisito DANFE: sem versão documental esperada')
  const privacy = await db.query("select public from storage.buckets where id='notas-fiscais'")
  assert(privacy.rowCount === 1 && privacy.rows[0].public === false, 'Bucket de NF privado')
  const installments = await db.query('select count(*)::int n from public.nota_fiscal_parcelas where nota_fiscal_id=$1', [nf.id])
  assert(installments.rows[0].n === 0, 'PDF rascunho não cria parcelas (NOT_APPLICABLE)')
  await page.goto(`${app}/cedente/notas-fiscais/${nf.id}`, { waitUntil: 'networkidle2', timeout: 60000 })
  await page.waitForFunction(() => document.body.innerText.includes('NF 1741') || document.body.innerText.includes('Nota fiscal nao encontrada.'), { timeout: 60000 })
  const detailText = await page.evaluate(() => document.body.innerText)
  console.log(JSON.stringify({ phase: 'detail_ui', numberVisible: detailText.includes('NF 1741'), totalVisible: detailText.includes('97.792,26') }))
  assert(detailText.includes('NF 1741') && detailText.includes('97.792,26'), 'NF persistida legível após reload')
  const xmlFile = join(temp, 'qa-p10-1-nf1742.xml')
  writeFileSync(xmlFile, `<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe><infNFe Id="NFe${chaveXml}"><ide><nNF>1742</nNF><serie>1</serie><dhEmi>2026-09-16T10:00:00-03:00</dhEmi></ide><emit><CNPJ>${emitente}</CNPJ><xNome>QA P10.1 Cedente</xNome></emit><dest><CNPJ>${dest}</CNPJ><xNome>QA Destinatario</xNome></dest><det><prod><xProd>Produto QA</xProd><qCom>1</qCom><vProd>97792.26</vProd></prod></det><cobr><dup><nDup>001</nDup><dVenc>2026-10-29</dVenc><vDup>97792.26</vDup></dup></cobr><total><ICMSTot><vNF>97792.26</vNF><vICMS>0</vICMS><vIPI>0</vIPI><vPIS>0</vPIS><vCOFINS>0</vCOFINS></ICMSTot></total></infNFe></NFe></nfeProc>`)
  await upload(xmlFile)
  const xmlRows = await db.query('select id,numero_nf,chave_acesso,valor_bruto,arquivo_url from public.notas_fiscais where cedente_id=$1 and numero_nf=$2', [qa.cedente, '1742'])
  assert(xmlRows.rowCount === 1, 'Regressão XML: NF persistida')
  const xmlNf = xmlRows.rows[0]; qa.nfs.push(xmlNf.id); qa.paths.push(xmlNf.arquivo_url)
  const xmlParcelas = await db.query('select numero_parcela,data_vencimento,valor_nominal from public.nota_fiscal_parcelas where nota_fiscal_id=$1', [xmlNf.id])
  assert(xmlNf.chave_acesso === chaveXml && Number(xmlNf.valor_bruto) === 97792.26 && xmlParcelas.rowCount === 1 && xmlParcelas.rows[0].numero_parcela === 1 && Number(xmlParcelas.rows[0].valor_nominal) === 97792.26, 'Regressão XML: chave, valor e parcela preservados')
} catch (error) {
  failure = error
  console.error(JSON.stringify({ status: 'FAIL', reason: error.message, stack: error.stack?.split('\n').slice(0, 4) }))
} finally {
  await browser?.close().catch(() => undefined)
  // Cleanup restricted to the IDs generated by this invocation.
  try {
    if (qa.user) {
      const createdNfs = await db.query('select id,arquivo_url from public.notas_fiscais where cedente_id=$1', [qa.cedente])
      for (const row of createdNfs.rows) {
        if (!qa.nfs.includes(row.id)) qa.nfs.push(row.id)
        if (row.arquivo_url && !qa.paths.includes(row.arquivo_url)) qa.paths.push(row.arquivo_url)
      }
      const createdObjects = await db.query("select name from storage.objects where bucket_id='notas-fiscais' and name like $1", [`${qa.emitente}/nf/%qa-p10-1-%`])
      for (const row of createdObjects.rows) if (!qa.paths.includes(row.name)) qa.paths.push(row.name)
    }
    for (const nfId of qa.nfs) {
      await db.query('delete from public.nota_fiscal_parcelas where nota_fiscal_id=$1', [nfId])
      await db.query('delete from public.documento_requisito_instancias where nota_fiscal_id=$1', [nfId])
      await db.query('delete from public.documento_vinculos where nota_fiscal_id=$1', [nfId])
      await db.query('delete from public.notas_fiscais where id=$1 and cedente_id=$2', [nfId, qa.cedente])
    }
    for (const path of qa.paths) { const result = await admin.storage.from('notas-fiscais').remove([path]); if (result.error) throw result.error }
    if (qa.user) {
      await db.query('delete from public.cedente_estabelecimento_contas_bancarias where estabelecimento_id in (select id from public.cedente_estabelecimentos where cedente_id=$1)', [qa.cedente])
      await db.query('delete from public.cedente_estabelecimentos where cedente_id=$1', [qa.cedente])
      await db.query('delete from public.cedente_acessos where cedente_id=$1', [qa.cedente])
      await db.query('delete from public.cedente_fundos where cedente_id=$1', [qa.cedente])
      await db.query('delete from public.cedentes where id=$1', [qa.cedente])
      await db.query('delete from public.logs_auditoria where usuario_id=$1', [qa.user])
      const deleted = await admin.auth.admin.deleteUser(qa.user); if (deleted.error) throw deleted.error
    }
    const residual = await db.query("select (select count(*)::int from public.notas_fiscais where cedente_id=$1) nfs,(select count(*)::int from public.nota_fiscal_parcelas where nota_fiscal_id=any($2::uuid[])) parcelas,(select count(*)::int from public.cedentes where id=$1) cedentes,(select count(*)::int from auth.users where id=$3) users,(select count(*)::int from storage.objects where name like $4 and bucket_id='notas-fiscais') objects", [qa.cedente, qa.nfs, qa.user, `${qa.emitente}/nf/%qa-p10-1-%`])
    assert(Object.values(residual.rows[0]).every((count) => count === 0), 'Cleanup QA sem resíduos de NF, Cedente, Auth e Storage')
  } catch (error) { failure ||= error; console.error(JSON.stringify({ cleanup: 'FAIL', reason: error.message })) }
  await db.end().catch(() => undefined)
  await rm(temp, { recursive: true, force: true })
}
if (failure) process.exitCode = 1
