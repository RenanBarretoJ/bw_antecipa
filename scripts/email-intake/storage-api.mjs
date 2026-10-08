import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// Opt-in QA harness. Never connected by an application route or scheduler.
// RPC facts below are synthetic fixtures: this proves Storage/DB integration,
// not parser accuracy, Graph transport, or the authenticated review UI.
export async function verifyStorageApi({ db, url, serviceKey, physicalObjects }) {
  assert.equal(new URL(url).hostname, '127.0.0.1')
  assert.equal(new URL(url).port, '57841')
  assert.equal(typeof physicalObjects, 'function', 'Physical backend inspection required')
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const fund = '22000000-0000-4000-8000-000000000001'
  const cedente = '23000000-0000-4000-8000-000000000001'
  const link = '24000000-0000-4000-8000-000000000001'
  const owner = '21000000-0000-4000-8000-000000000003'
  const establishment = (await db.query('select id from public.cedente_estabelecimentos where cedente_id=$1 and tipo=$2', [cedente, 'matriz'])).rows[0].id
  const integration = randomUUID(), message = randomUUID()
  await db.query(`insert into private.email_integrations(id,fundo_id,name,provider,mailbox_address,enabled,start_at,
    scope_verified_at,scope_evidence_hash,credential_env_ref,created_by,routing_mode)
    values($1,$2,'Storage API QA','OUTLOOK_GRAPH','qa@example.invalid',true,now()-interval '1 day',
    now(),repeat('a',64),'EMAIL_INTAKE_QA_SYNTHETIC',$3,'ALL_ACTIVE_CEDENTES')`, [integration, fund, owner])
  await db.query('insert into private.email_intake_messages(id,integration_id,external_id,received_at) values($1,$2,$3,now())', [message, integration, randomUUID()])
  const payload = Buffer.from('<NFe>Storage API synthetic fixture</NFe>')
  const sha = createHash('sha256').update(payload).digest('hex')
  const dates = (await db.query('select current_date::text issued,(current_date+30)::text due')).rows[0]
  const checks = []
  let sequence = 500
  const rpc = async (name, args) => {
    const result = await client.rpc(name, args)
    assert.ok(!result.error, `${name}: ${result.error?.code ?? 'unknown'}`)
    return result.data
  }
  const fence = claim => ({ p_id: claim.id, p_token: claim.token, p_generation: claim.generation })
  async function attachment() {
    const id = randomUUID(), token = randomUUID()
    await db.query(`insert into private.email_intake_attachments(id,message_id,external_id,file_name,content_type,size_bytes,kind,status,lease_token,lease_expires_at)
      values($1,$2,$3,'storage.xml','application/xml',$4,'FILE','PROCESSING',$5,now()+interval '1 hour')`, [id, message, randomUUID(), payload.length, token])
    return { type: 'SYSTEM', source: 'EMAIL_INTAKE', integrationId: integration, messageId: message, attachmentId: id, attachmentToken: token }
  }
  async function reserve(actor, key) {
    return rpc('fiscal_intake_reserve', { p_actor: actor, p_fundo_id: fund, p_cedente_fundo_id: link,
      p_estabelecimento_id: establishment, p_document_type: 'NFE', p_fiscal_key: key, p_file_sha256: sha })
  }
  async function prepare(amount = 100) {
    const key = '35260998100000000168' + String(++sequence).padStart(24, '0')
    const actor = await attachment(), claim = await reserve(actor, key)
    assert.equal(claim.status, 'RESERVED')
    const values = { tipo_documento_fiscal: 'NFE', numero_nf: `API-QA-${sequence}`, chave_acesso: key,
      cnpj_emitente: '98100000000168', razao_social_emitente: 'Cedente QA', cnpj_destinatario: '11222333000181',
      razao_social_destinatario: 'Sacado QA', valor_bruto: 100, valor_liquido: 100, data_emissao: dates.issued,
      data_vencimento: dates.due, valor_icms: 0, valor_iss: 0, valor_pis: 0, valor_cofins: 0, valor_ipi: 0 }
    await rpc('fiscal_intake_stage', { ...fence(claim), p_values: values,
      p_parcelas: [{ numero_parcela: 1, valor_nominal: amount, data_vencimento: dates.due }],
      p_file_name: 'storage.xml', p_mime_type: 'application/xml', p_size_bytes: payload.length, p_document_code: 'nf_xml' })
    const intent = await rpc('fiscal_intake_prepare_storage', fence(claim))
    return { actor, claim, intent, key }
  }
  const upload = ({ intent }) => client.storage.from(intent.bucket).upload(intent.path, payload, { contentType: 'application/xml', upsert: false })
  const count = async claim => (await db.query('select count(*)::int n from storage.objects where name like $1', [`${claim.id}/%`])).rows[0].n
  async function absent(entry) {
    assert.equal(await count(entry.claim), 0)
    assert.ok((await client.storage.from(entry.intent.bucket).download(entry.intent.path)).error)
    // Physical deletion can use the Storage service's internal retry queue.
    let physical = -1
    for (let attempt = 0; attempt < 30; attempt++) {
      physical = await physicalObjects(entry.claim.id)
      if (physical === 0) break
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    assert.equal(physical, 0, 'Physical orphan after bounded cleanup observation')
  }
  async function cleanup(entry, failDelete = false) {
    const claim = await rpc('fiscal_intake_claim_cleanup', { p_reservation_id: entry.claim.id })
    assert.ok(claim)
    // Simulate an infrastructure outage at the API boundary. No metadata delete.
    const result = failDelete ? { error: { name: 'QA_DELETE_UNAVAILABLE' } }
      : await client.storage.from(claim.bucket).remove([claim.path])
    await rpc('fiscal_intake_settle_cleanup', { p_id: claim.id, p_token: claim.token, p_deleted: !result.error })
    return result
  }

  const winner = await prepare()
  assert.equal((await upload(winner)).error, null)
  const downloaded = await client.storage.from(winner.intent.bucket).download(winner.intent.path)
  assert.equal(downloaded.error, null)
  assert.equal(createHash('sha256').update(Buffer.from(await downloaded.data.arrayBuffer())).digest('hex'), sha)
  assert.equal(await count(winner.claim), 1)
  assert.ok(await physicalObjects(winner.claim.id) > 0)
  const committed = await rpc('fiscal_intake_commit', { ...fence(winner.claim), p_storage_intent_id: winner.intent.id })
  assert.ok(committed.nfId)
  const duplicateActor = await attachment()
  assert.deepEqual(await reserve(duplicateActor, winner.key), { status: 'DUPLICATE' })
  await rpc('email_intake_settle_attachment', { p_id: duplicateActor.attachmentId,
    p_token: duplicateActor.attachmentToken, p_outcome: 'DUPLICATE' })
  assert.equal((await db.query('select status from private.email_intake_attachments where id=$1', [duplicateActor.attachmentId])).rows[0].status, 'DUPLICATE')
  const unsupportedImport = await db.query(`update private.email_intake_attachments set status='IMPORTED' where id=$1`,
    [duplicateActor.attachmentId]).then(() => false, error => error.code === '23514')
  assert.ok(unsupportedImport, 'An imported receipt still requires a live or historical NF reference')
  assert.equal(await count(winner.claim), 1)
  checks.push('API_UPLOAD_DOWNLOAD_HASH', 'API_ATOMIC_COMMIT', 'DUPLICATE_NO_NEW_STORAGE', 'DUPLICATE_TERMINAL_RECEIPT_WITHOUT_CROSS_FUND_ID', 'IMPORTED_REQUIRES_FISCAL_REFERENCE')

  const failed = await prepare(50)
  assert.equal((await upload(failed)).error, null)
  const rejected = await client.rpc('fiscal_intake_commit', { ...fence(failed.claim), p_storage_intent_id: failed.intent.id })
  assert.ok(rejected.error, 'Invalid parcel must roll back commit')
  await rpc('fiscal_intake_abort', fence(failed.claim))
  await cleanup(failed, true)
  assert.equal((await reserve(failed.actor, failed.key)).status, 'CLEANUP_PENDING')
  assert.equal(await count(failed.claim), 1)
  await db.query("update private.fiscal_storage_intents set retry_at=now()-interval '1 second' where reservation_id=$1", [failed.claim.id])
  assert.equal((await cleanup(failed)).error, null)
  await absent(failed)
  checks.push('DB_FAIL_AFTER_PHYSICAL_UPLOAD', 'DELETE_FAILURE_DURABLE_CLEANUP', 'API_CLEANUP_RETRY_ZERO_PHYSICAL_ORPHANS')

  const stale = await prepare()
  await db.query("update private.fiscal_identity_reservations set lease_expires_at=now()-interval '1 second' where id=$1", [stale.claim.id])
  await rpc('fiscal_intake_reconcile_expired', { p_limit: 50 })
  assert.equal((await cleanup(stale)).error, null)
  const takeover = await reserve(stale.actor, stale.key)
  assert.equal(takeover.generation, stale.claim.generation + 1)
  assert.ok((await upload(stale)).error, 'Old generation upload must be rejected by real API')
  await absent(stale)
  await rpc('fiscal_intake_abort', fence(takeover))
  checks.push('STALE_GENERATION_API_UPLOAD_DENIED_ZERO_PHYSICAL_ORPHANS')

  // The clean-room owns and destroys this entire stack, including the winner.
  return checks
}
