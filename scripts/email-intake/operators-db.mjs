import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { assertR110OwnedConnection } from '../qa/reconciliation/r1-10-stack-guard.mjs'

/** Real SQL, auth roles and session records; only the disposable loopback database. */
export async function verifyEmailOperators(db, connection) {
  if(connection.application_name?.startsWith('r110_'))await assertR110OwnedConnection(connection,'operators')
  else {assert.equal(connection.host, '127.0.0.1'); assert(connection.port===57842||(connection.port===57942&&/^(?:r18_operators_\d+|r19_operators_\d+_[0-9a-f]{8})$/.test(connection.database)),'OWNED_LOCAL_OPERATOR_DATABASE_REQUIRED')}
  const fund = '22000000-0000-4000-8000-000000000001', user = '21000000-0000-4000-8000-000000000004'
  const cedente = '23000000-0000-4000-8000-000000000001', session = randomUUID(), factor = randomUUID()
  const otherFund = randomUUID(), otherMessage = randomUUID(), checks = []
  const actor = new Client(connection), service = new Client(connection)
  let stage = 'SETUP'
  await actor.connect(); await service.connect()
  const call = async (client, sql, args = []) => (await client.query(`select public.${sql} value`, args)).rows[0].value
  const claims = age => actor.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2', session_id: session, amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - age }] })])
  const config = { requestId: randomUUID(), name: 'EMAIL05 configuration QA', provider: 'OUTLOOK_GRAPH', environment: 'homologacao', mailbox: null,
    mailboxObjectId: null, folderId: 'inbox', credentialId: null, routingMode: 'ALLOWLIST', cedenteIds: [], startAt: null }
  try {
    await db.query(`insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values($1,$2,'EMAIL05 local','totp','verified',now(),now())`, [factor, user])
    await db.query(`insert into auth.sessions(id,user_id,aal,factor_id,created_at,updated_at) values($1,$2,'aal2',$3,now(),now())`, [session, user, factor])
    await db.query(`insert into public.sessoes_elevadas(user_id,session_id,metodo,factor_id,elevada_em,expira_em) values($1,$2,'totp',$3,now(),now()+interval '1 hour')`, [user, session, factor])
    await db.query(`insert into public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
      select $1,'EMAIL05 other fund','98000000000510',administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,true from public.fundos where id=$2`, [otherFund, fund])
    await actor.query('set role authenticated'); await service.query('set role service_role'); await claims(600)
    stage = 'DRAFT_AND_MFA'
    await assert.rejects(call(actor, 'email_operator_save($1,null,null,$2)', [fund, config]), /EMAIL_ACCESS_DENIED/)
    await claims(0)
    const id = await call(actor, 'email_operator_save($1,null,null,$2)', [fund, config])
    assert.equal(await call(actor, 'email_operator_save($1,null,null,$2)', [fund, config]), id)
    let state = await call(actor, 'email_operator_dashboard($1,$2)', [fund, id])
    assert.equal(state.integrations[0].configStatus, 'DRAFT'); assert.equal(state.integrations[0].credentialId, null)
    assert.equal(state.integrations[0].health, null)
    await assert.rejects(call(actor, 'email_operator_set_enabled($1,1,true,true)', [id]), /EMAIL_ACTIVATION_INCOMPLETE/)
    await assert.rejects(call(actor, 'email_operator_begin_test($1,1)', [id]), /EMAIL_CONFIGURATION_INCOMPLETE/)
    await assert.rejects(call(actor, 'email_operator_create_credential($1,$2,$3,$4,$5,$6,$7)', [fund, 'QA', 'homologacao', 'v1:QA:QA:QA', 'v1:QA:QA:QA', 'qa', randomUUID()]), /EMAIL_ACCESS_DENIED/)
    checks.push('DRAFT_WITHOUT_CREDENTIAL_NO_AUTOMATION', 'FRESH_MFA_REQUIRED', 'GESTOR_CANNOT_CREATE_SECRET')
    stage = 'CREATE_CREDENTIAL'
    await db.query("insert into public.usuario_papeis(usuario_id,papel,ativo,origem) values($1,'super_admin',true,'administracao') on conflict(usuario_id,papel) do update set ativo=true", [user])
    await db.query("update public.profiles set role='super_admin' where id=$1", [user])
    const credentialRequest = randomUUID()
    const credential = await call(actor, 'email_operator_create_credential($1,$2,$3,$4,$5,$6,$7)', [fund, 'QA OAuth', 'homologacao', 'v1:QA:QA:QA', 'v1:QA:QA:QA', 'qa', credentialRequest])
    assert.equal(await call(actor, 'email_operator_create_credential($1,$2,$3,$4,$5,$6,$7)', [fund, 'QA OAuth', 'homologacao', 'v1:QA:QA:QA', 'v1:QA:QA:QA', 'qa', credentialRequest]), credential)
    const otherCredential = await call(actor, 'email_operator_create_credential($1,$2,$3,$4,$5,$6,$7)', [otherFund, 'Other QA OAuth', 'homologacao', 'v1:QA:QA:QA', 'v1:QA:QA:QA', 'qa', randomUUID()])
    await db.query("update public.usuario_papeis set ativo=false,revogado_em=now() where usuario_id=$1 and papel='super_admin'", [user])
    await db.query("update public.profiles set role='gestor' where id=$1", [user])
    const complete = { ...config, mailbox: 'qa@example.invalid', mailboxObjectId: randomUUID(), credentialId: credential,
      cedenteIds: [cedente], startAt: new Date(Date.now() - 60000).toISOString() }
    stage = 'CONFIGURATION_AND_TEST'
    await assert.rejects(call(actor, 'email_operator_save($1,$2,1,$3)', [fund, id, { ...complete, credentialId: otherCredential }]), /EMAIL_CREDENTIAL_INCOMPATIBLE/)
    await assert.rejects(call(actor, 'email_operator_save($1,$2,1,$3)', [fund, id, { ...complete, environment: 'producao' }]), /EMAIL_CREDENTIAL_INCOMPATIBLE/)
    await assert.rejects(call(actor, 'email_operator_save($1,$2,1,$3)', [fund, id, { ...complete, cedenteIds: [randomUUID()] }]), /EMAIL_CEDENTE_DENIED/)
    await call(actor, 'email_operator_save($1,$2,1,$3)', [fund, id, complete])
    await assert.rejects(call(actor, 'email_operator_save($1,$2,1,$3)', [fund, id, complete]), /EMAIL_CONFIG_CONFLICT/)
    state = await call(actor, 'email_operator_dashboard($1,$2)', [fund, id])
    assert.equal(state.integrations[0].credentialId, credential); assert.equal(state.integrations[0].revision, 2)
    assert.ok(!/Ciphertext|criptografado|v1:QA|credential_env_ref|test_token/.test(JSON.stringify(state)))
    const token = await call(actor, 'email_operator_begin_test($1,2)', [id])
    await assert.rejects(call(actor, 'email_operator_complete_test($1,$2,$3,null)', [id, token, randomUUID()]), /permission denied/)
    await assert.rejects(call(actor, 'email_credential_material($1)', [id]), /permission denied/)
    await call(service, 'email_operator_complete_test($1,$2,$3,null)', [id, token, randomUUID()])
    await call(actor, 'email_operator_set_enabled($1,2,true,true)', [id])
    await assert.rejects(call(actor, 'email_operator_save($1,$2,2,$3)', [fund, id, complete]), /EMAIL_PAUSE_BEFORE_EDIT/)
    await call(actor, 'email_operator_set_enabled($1,2,false,false)', [id])
    const audit = (await db.query('select tipo_evento, count(*)::int total from public.logs_auditoria where entidade_id=$1 and usuario_id=$2 group by tipo_evento', [id, user])).rows
    for (const event of ['EMAIL_INTEGRATION_CREATED', 'EMAIL_INTEGRATION_UPDATED', 'EMAIL_INTEGRATION_ENABLED', 'EMAIL_INTEGRATION_DISABLED', 'EMAIL_INTEGRATION_CREDENTIAL_CHANGED', 'EMAIL_INTEGRATION_START_AT_CHANGED']) assert.equal(audit.find(row => row.tipo_evento === event)?.total, 1, event)
    assert.equal(audit.find(row => row.tipo_evento === 'EMAIL_INTEGRATION_ROUTING_CHANGED')?.total, 2)
    assert.equal((await db.query("select count(*)::int total from public.logs_auditoria where entidade_id=$1 and (coalesce(dados_antes::text,'')||coalesce(dados_depois::text,'')) ~ 'v1:QA|criptografado|Ciphertext|clientSecret'", [id])).rows[0].total, 0)
    const options = await call(actor, 'email_operator_cedentes($1)', [fund])
    assert.ok(options.rows.some(row => row.id === cedente))
    checks.push('INTEGRATION_FIRST_CREDENTIAL_LINK_PERSISTS', 'CREDENTIAL_FUND_ENVIRONMENT_ISOLATION', 'ALLOWLIST_ELIGIBILITY', 'OPTIMISTIC_CONCURRENCY', 'TEST_SERVER_ONLY', 'ENABLE_DISABLE_AUDIT', 'REDACTION')
    // Two integrations share the same existing vault record, with no copied secrets.
    const second = await call(actor, 'email_operator_save($1,null,null,$2)', [fund, { ...complete, requestId: randomUUID(), name: 'EMAIL05 credential first', routingMode: 'ALL_ACTIVE_CEDENTES' }])
    stage = 'INBOX'
    assert.equal((await call(actor, 'email_operator_dashboard($1,$2)', [fund, second])).integrations[0].credentialId, credential)
    for (let i = 0; i < 27; i++) {
      const msg = randomUUID()
      await db.query('insert into private.email_intake_messages(id,integration_id,external_id,received_at) values($1,$2,$3,now())', [msg, id, `EMAIL05-${i}`])
      await db.query(`insert into private.email_intake_attachments(message_id,external_id,file_name,content_type,size_bytes,kind,status,last_error_code)
        values($1,'attachment','qa.xml','application/xml',10,'FILE',$2,$3)`, [msg, i === 0 ? 'QUARANTINED' : 'DUPLICATE', i === 0 ? 'UNKNOWN_CEDENTE' : null])
    }
    const inbox = await call(actor, 'email_operator_inbox($1,$2)', [fund, { integrationId: id }])
    assert.equal(inbox.total, 27); assert.equal(inbox.rows.length, 25)
    assert.equal((await call(actor, 'email_operator_inbox($1,$2)', [fund, { integrationId: id, page: 2 }])).rows.length, 2)
    assert.equal((await call(actor, 'email_operator_inbox($1,$2)', [fund, { integrationId: id, status: 'DUPLICATE' }])).total, 26)
    assert.equal((await call(actor, 'email_operator_inbox($1,$2)', [fund, { integrationId: id, errorCode: 'UNKNOWN_CEDENTE' }])).total, 1)
    const detail = await call(actor, 'email_operator_message($1,$2)', [fund, inbox.rows[0].id])
    assert.equal(detail.attachments.length, 1); assert.ok(!JSON.stringify(detail).includes('external_id'))
    stage = 'METADATA'
    const metadataToken = await call(actor, 'email_operator_begin_metadata($1,$2)', [fund, [inbox.rows[0].id]])
    await assert.rejects(call(actor, 'email_operator_metadata_source($1,$2)', [fund, metadataToken]), /permission denied/)
    const metadata = await call(service, 'email_operator_metadata_source($1,$2)', [fund, metadataToken])
    assert.equal(metadata.length, 1); assert.equal(metadata[0].messages.length, 1)
    assert.equal(await call(service, 'email_operator_complete_metadata($1,$2)', [metadataToken, JSON.stringify([{ id: inbox.rows[0].id, subject: 'QA safe subject', sender: 'q***@example.invalid' }])]), 1)
    assert.equal(await call(service, 'email_operator_complete_metadata($1,$2)', [metadataToken, JSON.stringify([{ id: inbox.rows[0].id, subject: 'REPLAY', sender: 'q***@example.invalid' }])]), 0)
    await assert.rejects(call(actor, 'email_operator_begin_metadata($1,$2)', [otherFund, [inbox.rows[0].id]]), /EMAIL_ACCESS_DENIED/)
    assert.equal((await call(actor, 'email_operator_message($1,$2)', [fund, inbox.rows[0].id])).subject, 'QA safe subject')
    await assert.rejects(call(actor, 'email_operator_dashboard($1)', [otherFund]), /EMAIL_ACCESS_DENIED/)
    await assert.rejects(call(actor, 'email_operator_message($1,$2)', [otherFund, inbox.rows[0].id]), /EMAIL_ACCESS_DENIED/)
    await assert.rejects(call(actor, 'email_operator_message($1,$2)', [fund, otherMessage]), /EMAIL_ACCESS_DENIED/)
    await assert.rejects(call(actor, 'email_operator_save($1,$2,2,$3)', [fund, id, { ...complete, startAt: '2000-01-01T00:00:00Z' }]), /EMAIL_HISTORY_IMMUTABLE/)
    await db.query("update public.credenciais_integracao set status='revogada',revogada_em=now() where id=$1", [credential])
    await assert.rejects(call(service, 'email_credential_material($1)', [id]), /EMAIL_CREDENTIAL_UNAVAILABLE/)
    state = await call(actor, 'email_operator_dashboard($1,$2)', [fund, id])
    assert.equal(state.integrations[0].enabled, false); assert.equal(state.credentials.length, 0)
    checks.push('IDEMPOTENT_CREATION', 'CREDENTIAL_FIRST_REUSE', 'SERVER_PAGINATION_AND_FILTERS', 'MESSAGE_DETAIL_SAFE', 'METADATA_SCOPE_LEASE_AND_REPLAY', 'CROSS_FUND_DENIED', 'HISTORY_START_BOUNDARY', 'REVOKED_CREDENTIAL_STOPS_JOBS')
    for (const role of ['cedente', 'consultor']) {
      await db.query('update public.profiles set role=$2 where id=$1', [user, role])
      await assert.rejects(call(actor, 'email_operator_dashboard($1)', [fund]), /EMAIL_ACCESS_DENIED/)
      await assert.rejects(call(actor, 'email_operator_save($1,null,null,$2)', [fund, config]), /EMAIL_ACCESS_DENIED/)
    }
    checks.push('CEDENTE_CONSULTOR_DENIED_GLOBAL_ADMIN')
    await db.query("update public.profiles set role='gestor' where id=$1", [user])
    return checks
  } catch (error) { throw new Error(`EMAIL05_${stage}: ${error.message}`) }
  finally {
    await actor.end(); await service.end()
  }
}
