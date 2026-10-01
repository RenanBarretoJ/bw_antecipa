import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

/** Disposable database only. Exercise SQL even when a caller bypasses the TS gate. */
export async function verifyEmailTemporalAdmission(db, connection) {
  assert.equal(connection.host, '127.0.0.1'); assert.equal(connection.port, 57842)
  const id = randomUUID(), fund = '22000000-0000-4000-8000-000000000001', user = '21000000-0000-4000-8000-000000000003'
  const start = '2026-10-01T16:33:55.572Z', old = '2026-10-01T16:33:55.571Z', checks = [], clients = []
  const rpc = async (name, values = [], client = db) => (await client.query('select public.' + name + ' r', values)).rows[0]?.r
  const claim = async mode => (await db.query('select * from public.email_intake_claim_discovery($1,$2)', [id, mode])).rows[0]
  const commit = (lease, messages, cursor, complete = true, mode = 'DELTA') => rpc('email_intake_commit_page($1,$2,$3,$4,$5,$6,$7,$8)', [id, mode, lease.token, lease.revision, JSON.stringify(messages), cursor, cursor ? 'test-version' : null, complete])
  const attachment = externalId => ({ externalId, name: 'synthetic.xml', contentType: 'application/xml', size: 100, inline: false, kind: 'FILE' })
  const message = (externalId, receivedAt, attachments = []) => ({ externalId, receivedAt, attachments })
  const count = async table => (await db.query(`select count(*)::int n from private.${table} where ${table === 'email_intake_messages' ? 'integration_id=$1' : 'message_id in(select id from private.email_intake_messages where integration_id=$1)'}`, [id])).rows[0].n
  try {
    await db.query(`insert into private.email_integrations(id,fundo_id,name,provider,mailbox_address,enabled,start_at,scope_verified_at,scope_evidence_hash,credential_env_ref,created_by)
      values($1,$2,'R3 disposable','OUTLOOK_GRAPH','qa@example.invalid',true,$3,now(),repeat('a',64),'EMAIL_INTAKE_QA_TEST',$4)`, [id, fund, start, user])
    let lease = await claim('DELTA')
    await commit(lease, Array.from({ length: 10 }, (_, n) => message('old-' + n, old, [attachment('old-a-' + n)])), 'next1', false)
    assert.equal(await count('email_intake_messages'), 0); assert.equal(await count('email_intake_attachments'), 0)
    let state = (await db.query('select revision,cursor_ciphertext from private.email_sync_state where integration_id=$1', [id])).rows[0]
    assert.equal(Number(state.revision), 1); assert.equal(state.cursor_ciphertext, 'next1')
    checks.push('ALL_OLD_PAGE_ZERO_METADATA_CURSOR_ADVANCES')
    // Simulate a crash after the durable page and lease expiry: continue from next1.
    await db.query("update private.email_sync_state set lease_expires_at=now()-interval '1 second' where integration_id=$1", [id])
    lease = await claim('DELTA'); assert.equal(lease.cursor_ciphertext, 'next1')
    await commit(lease, [message('bad', 'not-a-date', [attachment('bad-a')]), message('absent', null), message('equal', '2026-10-01T13:33:55.572-03:00', [attachment('equal-a')]), message('new', '2026-10-01T16:33:55.573Z', [attachment('new-a')])], 'delta1')
    assert.equal(await count('email_intake_messages'), 2); assert.equal(await count('email_intake_attachments'), 2)
    checks.push('SQL_MIXED_OFFSETS_MILLISECONDS_INVALID_CLOSED', 'CRASH_RESUMES_CHECKPOINT')
    lease = await claim('DELTA')
    const known = await rpc('email_intake_known_messages($1,$2,$3,$4,$5)', [id, 'DELTA', lease.token, lease.revision, ['equal', 'other-integration']])
    assert.equal(known.length, 1); assert.equal(known[0].externalId, 'equal')
    await assert.rejects(rpc('email_intake_known_messages($1,$2,$3,$4,$5)', [id, 'DELTA', randomUUID(), lease.revision, ['equal']]), /EMAIL_LEASE_LOST/)
    checks.push('KNOWN_LOOKUP_LEASE_AND_INTEGRATION_SCOPED')
    const before = Number(lease.revision)
    await assert.rejects(commit(lease, [message('rollback-ok', start, [attachment('rollback-a')]), message('rollback-error', start, [{ ...attachment('invalid-a'), size: -1 }])], 'should-rollback'), /check constraint/)
    assert.equal(await count('email_intake_messages'), 2); assert.equal(await count('email_intake_attachments'), 2)
    state = (await db.query('select revision,cursor_ciphertext from private.email_sync_state where integration_id=$1', [id])).rows[0]
    assert.equal(Number(state.revision), before); assert.equal(state.cursor_ciphertext, 'delta1')
    checks.push('REAL_SQL_ATOMIC_MESSAGES_ATTACHMENTS_CURSOR_ROLLBACK')
    await commit(lease, [{ externalId: 'equal', removed: true, attachments: [] }, { externalId: 'unknown-removed', removed: true, attachments: [] }], 'delta2')
    assert.equal(await count('email_intake_messages'), 2)
    assert((await db.query("select provider_removed_at from private.email_intake_messages where integration_id=$1 and external_id='equal'", [id])).rows[0].provider_removed_at)
    checks.push('KNOWN_TOMBSTONE_DURABLE_UNKNOWN_NOT_INSERTED')
    // Old metadata represents the failed Preview, not a legitimate known identity.
    const oldId = (await db.query("insert into private.email_intake_messages(integration_id,external_id,received_at) values($1,'legacy-old',$2) returning id,admission_start_at", [id, old])).rows[0]
    assert.equal(oldId.admission_start_at, null)
    const oldAttachment = (await db.query("insert into private.email_intake_attachments(message_id,external_id,file_name,content_type,size_bytes,inline,kind,queue) values($1,'legacy-old-a','synthetic.xml','application/xml',100,false,'FILE','VISUAL') returning id", [oldId.id])).rows[0].id
    // Isolate concurrency fixtures from other certification queues by switching only this integration's rows.
    await db.query("update private.email_intake_attachments set queue='VISUAL' where message_id in(select id from private.email_intake_messages where integration_id=$1)", [id])
    for (let n = 0; n < 2; n++) { const c = new Client(connection); await c.connect(); await c.query('set role service_role'); clients.push(c) }
    const claims = await Promise.all(clients.map(c => c.query("select * from public.email_intake_claim_attachment('VISUAL')")))
    const rows = claims.flatMap(c => c.rows)
    assert.equal(rows.length, 1)
    const allowed = (await db.query("select a.id from private.email_intake_attachments a join private.email_intake_messages m on m.id=a.message_id where m.integration_id=$1 and m.external_id='new'", [id])).rows[0].id
    assert.equal(rows[0].id, allowed)
    assert.equal((await rpc('email_intake_get_attachment_claim($1,$2)', [allowed, rows[0].token])).id, allowed)
    checks.push('CONCURRENT_CLAIMS_SKIP_OLD_AND_REMOVED', 'VALID_GET_CLAIM')
    const forcedToken = randomUUID()
    await db.query("update private.email_intake_attachments set status='PROCESSING',lease_token=$2,lease_expires_at=now()+interval '5 minutes' where id=$1", [oldAttachment, forcedToken])
    await assert.rejects(rpc('email_intake_get_attachment_claim($1,$2)', [oldAttachment, forcedToken]), /EMAIL_LEASE_LOST/)
    await assert.rejects(db.query('select private.fiscal_validate_email_claim($1,$2,$3)', [{ integrationId: id, messageId: oldId.id, attachmentId: oldAttachment, attachmentToken: forcedToken }, fund, randomUUID()]), /FISCAL_LEASE_LOST/)
    checks.push('FORGED_OLD_CLAIM_GET_AND_FISCAL_DEFENSE')
    await db.query("update private.email_intake_attachments set status='IGNORED',lease_token=null,lease_expires_at=null where id=any($1::uuid[])", [[oldAttachment, allowed]])
    await db.query("update private.email_integrations set start_at=$2::timestamptz+interval '1 day' where id=$1", [id, start])
    lease = await claim('DELTA')
    await commit(lease, [message('equal', '', [attachment('equal-new-a')])], 'delta3')
    const restored = (await db.query("select admission_start_at,provider_removed_at from private.email_intake_messages where integration_id=$1 and external_id='equal'", [id])).rows[0]
    assert.equal(restored.admission_start_at.toISOString(), start); assert.equal(restored.provider_removed_at, null)
    assert.equal(await count('email_intake_attachments'), 4)
    checks.push('EXISTING_ADMISSION_PRESERVED_AFTER_BOUNDARY_CHANGE')
    lease = await claim('RECONCILIATION')
    await commit(lease, [message('reconcile-old', old, [attachment('reconcile-old-a')]), message('reconcile-new', '2026-10-03T00:00:00Z', [attachment('reconcile-new-a')])], null, true, 'RECONCILIATION')
    assert.equal(await count('email_intake_messages'), 4)
    checks.push('SQL_RECONCILIATION_USES_SAME_ADMISSION')
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query("select has_function_privilege($1,'public.email_intake_known_messages(uuid,text,uuid,bigint,text[])','EXECUTE') allowed", [role])).rows[0].allowed, false)
    }
    checks.push('NO_BROWSER_KNOWN_MESSAGE_RPC')
    return checks
  } finally {
    for (const client of clients) await client.end()
    await db.query('update private.email_integrations set enabled=false where id=$1', [id])
  }
}
