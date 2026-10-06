import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { verifyFiscalLifecycle } from './lifecycle-db.mjs'
import { verifyFiscalRecovery } from './recovery-db.mjs'
import { verifyNfeCompanions } from './companion-db.mjs'

// Only called by clean-room.mjs against its disposable loopback database.
export async function verifyFiscalFencing(admin, connection, parentSetup, storageFixtures) {
  assert.equal(connection.host, '127.0.0.1')
  assert.equal(connection.port, 57842)
  await admin.query(parentSetup)
  const userId = '21000000-0000-4000-8000-000000000003'
  const fundId = '22000000-0000-4000-8000-000000000001'
  const cedenteId = '23000000-0000-4000-8000-000000000001'
  const linkId = '24000000-0000-4000-8000-000000000001'
  const establishment = (await admin.query('select id from public.cedente_estabelecimentos where cedente_id=$1 and tipo=$2', [cedenteId, 'matriz'])).rows[0].id
  const sessionId = randomUUID(), factorId = randomUUID()
  await admin.query(`insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at)
    values($1,$2,'Disposable fiscal QA','totp','verified',now(),now())`, [factorId, userId])
  await admin.query(`insert into auth.sessions(id,user_id,aal,factor_id,created_at,updated_at)
    values($1,$2,'aal2',$3,now(),now())`, [sessionId, userId, factorId])
  await admin.query(`insert into public.sessoes_elevadas(user_id,session_id,metodo,factor_id,elevada_em,expira_em)
    values($1,$2,'totp',$3,now(),now()+interval '1 hour')`, [userId, sessionId, factorId])
  const integrations = [randomUUID(), randomUUID()]
  const messages = [randomUUID(), randomUUID()]
  const attachments = [randomUUID(), randomUUID()]
  const tokens = [randomUUID(), randomUUID()]
  for (let i = 0; i < 2; i++) {
    await admin.query(`insert into private.email_integrations(id,fundo_id,name,provider,mailbox_address,routing_mode,enabled,start_at,
      scope_verified_at,scope_evidence_hash,credential_env_ref,created_by)
      values($1,$2,'Disposable QA','OUTLOOK_GRAPH','qa@example.invalid','ALL_ACTIVE_CEDENTES',true,now()-interval '1 day',
      now(),repeat('a',64),'EMAIL_INTAKE_QA_SYNTHETIC',$3)`, [integrations[i], fundId, userId])
    await admin.query(`insert into private.email_intake_messages(id,integration_id,external_id,received_at)
      values($1,$2,'qa-message',now())`, [messages[i], integrations[i]])
    await admin.query(`insert into private.email_intake_attachments(id,message_id,external_id,file_name,content_type,size_bytes,kind,status,lease_token,lease_expires_at)
      values($1,$2,'qa-attachment','synthetic.pdf','application/pdf',100,'FILE','PROCESSING',$3,now()+interval '1 hour')`,
    [attachments[i], messages[i], tokens[i]])
  }
  const actors = [{ type: 'HUMAN', userId }, ...integrations.map((integrationId, i) => ({
    type: 'SYSTEM', source: 'EMAIL_INTAKE', integrationId, messageId: messages[i], attachmentId: attachments[i], attachmentToken: tokens[i],
  }))]
  const clients = []
  const checks = []
  try {
    for (let i = 0; i < 3; i++) {
      const c = new Client(connection)
      await c.connect()
      clients.push(c)
      await c.query(`select set_config('request.jwt.claims',$1,false)`, [JSON.stringify(i === 0
        ? { sub: userId, role: 'authenticated', aal: 'aal2', session_id: sessionId }
        : { role: 'service_role' })])
      await c.query(i === 0 ? 'set role authenticated' : 'set role service_role')
    }
    let serial = 0
    const key = () => '35260998100000000168' + String(++serial).padStart(24, '0')
    const reserve = async (i, fiscalKey, actor = actors[i], link = linkId, fund = fundId) =>
      (await clients[i].query('select public.fiscal_intake_reserve($1,$2,$3,$4,$5,$6,$7) result',
        [actor, fund, link, establishment, 'NFE', fiscalKey, 'a'.repeat(64)])).rows[0].result
    const planStorage = (i, claim) => clients[i].query('select public.fiscal_intake_plan_storage($1,$2,$3,$4,$5) result',
      [claim.id, claim.token, claim.generation, 'notas-fiscais', 'pdf'])

    // Hold one transaction open. The second backend must wait on the exact same
    // identity lock; a sequential pair of calls would not establish concurrency.
    for (const [winner, loser] of [[0, 1], [1, 0]]) {
      const fiscalKey = key()
      await clients[winner].query('begin')
      const claim = await reserve(winner, fiscalKey)
      assert.equal(claim.status, 'RESERVED')
      let settled = false
      const competing = reserve(loser, fiscalKey).finally(() => { settled = true })
      // Observe PostgreSQL, not just a timer/promise, to establish real blocking.
      let blocked = false
      for (let attempt = 0; attempt < 40; attempt++) {
        const result = await admin.query("select 1 from pg_stat_activity where wait_event_type='Lock' and query like 'select public.fiscal_intake_reserve%'")
        if (result.rowCount > 0) { blocked = true; break }
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      assert.ok(blocked, 'Competing backend must wait on fiscal identity')
      assert.equal(settled, false)
      await clients[winner].query('commit')
      assert.equal((await competing).status, 'IN_PROGRESS')
    }
    checks.push('REAL_CONCURRENCY_MANUAL_WINNER', 'REAL_CONCURRENCY_EMAIL_WINNER')
    const tripleKey = key()
    const race = await Promise.all([0, 1, 2].map(i => reserve(i, tripleKey)))
    assert.equal(race.filter(r => r.status === 'RESERVED').length, 1)
    assert.equal(race.filter(r => r.status === 'IN_PROGRESS').length, 2)
    checks.push('MANUAL_EMAIL_A_EMAIL_B_SINGLE_WINNER')

    const expiredKey = key()
    const old = await reserve(1, expiredKey)
    await admin.query("update private.fiscal_identity_reservations set lease_expires_at=now()-interval '1 second' where id=$1", [old.id])
    const fresh = await reserve(2, expiredKey)
    assert.equal(fresh.status, 'RESERVED')
    assert.equal(fresh.generation, old.generation + 1)
    assert.notEqual(fresh.token, old.token)
    await assert.rejects(planStorage(1, old), /FISCAL_LEASE_LOST/)
    await planStorage(2, fresh)
    checks.push('EXPIRED_OWNER_DENIED', 'CLEAN_GENERATION_TAKEOVER')

    const dirtyKey = key()
    const dirty = await reserve(1, dirtyKey)
    await planStorage(1, dirty)
    await admin.query("update private.fiscal_identity_reservations set lease_expires_at=now()-interval '1 second' where id=$1", [dirty.id])
    assert.equal((await reserve(2, dirtyKey)).status, 'CLEANUP_PENDING')
    assert.equal((await reserve(0, dirtyKey)).status, 'CLEANUP_PENDING')
    await assert.rejects(planStorage(1, dirty), /FISCAL_LEASE_LOST/)
    checks.push('UNCERTAIN_STORAGE_PREVENTS_RELEASE')

    await assert.rejects(reserve(0, key(), actors[1]), /FISCAL_ACTOR_DENIED/)
    await assert.rejects(reserve(1, key(), { ...actors[1], attachmentToken: randomUUID() }), /FISCAL_LEASE_LOST/)
    await assert.rejects(reserve(1, key(), { ...actors[1], integrationId: integrations[1] }), /FISCAL_LEASE_LOST/)
    await assert.rejects(reserve(1, key(), actors[1], linkId, randomUUID()), /FISCAL_SCOPE_DENIED/)
    await admin.query("update private.email_integrations set routing_mode='ALLOWLIST' where id=$1", [integrations[0]])
    await assert.rejects(reserve(1, key()), /FISCAL_ROUTING_DENIED/)
    await admin.query('insert into private.email_integration_cedentes(integration_id,cedente_id,created_by) values($1,$2,$3)', [integrations[0], cedenteId, userId])
    assert.equal((await reserve(1, key())).status, 'RESERVED')
    await admin.query('update private.email_integrations set enabled=false where id=$1', [integrations[0]])
    await assert.rejects(reserve(1, key()), /FISCAL_LEASE_LOST/)
    checks.push('ACTOR_ROUTING_FUND_INTEGRATION_CLAIM_GUARDS')

    await admin.query('update public.sessoes_elevadas set revogada_em=now() where user_id=$1', [userId])
    await assert.rejects(reserve(0, key()), /FISCAL_ACTOR_DENIED/)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const row = (await admin.query(`select has_table_privilege($1,'private.fiscal_identity_reservations','SELECT,INSERT,UPDATE,DELETE') reservation,
        has_table_privilege($1,'private.fiscal_storage_intents','SELECT,INSERT,UPDATE,DELETE') storage`, [role])).rows[0]
      assert.equal(row.reservation, false)
      assert.equal(row.storage, false)
    }
    checks.push('MFA_REVOCATION', 'NO_DIRECT_TABLE_GRANTS')
    // Restore only this disposable fixture for atomic persistence tests.
    await admin.query('update public.sessoes_elevadas set revogada_em=NULL where user_id=$1', [userId])
    await admin.query('update private.email_integrations set enabled=true where id=$1', [integrations[0]])
    for (const actorIndex of [0, 1]) {
      const fiscalKey = key()
      const reserved = await reserve(actorIndex, fiscalKey)
      assert.equal(reserved.status, 'RESERVED')
      const dates = (await admin.query("select current_date::text issued,(current_date+30)::text due")).rows[0]
      const values = { tipo_documento_fiscal: 'NFE', numero_nf: `FISCAL-QA-${actorIndex}`, chave_acesso: fiscalKey,
        cnpj_emitente: '98100000000168', razao_social_emitente: 'Cedente QA', cnpj_destinatario: '11222333000181',
        razao_social_destinatario: 'Sacado QA', valor_bruto: 100, valor_liquido: 100, data_emissao: dates.issued,
        data_vencimento: dates.due, valor_icms: 0, valor_iss: 0, valor_pis: 0, valor_cofins: 0, valor_ipi: 0 }
      const stageArgs = [reserved.id, reserved.token, reserved.generation, values,
        JSON.stringify([{ numero_parcela: 1, valor_nominal: 100, data_vencimento: dates.due }]), 'synthetic.xml', 'application/xml', 100, 'nf_xml']
      const stageSql = 'select public.fiscal_intake_stage($1,$2,$3,$4,$5,$6,$7,$8,$9)'
      await assert.rejects(clients[0].query(stageSql, stageArgs), /permission denied/)
      await clients[1].query(stageSql, stageArgs)
      const intent = (await clients[actorIndex].query('select public.fiscal_intake_prepare_storage($1,$2,$3) result',
        [reserved.id, reserved.token, reserved.generation])).rows[0].result
      // Full-stack runs create the receipt through the real API, never SQL.
      if (storageFixtures) await storageFixtures.put(intent)
      else await admin.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',
        [intent.bucket, intent.path, { size: 100, mimetype: 'application/xml' }])
      const imported = (await clients[actorIndex].query('select public.fiscal_intake_commit($1,$2,$3,$4) result',
        [reserved.id, reserved.token, reserved.generation, intent.id])).rows[0].result
      assert.ok(imported.nfId)
      const nf = (await admin.query('select source_channel from public.notas_fiscais where id=$1', [imported.nfId])).rows[0]
      assert.equal(nf.source_channel, actorIndex === 0 ? 'MANUAL_UPLOAD' : 'EMAIL_INTAKE')
      assert.equal((await admin.query('select count(*)::integer n from public.nota_fiscal_parcelas where nota_fiscal_id=$1', [imported.nfId])).rows[0].n, 1)
      const audit = (await admin.query("select usuario_id,ator_tipo from public.logs_auditoria where entidade_id=$1 and origem='fiscal_intake'", [imported.nfId])).rows[0]
      assert.equal(audit.usuario_id, actorIndex === 0 ? userId : null)
      assert.equal(audit.ator_tipo, actorIndex === 0 ? 'usuario' : 'sistema')
      await clients[0].query('select public.excluir_notas_fiscais_rascunho_cedente($1)', [[imported.nfId]])
      if (actorIndex !== 0) {
        const history = (await admin.query('select nota_fiscal_id,status from private.email_intake_attachments where deleted_nota_fiscal_id=$1', [imported.nfId])).rows
        assert.equal(history.length, 1)
        assert.equal(history[0].nota_fiscal_id, null)
        assert.equal(history[0].status, 'IMPORTED')
      }
      assert.equal((await admin.query('select state from private.fiscal_identity_reservations where id=$1', [reserved.id])).rows[0].state, 'CLEANUP_PENDING')
      if (storageFixtures) await storageFixtures.remove(intent)
      else await admin.query('delete from storage.objects where bucket_id=$1 and name=$2', [intent.bucket, intent.path])
      const cleanup = (await clients[1].query('select public.fiscal_intake_claim_cleanup($1) result', [reserved.id])).rows[0].result
      await clients[1].query('select public.fiscal_intake_settle_cleanup($1,$2,true)', [cleanup.id, cleanup.token])
      assert.equal((await admin.query('select state from private.fiscal_identity_reservations where id=$1', [reserved.id])).rows[0].state, 'RELEASED')
    }
    checks.push('ATOMIC_HUMAN_AND_SYSTEM_NF_PARCELS_AUDIT', 'SERVER_ONLY_FISCAL_FACTS', 'DRAFT_DELETE_DURABLE_CLEANUP')
    checks.push(...await verifyFiscalLifecycle({ admin, clients, fundId, linkId, establishment, actors, messages, userId }))
    checks.push(...await verifyFiscalRecovery({ admin, clients, fundId, linkId, establishment, actors, messages, cedenteId, storageFixtures }))
    checks.push(...await verifyNfeCompanions({ admin, clients, connection, fundId, linkId, establishment, actors, storageFixtures }))
    return checks
  } finally {
    for (const client of clients) { await client.query('rollback').catch(() => {}); await client.end() }
  }
}
