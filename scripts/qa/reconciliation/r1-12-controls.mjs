import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Client } from 'pg'
import { identityShape } from './r1-12-trace.mjs'
import { hash } from './r1-4-restorer.mjs'
import { nfeFixtureKey } from '../../email-intake/nfe-fixture-key.mjs'

export async function directedControls(s, parentSetup, report, save) {
  const db = s.db, valid = '1234567890'.repeat(5), repeated = '9'.repeat(50)
  assert((await readFile('src/lib/nfse/fixtures/danfse-v2.ts', 'utf8')).includes("SYNTHETIC_KEY = '1234567890'.repeat(5)"))
  const definition = async () => (await db.query("select pg_get_functiondef('private.fiscal_identity_material(text,text)'::regprocedure) a,pg_get_functiondef('public.fiscal_intake_reserve(jsonb,uuid,uuid,uuid,text,text,text,boolean)'::regprocedure) b")).rows[0]
  report.guardBefore = hash(JSON.stringify(await definition()))
  const cnpj = '98100000000168', authority = 'PREFEITURA MUNICIPAL DE CIDADE QA'
  const municipal = JSON.stringify(['NFSE_MUNICIPAL', cnpj, authority, '12001'])
  report.controls = []
  for (const [label, type, material, rejected] of [
    ['canonical-national', 'NFSE', valid, false], ['repeated-digit', 'NFSE', repeated, true],
    ['wrong-length', 'NFSE', valid.slice(0, 49), true], ['wrong-charset', 'NFSE', 'A'.repeat(50), true],
    ['national-null', 'NFSE', null, true], ['municipal-valid', 'NFSE', municipal, false],
    ['municipal-incomplete', 'NFSE', JSON.stringify(['NFSE_MUNICIPAL', cnpj, authority]), true],
    ['nfe-valid', 'NFE', nfeFixtureKey({ issuer: cnpj, number: 12001, issued: '2026-10-07' }), false],
  ]) {
    const evidence = { label, shape: identityShape(type, material), expectedRejection: rejected }
    try {
      const result = (await db.query('select private.fiscal_identity_material($1,$2) result', [type, material])).rows[0].result
      assert.equal(rejected, false, 'INVALID_IDENTITY_ACCEPTED:' + label); assert.equal(result, material)
      evidence.sqlstate = '00000'; evidence.result = 'PASS'; evidence.materialResult = { equalsInput: true, sha256: hash(result), length: result.length }
    } catch (e) {
      if (!rejected) throw e
      assert.equal(e.code, '22023'); assert.equal(e.message, 'FISCAL_IDENTITY_INVALID')
      evidence.sqlstate = e.code; evidence.message = e.message; evidence.result = 'PASS'
    }
    report.controls.push(evidence); await save()
  }
  const values = { tipo_documento_fiscal: 'NFSE', chave_acesso: null, cnpj_emitente: cnpj, numero_nf: '12001',
    fiscal_proveniencia: { strategy: 'nfse_municipal_visual', source: 'PDF_VISUAL_FALLBACK', orgao_emissor: authority, codigo_verificacao: 'QA-1234' } }
  assert.equal((await db.query('select private.fiscal_identity_from_values($1) result', [values])).rows[0].result, municipal)
  report.checks.push('MUNICIPAL_NULL_ACCESS_KEY_CANONICAL_MATERIAL')
  await db.query(parentSetup)
  const user = '21000000-0000-4000-8000-000000000003', fund = '22000000-0000-4000-8000-000000000001', link = '24000000-0000-4000-8000-000000000001'
  const establishment = (await db.query("select id from public.cedente_estabelecimentos where cedente_id='23000000-0000-4000-8000-000000000001' and tipo='matriz'")).rows[0].id
  const factor = randomUUID(), session = randomUUID(), integration = randomUUID(), message = randomUUID(), attachment = randomUUID(), token = randomUUID()
  await db.query("insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values($1,$2,'R1.12 synthetic','totp','verified',now(),now())", [factor, user])
  await db.query("insert into auth.sessions(id,user_id,aal,factor_id,created_at,updated_at) values($1,$2,'aal2',$3,now(),now())", [session, user, factor])
  await db.query("insert into public.sessoes_elevadas(user_id,session_id,metodo,factor_id,elevada_em,expira_em) values($1,$2,'totp',$3,now(),now()+interval '1 hour')", [user, session, factor])
  await db.query("insert into private.email_integrations(id,fundo_id,name,provider,mailbox_address,routing_mode,enabled,start_at,scope_verified_at,scope_evidence_hash,credential_env_ref,created_by) values($1,$2,'R1.12 synthetic','OUTLOOK_GRAPH','qa@example.invalid','ALL_ACTIVE_CEDENTES',true,now()-interval '1 day',now(),repeat('a',64),'EMAIL_INTAKE_QA_SYNTHETIC',$3)", [integration, fund, user])
  await db.query("insert into private.email_intake_messages(id,integration_id,external_id,received_at) values($1,$2,'r112-review',now())", [message, integration])
  await db.query("insert into private.email_intake_attachments(id,message_id,external_id,file_name,content_type,size_bytes,kind,status,lease_token,lease_expires_at) values($1,$2,'r112-review','synthetic.pdf','application/pdf',100,'FILE','PROCESSING',$3,now()+interval '1 hour')", [attachment, message, token])
  const human = { type: 'HUMAN', userId: user }, system = { type: 'SYSTEM', source: 'EMAIL_INTAKE', integrationId: integration, messageId: message, attachmentId: attachment, attachmentToken: token }
  const clients = [new Client(s.connection), new Client(s.connection)]
  try {
    for (const [index, client] of clients.entries()) {
      await client.connect()
      await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(index === 0 ? { sub: user, role: 'authenticated', aal: 'aal2', session_id: session } : { role: 'service_role' })])
      await client.query(index === 0 ? 'set role authenticated' : 'set role service_role')
    }
    const reserve = async (index, actor, key) => (await clients[index].query('select public.fiscal_intake_reserve($1,$2,$3,$4,$5,$6,$7) result', [actor, fund, link, establishment, 'NFSE', key, 'a'.repeat(64)])).rows[0].result
    const count = async () => (await db.query('select count(*)::int n from private.fiscal_identity_reservations where identity_sha256=$1', [hash(valid)])).rows[0].n
    assert.equal(await count(), 0)
    assert.equal((await db.query('select count(*)::int n from public.notas_fiscais where chave_acesso=$1', [valid])).rows[0].n, 0)
    await assert.rejects(reserve(1, system, repeated), e => e.code === '22023' && e.message === 'FISCAL_IDENTITY_INVALID')
    assert.equal((await db.query('select count(*)::int n from private.fiscal_identity_reservations where identity_sha256=$1', [hash(repeated)])).rows[0].n, 0)
    const claim = await reserve(1, system, valid); assert.equal(claim.status, 'RESERVED')
    const review = (await clients[1].query('select public.fiscal_intake_open_review($1,$2,$3,$4) id', [claim.id, claim.token, claim.generation, 'b'.repeat(64)])).rows[0].id
    assert(review); assert.equal((await reserve(0, human, valid)).status, 'IN_PROGRESS'); assert.equal(await count(), 1)
    const resumeArgs = [review, fund, link, 'a'.repeat(64), 'b'.repeat(64), valid]
    await assert.rejects(clients[0].query('select public.fiscal_intake_resume_review($1,$2,$3,$4,$5,$6)', [review, fund, link, 'c'.repeat(64), 'b'.repeat(64), valid]), /NFSE_REVIEW_DRIFT/)
    await db.query('update public.sessoes_elevadas set revogada_em=now() where user_id=$1', [user])
    await assert.rejects(clients[0].query('select public.fiscal_intake_resume_review($1,$2,$3,$4,$5,$6)', resumeArgs), /FISCAL_ACTOR_DENIED/)
    await db.query('update public.sessoes_elevadas set revogada_em=NULL where user_id=$1', [user])
    const resumed = (await clients[0].query('select public.fiscal_intake_resume_review($1,$2,$3,$4,$5,$6) result', resumeArgs)).rows[0].result
    assert.equal(resumed.generation, claim.generation + 1)
    const owner = (await db.query('select actor_type,actor_user_id,source_channel,ingest_actor,identity_sha256 from private.fiscal_identity_reservations where id=$1', [claim.id])).rows[0]
    assert.equal(owner.actor_type, 'HUMAN'); assert.equal(owner.actor_user_id, user); assert.equal(owner.ingest_actor.type, 'SYSTEM'); assert.equal(owner.source_channel, 'EMAIL_INTAKE'); assert.equal(owner.identity_sha256, hash(valid))
    await clients[1].query('select public.fiscal_intake_abort($1,$2,$3)', [resumed.id, resumed.token, resumed.generation])
    assert.equal((await db.query('select state from public.nfse_review_intents where id=$1', [review])).rows[0].state, 'FAILED')
    report.checks.push('INVALID_KEY_RPC_NEGATIVE_CONTROL_ZERO_RESERVATION', 'VALID_KEY_RESERVED_WITHOUT_COLLISION', 'SYSTEM_REVIEW_HUMAN_DEDUPE_ONE_IDENTITY', 'REVIEW_HASH_AND_MFA_GUARDS', 'HUMAN_RESUME_PRESERVES_SYSTEM_INGEST_AND_IDENTITY', 'ABORT_REVIEW_FAILED')
  } finally { for (const client of clients) await client.end() }
  report.guardAfter = hash(JSON.stringify(await definition())); assert.equal(report.guardAfter, report.guardBefore)
  report.checks.push('FISCAL_GUARD_UNCHANGED')
}
