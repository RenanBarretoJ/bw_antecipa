import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

/** Real database contracts. Object receipts here are metadata fixtures only. */
export async function verifyFiscalLifecycle({ admin, clients, fundId, linkId, establishment, actors, messages, userId }) {
  const checks = []
  const attachmentId = randomUUID(), token = randomUUID()
  await admin.query(`insert into private.email_intake_attachments(id,message_id,external_id,file_name,content_type,size_bytes,kind,status,lease_token,lease_expires_at)
    values($1,$2,$3,'review.pdf','application/pdf',100,'FILE','PROCESSING',$4,now()+interval '1 hour')`,
  [attachmentId, messages[0], randomUUID(), token])
  const actor = { ...actors[1], attachmentId, attachmentToken: token }
  const fiscalKey = '9'.repeat(50)
  const fileHash = 'a'.repeat(64), fingerprint = 'b'.repeat(64)
  const reserveArgs = [actor, fundId, linkId, establishment, 'NFSE', fiscalKey, fileHash]
  const reserved = (await clients[1].query('select public.fiscal_intake_reserve($1,$2,$3,$4,$5,$6,$7) result', reserveArgs)).rows[0].result
  const reviewId = (await clients[1].query('select public.fiscal_intake_open_review($1,$2,$3,$4) id',
    [reserved.id, reserved.token, reserved.generation, fingerprint])).rows[0].id
  assert.ok(reviewId)
  const duplicate = (await clients[0].query('select public.fiscal_intake_reserve($1,$2,$3,$4,$5,$6,$7) result',
    [actors[0], ...reserveArgs.slice(1)])).rows[0].result
  assert.equal(duplicate.status, 'IN_PROGRESS')
  assert.equal((await admin.query('select count(*)::int n from private.fiscal_storage_intents where reservation_id=$1', [reserved.id])).rows[0].n, 0)
  const readArgs = [fundId, linkId, reviewId]
  const read = (await clients[0].query('select public.fiscal_intake_read_email_review($1,$2,$3) result', readArgs)).rows[0].result
  assert.equal(read.id, reviewId)
  assert.equal(read.credentialCiphertext, undefined)
  await assert.rejects(clients[0].query('select public.fiscal_intake_get_review_source($1,$2,$3)', [reviewId, fundId, linkId]), /permission denied/)
  await assert.rejects(clients[0].query('select public.fiscal_intake_read_email_review($1,$2,$3)', [randomUUID(), linkId, reviewId]), /FISCAL_SCOPE_DENIED/)
  const resumeArgs = [reviewId, fundId, linkId, fileHash, fingerprint, fiscalKey]
  await assert.rejects(clients[0].query('select public.fiscal_intake_resume_review($1,$2,$3,$4,$5,$6)',
    [reviewId, fundId, linkId, 'c'.repeat(64), fingerprint, fiscalKey]), /NFSE_REVIEW_DRIFT/)
  await admin.query('update public.sessoes_elevadas set revogada_em=now() where user_id=$1', [userId])
  await assert.rejects(clients[0].query('select public.fiscal_intake_resume_review($1,$2,$3,$4,$5,$6)', resumeArgs), /FISCAL_ACTOR_DENIED/)
  await admin.query('update public.sessoes_elevadas set revogada_em=NULL where user_id=$1', [userId])
  const human = (await clients[0].query('select public.fiscal_intake_resume_review($1,$2,$3,$4,$5,$6) result', resumeArgs)).rows[0].result
  assert.equal(human.generation, reserved.generation + 1)
  const ownership = (await admin.query('select actor_type,actor_user_id,source_channel,ingest_actor,review_intent_id from private.fiscal_identity_reservations where id=$1', [reserved.id])).rows[0]
  assert.equal(ownership.actor_type, 'HUMAN')
  assert.equal(ownership.actor_user_id, userId)
  assert.equal(ownership.ingest_actor.type, 'SYSTEM')
  assert.equal(ownership.source_channel, 'EMAIL_INTAKE')
  assert.equal(ownership.review_intent_id, reviewId)
  await assert.rejects(clients[1].query('select public.fiscal_intake_plan_storage($1,$2,$3,$4,$5)', [reserved.id, reserved.token, reserved.generation, 'notas-fiscais', 'pdf']), /FISCAL_LEASE_LOST/)
  await clients[1].query('select public.fiscal_intake_abort($1,$2,$3)', [human.id, human.token, human.generation])
  assert.equal((await admin.query('select state from public.nfse_review_intents where id=$1', [reviewId])).rows[0].state, 'FAILED')
  assert.equal((await admin.query('select status from private.email_intake_attachments where id=$1', [attachmentId])).rows[0].status, 'RETRY')
  checks.push('OFFICIAL_EMAIL_REVIEW_SINGLE_RECEIPT', 'REVIEW_HASH_SCOPE_MFA_GUARDS', 'SYSTEM_INGEST_HUMAN_REVIEW_ACTOR', 'REVIEW_ABORT_RELEASES_SAFELY')

  // Expired human reservation with an uncertain upload keeps the identity until
  // the cleanup owner confirms absence. Delayed DB finalization is fenced out.
  const key = '35260998100000000168' + '7'.repeat(24)
  const claim = (await clients[0].query('select public.fiscal_intake_reserve($1,$2,$3,$4,$5,$6,$7) result',
    [actors[0], fundId, linkId, establishment, 'NFE', key, fileHash])).rows[0].result
  const intent = (await clients[0].query('select public.fiscal_intake_plan_storage($1,$2,$3,$4,$5) result',
    [claim.id, claim.token, claim.generation, 'notas-fiscais', 'xml'])).rows[0].result
  await admin.query("update private.fiscal_identity_reservations set lease_expires_at=now()-interval '1 second' where id=$1", [claim.id])
  await clients[1].query('select public.fiscal_intake_reconcile_expired(50)')
  assert.equal((await admin.query('select state from private.fiscal_identity_reservations where id=$1', [claim.id])).rows[0].state, 'CLEANUP_PENDING')
  await assert.rejects(admin.query('insert into storage.objects(bucket_id,name) values($1,$2)', [intent.bucket, intent.path]), /FISCAL_STORAGE_FENCE_LOST/)
  const cleanup = (await clients[1].query('select public.fiscal_intake_claim_cleanup($1) result', [claim.id])).rows[0].result
  await clients[1].query('select public.fiscal_intake_settle_cleanup($1,$2,false)', [cleanup.id, cleanup.token])
  assert.equal((await admin.query('select state from private.fiscal_identity_reservations where id=$1', [claim.id])).rows[0].state, 'CLEANUP_PENDING')
  await admin.query("update private.fiscal_storage_intents set retry_at=now()-interval '1 second' where id=$1", [cleanup.id])
  const retry = (await clients[1].query('select public.fiscal_intake_claim_cleanup($1) result', [claim.id])).rows[0].result
  assert.notEqual(retry.token, cleanup.token)
  await assert.rejects(clients[1].query('select public.fiscal_intake_settle_cleanup($1,$2,true)', [retry.id, cleanup.token]), /FISCAL_CLEANUP_LEASE_LOST/)
  await clients[1].query('select public.fiscal_intake_settle_cleanup($1,$2,true)', [retry.id, retry.token])
  assert.equal((await admin.query('select state from private.fiscal_identity_reservations where id=$1', [claim.id])).rows[0].state, 'RELEASED')
  await assert.rejects(admin.query('insert into storage.objects(bucket_id,name) values($1,$2)', [intent.bucket, intent.path]), /FISCAL_STORAGE_FENCE_LOST/)
  checks.push('EXPIRED_UNCERTAIN_UPLOAD_RECONCILIATION', 'LATE_STORAGE_FINALIZATION_DENIED', 'CLEANUP_FAILURE_RETRY_FENCING')
  return checks
}
