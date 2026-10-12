import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function verifyScopedClaims(db) {
  assert.equal(db.connectionParameters.host, '127.0.0.1')
  assert.equal(db.connectionParameters.port, 57862)
  const fund = '22000000-0000-4000-8000-000000000001', user = '21000000-0000-4000-8000-000000000003'
  const integration = randomUUID(), credential = randomUUID(), message = randomUUID(), attachment = randomUUID()
  const outside = randomUUID(), outsideMessage = randomUUID(), exhausted = randomUUID(), tenant = randomUUID(), mailboxObject = randomUUID()
  const scope = { integrationId: integration, fundoId: fund, mailbox: 'scoped@example.invalid', folderId: 'inbox', tenantId: tenant, mailboxObjectId: mailboxObject }
  const call = async (name, mode, scopes) => (await db.query(`select public.${name}($1,$2::jsonb) result`, [mode, JSON.stringify(scopes)])).rows
  const state = async () => (await db.query(`select id,status,attempts,lease_token from private.email_intake_attachments where id=any($1::uuid[]) order by id`, [[attachment, exhausted]])).rows
  await db.query('BEGIN')
  try {
    await db.query(`insert into public.credenciais_integracao(id,fundo_id,ambiente,nome,provider_key,credential_type,capabilities,
      usuario_criptografado,senha_criptografada,chave_versao,status,criada_por,ativada_em)
      values($1,$2,'producao','Synthetic scoped QA','OUTLOOK_GRAPH','oauth_client_credentials',ARRAY['EMAIL_INTAKE'],
        'v1:QA:QA:QA','v1:QA:QA:QA','qa','ativa',$3,now())`, [credential, fund, user])
    for (const id of [integration, outside]) {
      await db.query(`insert into private.email_integrations(id,fundo_id,name,provider,environment,mailbox_address,mailbox_object_id,
        credential_id,enabled,start_at,scope_verified_at,scope_evidence_hash,created_by,routing_mode)
        values($1,$2,'Scoped QA','OUTLOOK_GRAPH','producao','scoped@example.invalid',$3,$4,true,now()-interval '1 day',now(),repeat('a',64),$5,'ALLOWLIST')`, [id, fund, mailboxObject, credential, user])
      await db.query(`insert into private.email_automation(integration_id,enabled,tenant_id,mailbox_object_id,subscription_resource)
        values($1,true,$2,$3,$4)`, [id, tenant, mailboxObject, `users/${mailboxObject}/mailFolders/inbox/messages`])
    }
    for (const [id, parent] of [[message, integration], [outsideMessage, outside]]) await db.query('insert into private.email_intake_messages(id,integration_id,external_id,received_at) values($1,$2,$3,now())', [id, parent, randomUUID()])
    await db.query(`insert into private.email_intake_attachments(id,message_id,external_id,file_name,content_type,size_bytes,kind)
      values($1,$2,'scoped','synthetic.xml','application/xml',100,'FILE')`, [attachment, message])
    await db.query(`insert into private.email_intake_attachments(id,message_id,external_id,file_name,content_type,size_bytes,kind,status,attempts,max_attempts,lease_token,lease_expires_at)
      values($1,$2,'outside','synthetic.xml','application/xml',100,'FILE','PROCESSING',5,5,gen_random_uuid(),now()-interval '1 minute')`, [exhausted, outsideMessage])
    const before = await state()
    await db.query(`insert into private.email_webhook_receipts(integration_id,dedupe_key,received_at)
      values($1,repeat('c',64),now()-interval '2 days'),($2,repeat('d',64),now()-interval '2 days')`, [integration, outside])
    await db.query("SET LOCAL ROLE service_role;SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
    for (const field of Object.keys(scope)) {
      const bad = [{ ...scope, [field]: field === 'mailbox' ? 'wrong@example.invalid' : field === 'folderId' ? 'wrong' : randomUUID() }]
      assert.equal((await call('email_automation_claim_scoped', 'DELTA', bad))[0].result, null, `WRONG_${field}_DISCOVERY_CLAIMED`)
      const rows = await db.query('select * from public.email_intake_claim_attachment_scoped($1,$2::jsonb)', ['TEXT', JSON.stringify(bad)])
      assert.equal(rows.rows.length, 0, `WRONG_${field}_ATTACHMENT_CLAIMED`)
    }
    await db.query('RESET ROLE')
    assert.deepEqual(await state(), before, 'OUTSIDE_SCOPE_STATE_MUTATED')
    await db.query("SET LOCAL ROLE service_role")
    const job = (await call('email_automation_claim_scoped', 'DELTA', [scope]))[0].result
    assert.equal(job.integrationId, integration)
    const claimed = (await db.query('select * from public.email_intake_claim_attachment_scoped($1,$2::jsonb)', ['TEXT', JSON.stringify([scope])])).rows
    assert.equal(claimed.length, 1); assert.equal(claimed[0].id, attachment)
    await db.query('select public.email_automation_apply_health_scoped($1,$2,$3::text[],$4::jsonb)', [integration, 'HEALTHY', [], JSON.stringify([scope])])
    await db.query('RESET ROLE')
    assert.equal((await db.query('select count(*)::int n from private.email_webhook_receipts where integration_id=any($1::uuid[])', [[integration, outside]])).rows[0].n, 2, 'PRODUCTION_HEALTH_PRUNED_RECEIPTS')
    assert.deepEqual((await state()).find(r => r.id === exhausted), before.find(r => r.id === exhausted), 'OUTSIDE_SCOPE_EXHAUSTION_MUTATED')
    await db.query('SAVEPOINT denied;SET LOCAL ROLE authenticated')
    await assert.rejects(call('email_automation_claim_scoped', 'DELTA', [scope]), e => e.code === '42501')
    await db.query('ROLLBACK TO SAVEPOINT denied;RELEASE SAVEPOINT denied')
    return ['SCOPED_DISCOVERY_AND_ATTACHMENT_ALL_SIX_TUPLE_FIELDS_DENIED_BEFORE_CLAIM', 'SCOPED_CLAIMS_PRESERVE_OUTSIDE_QUEUE_AND_EXHAUSTION', 'SCOPED_VALID_VAULT_INTEGRATION_CLAIMS_ONLY_ITS_OWN_JOBS', 'SCOPED_RPC_AUTHENTICATED_EXECUTE_DENIED', 'PRODUCTION_HEALTH_PRESERVES_OWN_AND_OUTSIDE_RECEIPTS_OLDER_THAN_24H']
  } finally { await db.query('ROLLBACK') }
}
