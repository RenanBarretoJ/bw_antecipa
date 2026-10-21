import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function runCallbackCaptureChecks({ db, config, fund, otherFund, integration, endpoint, worker, as, check }) {
  const baseline = (await db.query('select * from vortx_relatorio_eventos order by id')).rows
  const reserve = 'select vortx_reservar_captura_callback($1,$2,$3) as r'
  const save = 'select vortx_concluir_captura_callback($1,$2,$3,$4,$5,$6,$7) as r'
  const create = async () => {
    const id = randomUUID()
    await db.query(`insert into private.vortx_callback_capturas_temporarias(id,endpoint_id,fundo_id,revisao,capturar_ate,expira_em)
      values($1,$2,$3,1,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '23 hours')`, [id, endpoint, fund])
    return id
  }
  const args = id => [id, 'rsa1:synthetic-only-not-cryptographic-proof', 'qa', 'a'.repeat(64), 128, true, 401]
  const id = await create()
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(as(role, reserve, [id, endpoint, fund]), { code: '42501' })
    await assert.rejects(as(role, save, args(id)), { code: '42501' })
    await assert.rejects(as(role, 'select vortx_limpar_capturas_callback_expiradas()'), { code: '42501' })
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const statement of ['select * from private.vortx_callback_capturas_temporarias',
      'delete from private.vortx_callback_capturas_temporarias',
      'update private.vortx_callback_capturas_temporarias set reservada_em=now()']) {
      await assert.rejects(as(role, statement), { code: '42501' })
    }
  }
  await assert.rejects(as('service_role', reserve, [id, endpoint, fund], null, { role: 'authenticated' }), { code: '42501' })
  check('capture_no_client_rpc_or_direct_read_write_and_worker_claim_required')
  for (const values of [[randomUUID(), endpoint, fund], [id, randomUUID(), fund], [id, endpoint, otherFund]]) {
    assert.equal((await worker(reserve, values)).rows[0].r.estado, 'IGNORADA')
  }
  assert.equal((await worker(save, args(id))).rows[0].r.estado, 'IGNORADA')
  check('capture_requires_exact_operator_window_endpoint_fund_and_prior_reservation')
  for (const [table, column, invalid, original, target] of [
    ['fundos', 'ativo', false, true, fund], ['integracoes_fundo', 'status', 'desativada', 'ativa', integration],
    ['private.vortx_callback_endpoints', 'ativo', false, true, endpoint],
    ['private.vortx_callback_endpoints', 'revisao', 2, 1, endpoint],
  ]) {
    await db.query(`update ${table} set ${column}=$1 where id=$2`, [invalid, target])
    assert.equal((await worker(reserve, [id, endpoint, fund])).rows[0].r.estado, 'IGNORADA')
    await db.query(`update ${table} set ${column}=$1 where id=$2`, [original, target])
  }
  check('capture_inactive_fund_integration_endpoint_or_revision_denied')
  assert.equal((await worker(reserve, [id, endpoint, fund])).rows[0].r.estado, 'RESERVADA')
  assert.equal((await worker(reserve, [id, endpoint, fund])).rows[0].r.estado, 'IGNORADA')
  for (const [index, value] of [[1, 'plaintext'], [2, ''], [3, 'bad'], [4, 16385], [5, null], [6, 999]]) {
    const invalid = args(id); invalid[index] = value
    await assert.rejects(worker(save, invalid), { code: '22023' })
  }
  assert.equal((await worker(save, args(id))).rows[0].r.estado, 'SALVA')
  assert.equal((await worker(save, args(id))).rows[0].r.estado, 'IGNORADA')
  check('capture_one_shot_reservation_no_overwrite_bounded_encrypted_envelope')
  const pg = await import('pg')
  const clients = await Promise.all(Array.from({ length: 4 }, async () => { const c = new pg.default.Client(config); await c.connect(); return c }))
  const concurrentId = await create()
  try {
    const states = await Promise.all(clients.map(client => worker(reserve, [concurrentId, endpoint, fund], client)))
    assert.equal(states.filter(r => r.rows[0].r.estado === 'RESERVADA').length, 1)
    assert.equal(states.filter(r => r.rows[0].r.estado === 'IGNORADA').length, 3)
  } finally { await Promise.all(clients.map(c => c.end())) }
  check('capture_concurrent_reservation_exactly_one_of_four_succeeds')
  for (const [column, expression] of [['revisao', '2'], ['ativo', 'false']]) {
    const changed = await create(); await worker(reserve, [changed, endpoint, fund])
    await db.query(`update private.vortx_callback_endpoints set ${column}=${expression} where id=$1`, [endpoint])
    assert.equal((await worker(save, args(changed))).rows[0].r.estado, 'IGNORADA')
    await db.query('update private.vortx_callback_endpoints set revisao=1,ativo=true where id=$1', [endpoint])
  }
  check('capture_rotation_and_revocation_rechecked_at_encrypted_persistence')
  const expired = await create()
  await db.query(`update private.vortx_callback_capturas_temporarias set criada_em=now()-interval '24 hours',
    capturar_ate=now()-interval '23 hours',expira_em=now()-interval '1 second' where id=$1`, [expired])
  assert.equal((await worker(reserve, [expired, endpoint, fund])).rows[0].r.estado, 'IGNORADA')
  assert.equal((await worker('select vortx_limpar_capturas_callback_expiradas() as n')).rows[0].n, 1)
  assert.equal((await db.query('select count(*)::int as n from private.vortx_callback_capturas_temporarias where id=$1', [id])).rows[0].n, 1)
  assert.deepEqual((await db.query('select * from vortx_relatorio_eventos order by id')).rows, baseline)
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='private.vortx_callback_capturas_temporarias'::regclass")).rows[0].relrowsecurity, true)
  check('capture_logical_expiry_explicit_purge_only_diagnostics_and_business_inbox_unchanged')
}
