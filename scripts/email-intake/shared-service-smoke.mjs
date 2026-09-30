import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHmac } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { Client } from 'pg'
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { test } from 'vitest'
import { danfseFixture } from '../../src/lib/nfse/fixtures/danfse-v2.ts'
import { processAttachmentJob } from '../../src/lib/email-intake/attachment-worker.server.ts'
import { importFiscalFile } from '../../src/lib/fiscal-intake/service.server.ts'
import { createFiscalImportRepository } from '../../src/lib/fiscal-intake/repository.server.ts'
import { createFiscalStorage } from '../../src/lib/fiscal-intake/storage.server.ts'
import { verifySharedConcurrency } from './cross-channel-smoke.mjs'
import { verifySharedRouting } from './routing-smoke.mjs'
import { verifyBrowserReview } from './browser-review-smoke.mjs'

let browserState

// Run only as a child of the disposable clean-room with local credentials.
test('shared fiscal service with real Auth, MFA, PostgreSQL and Storage', async () => {
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57841')
assert.equal(process.env.EMAIL_INTAKE_DISPOSABLE_SMOKE, 'true')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options)
const human = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
const db = new Client({ host: '127.0.0.1', port: 57842, user: 'postgres', password: 'postgres', database: 'postgres' })
const value = (result, stage) => { assert.ok(!result.error, `${stage}:${result.error?.code ?? 'UNKNOWN'}`); return result.data }
const fund = '22000000-0000-4000-8000-000000000001', cedente = '23000000-0000-4000-8000-000000000001'
const link = '24000000-0000-4000-8000-000000000001', owner = '21000000-0000-4000-8000-000000000003'
const checks = []
let stage = 'REAL_AUTH'
let browser
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...secret.replace(/=/g, '').toUpperCase()].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('')
  const bytes = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)))
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', bytes).update(counter).digest(), offset = digest[19] & 15
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0')
}
try {
  await db.connect()
  const email = `email03-${randomUUID()}@example.invalid`, password = `QA!A1${randomBytes(24).toString('base64url')}`
  const { user } = value(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'CREATE_QA_HUMAN')
  await db.query("update public.profiles set role='cedente',status='ativo' where id=$1", [user.id])
  await db.query(`insert into public.cedente_acessos(cedente_id,user_id,perfil,status,ativo,aceito_em)
    values($1,$2,'OPERACIONAL','ATIVO',true,now())`, [cedente, user.id])
  value(await human.auth.signInWithPassword({ email, password }), 'LOGIN_QA_HUMAN')
  const denied = await human.rpc('fiscal_intake_read_email_review', { p_fundo_id: fund, p_cedente_fundo_id: link })
  assert.ok(denied.error, 'AAL1 must not access fiscal review')
  const factor = value(await human.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Disposable EMAIL03' }), 'ENROLL_MFA')
  const challenge = value(await human.auth.mfa.challenge({ factorId: factor.id }), 'CHALLENGE_MFA')
  value(await human.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code: totp(factor.totp.secret) }), 'VERIFY_MFA')
  value(await human.rpc('registrar_sessao_mfa_atual', { p_factor_id: factor.id }), 'REGISTER_MFA')
  checks.push('REAL_AUTH_LOGIN_MFA_AAL2', 'AAL1_REVIEW_DENIED')
  stage = 'OFFICIAL_PDF_FIXTURE'

  browser = await puppeteer.launch({ executablePath: process.env.EMAIL_INTAKE_QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run', '--disable-dev-shm-usage'] })
  const page = await browser.newPage()
  const text = danfseFixture().replace('11.222.333/0001-81', '98.100.000/0001-68')
  await page.setContent('<html><meta charset="utf-8"><style>pre{font-size:8px;line-height:10px;white-space:pre-wrap}</style><pre>' + text.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</pre></html>')
  const bytes = await page.pdf({ format: 'A4', margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } })
  const fixturePdf = async (content, name) => {
    await page.setContent('<html><meta charset="utf-8"><style>pre{font-size:8px;line-height:10px;white-space:pre-wrap}</style><pre>' + content.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</pre></html>')
    return new File([await page.pdf({ format: 'A4' })], name, { type: 'application/pdf' })
  }
  const reviewFile = await fixturePdf(text.replace('1234567890'.repeat(5), '2345678901'.repeat(5)), 'qa-second-review.pdf')
  const missingKeyFile = await fixturePdf(text.replace('1234567890'.repeat(5), ''), 'qa-missing-key.pdf')
  await browser.close(); browser = undefined
  await writeFile('rehearsal/tmp/email03-r2-review-synthetic.pdf', bytes)
  const file = new File([bytes], 'email03-r2-review-synthetic.pdf', { type: 'application/pdf' })
  const integration = randomUUID(), message = randomUUID(), attachment = randomUUID()
  stage = 'SHARED_SYSTEM_INGEST'
  // Earlier fault fixtures may be due for retry; isolate this controlled queue.
  await db.query("update private.email_integrations set enabled=false where fundo_id=$1 and name in ('Disposable QA','Storage API QA')", [fund])
  await db.query(`insert into private.email_integrations(id,fundo_id,name,provider,mailbox_address,enabled,start_at,
    scope_verified_at,scope_evidence_hash,credential_env_ref,created_by,routing_mode)
    values($1,$2,'Shared service QA','OUTLOOK_GRAPH','qa@example.invalid',true,now()-interval '1 day',now(),repeat('a',64),
    'EMAIL_INTAKE_QA_SYNTHETIC',$3,'ALL_ACTIVE_CEDENTES')`, [integration, fund, owner])
  await db.query('insert into private.email_intake_messages(id,integration_id,external_id,received_at) values($1,$2,$3,now())', [message, integration, randomUUID()])
  await db.query(`insert into private.email_intake_attachments(id,message_id,external_id,file_name,content_type,size_bytes,kind)
    values($1,$2,$3,$4,'application/pdf',$5,'FILE')`, [attachment, message, randomUUID(), file.name, file.size])
  const claims = value(await admin.rpc('email_intake_claim_attachment', { p_queue: 'TEXT' }), 'CLAIM_ATTACHMENT')
  assert.equal(claims[0].id, attachment)
  const job = value(await admin.rpc('email_intake_get_attachment_claim', { p_id: attachment, p_token: claims[0].token }), 'READ_CLAIM')
  const dependencies = client => ({ repository: createFiscalImportRepository(client), storage: createFiscalStorage() })
  const beforeUsers = (await db.query('select count(*)::int n from auth.users')).rows[0].n
  const review = await processAttachmentJob(job, { downloadAttachment: async () => bytes }, input => importFiscalFile(input, dependencies(admin)))
  assert.equal(review.status, 'REQUIRES_REVIEW')
  assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n, beforeUsers)
  const pending = (await db.query('select id from private.fiscal_identity_reservations where attachment_id=$1', [attachment])).rows[0]
  assert.equal((await db.query('select count(*)::int n from private.fiscal_storage_intents where reservation_id=$1', [pending.id])).rows[0].n, 0)
  const input = { actor: { type: 'HUMAN', userId: user.id }, fundoId: fund, cedenteFundoId: link, file }
  assert.equal((await importFiscalFile(input, dependencies(human))).status, 'IN_PROGRESS')
  checks.push('CONTROLLED_ATTACHMENT_OFFICIAL_PARSER_SHARED_REVIEW', 'SYSTEM_NO_AUTH_USER_CREATED', 'REVIEW_DUPLICATE_BEFORE_STORAGE')
  stage = 'SHARED_HUMAN_REVIEW'

  const receipt = value(await human.rpc('fiscal_intake_read_email_review', { p_fundo_id: fund, p_cedente_fundo_id: link, p_review_id: review.review.intentId }), 'READ_REVIEW')
  assert.equal(receipt.id, review.review.intentId)
  const due = (await db.query('select (current_date+30)::text due')).rows[0].due
  const imported = await importFiscalFile({ ...input, review: { intentId: receipt.id, manualDue: due } }, dependencies(human))
  assert.equal(imported.status, 'IMPORTED')
  const audit = (await db.query(`select r.actor_type,r.actor_user_id,r.ingest_actor,r.source_channel,v.review_actor_id,v.state,n.data_vencimento::text due
    from private.fiscal_identity_reservations r join public.nfse_review_intents v on v.id=r.review_intent_id
    join public.notas_fiscais n on n.id=r.nota_fiscal_id where r.id=$1`, [pending.id])).rows[0]
  assert.equal(audit.actor_type, 'HUMAN'); assert.equal(audit.actor_user_id, user.id)
  assert.equal(audit.ingest_actor.type, 'SYSTEM'); assert.equal(audit.source_channel, 'EMAIL_INTAKE')
  assert.equal(audit.review_actor_id, user.id); assert.equal(audit.state, 'COMPLETED'); assert.equal(audit.due, due)
  const original = value(await admin.rpc('fiscal_intake_get_original', { p_nf_id: imported.nfId }), 'GET_ORIGINAL')
  const originalBytes = value(await admin.storage.from(original.bucket).download(original.path), 'DOWNLOAD_ORIGINAL')
  assert.equal(Buffer.compare(Buffer.from(await originalBytes.arrayBuffer()), Buffer.from(bytes)), 0)
  checks.push('REAL_HUMAN_SHARED_SERVICE_REEXTRACTION_COMMIT', 'SYSTEM_INGEST_HUMAN_REVIEW_AUDIT', 'ORIGINAL_JOURNAL_DOWNLOAD_MATCH')
  stage = 'CROSS_CHANNEL_XML'
  checks.push(...await verifySharedConcurrency({ db, admin, human, userId: user.id, dependencies,
    importFiscalFile, processAttachmentJob, sourceIntegration: integration }))
  stage = 'SHARED_ROUTING'
  checks.push(...await verifySharedRouting({ db, admin, human, userId: user.id, dependencies,
    importFiscalFile, processAttachmentJob, sourceIntegration: integration, reviewFile, missingKeyFile }))
  browserState = { human, userId: user.id, reviewFile }
  await writeFile(process.env.EMAIL_INTAKE_SMOKE_REPORT, JSON.stringify({ result: 'PASS', checks, scope: 'DISPOSABLE_SHARED_SERVICE_API_NOT_BROWSER_OR_GRAPH' }))
} catch (error) {
  await writeFile(process.env.EMAIL_INTAKE_SMOKE_REPORT, JSON.stringify({ result: 'FAIL', stage, code: error.code ?? error.name,
    message: error.message.replace(/\d{14,}/g, '[IDENTIFIER_REDACTED]').slice(0, 300), checks }))
  throw new Error('QA_SHARED_SERVICE_FAILED')
} finally {
  if (browser) await browser.close()
  await db.end()
}
})

test('official email review form with controlled Graph HTTP original and real Auth/MFA/DB/Storage', async () => {
  assert.ok(browserState, 'API smoke must finish first')
  const db = new Client({ host: '127.0.0.1', port: 57842, user: 'postgres', password: 'postgres', database: 'postgres' })
  const reportPath = process.env.EMAIL_INTAKE_SMOKE_REPORT
  const { readFile } = await import('node:fs/promises')
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  try {
    await db.connect()
    report.checks.push(...await verifyBrowserReview({ ...browserState, db }))
    report.scope = 'DISPOSABLE_OFFICIAL_BROWSER_AUTH_MFA_DB_STORAGE_CONTROLLED_GRAPH_HTTP'
  } catch (error) {
    report.result = 'FAIL'; report.stage = error.message; throw error
  } finally {
    await browserState.human.auth.signOut()
    await db.end()
    await writeFile(reportPath, JSON.stringify(report))
  }
})
