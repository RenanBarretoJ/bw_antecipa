import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'

// The caller owns two fresh disposable stacks. Every actor below uses SET ROLE, not the table owner.
export async function runCallbackDiagnosticChecks({ db, fund, integration, endpoint, secretHash, worker, as, check }) {
  const sha = value => createHash('sha256').update(value).digest('hex')
  const sql = 'select vortx_registrar_callback_rejeitado($1,$2,$3,$4,$5,$6,$7,$8,$9) as r'
  const args = (n = 0) => [endpoint, secretHash, 1, 'CONTRATO_INVALIDO', 120, sha(`synthetic-${n}`),
    'v1:synthetic-only-not-cryptographic-proof', 'qa', new Date(Date.now() + 3600000).toISOString()]
  const before = (await db.query('select * from vortx_relatorio_eventos order by id')).rows
  const a = args()
  assert.equal((await worker(sql, a)).rows[0].r.estado, 'SALVO')
  assert.equal((await worker(sql, a)).rows[0].r.estado, 'DUPLICADO')
  const saved = (await db.query('select fundo_id,ambiente,revisao,expira_em>recebido_em as expires from private.vortx_callback_diagnosticos')).rows
  assert.deepEqual(saved, [{ fundo_id: fund, ambiente: 'producao', revisao: 1, expires: true }])
  check('rejected_diagnostic_scope_derived_from_endpoint_and_exact_duplicates_do_not_append')
  for (const [index, value, code] of [[0, randomUUID(), '42501'], [1, sha('wrong'), '42501'], [2, 2, '42501'],
    [3, 'ACCEPTED', '22023'], [4, 16385, '22023'], [5, 'invalid', '22023'], [6, 'plaintext', '22023'],
    [8, new Date(Date.now() - 1000).toISOString(), '22023'], [8, new Date(Date.now() + 48 * 3600000).toISOString(), '22023']]) {
    const invalid = args(); invalid[index] = value
    await assert.rejects(worker(sql, invalid), { code })
  }
  check('diagnostic_rechecks_secret_revision_endpoint_size_ciphertext_and_short_capture_window')
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(as(role, sql, a), { code: '42501' })
    await assert.rejects(as(role, 'select vortx_limpar_callback_diagnosticos_expirados()'), { code: '42501' })
  }
  for (const role of ['anon', 'authenticated', 'service_role']) for (const operation of ['select *', 'delete', "update private.vortx_callback_diagnosticos set motivo='JSON_INVALIDO'"]) {
    const statement = operation === 'select *' ? 'select * from private.vortx_callback_diagnosticos' : operation === 'delete' ? 'delete from private.vortx_callback_diagnosticos' : operation
    await assert.rejects(as(role, statement), { code: '42501' })
  }
  await assert.rejects(as('service_role', sql, a, null, { role: 'authenticated' }), { code: '42501' })
  check('no_client_rpc_no_direct_dml_or_ciphertext_read_and_worker_claim_required')
  for (const [table, column, invalid, original, id] of [
    ['fundos', 'ativo', false, true, fund], ['integracoes_fundo', 'status', 'desativada', 'ativa', integration],
    ['private.vortx_callback_endpoints', 'ativo', false, true, endpoint],
  ]) {
    await db.query(`update ${table} set ${column}=$1 where id=$2`, [invalid, id])
    await assert.rejects(worker(sql, args()), { code: '42501' })
    await db.query(`update ${table} set ${column}=$1 where id=$2`, [original, id])
  }
  check('inactive_fund_integration_and_revoked_endpoint_deny_diagnostic_capture')
  for (let n = 1; n < 20; n++) assert.equal((await worker(sql, args(n))).rows[0].r.estado, 'SALVO')
  assert.equal((await worker(sql, args(20))).rows[0].r.estado, 'LIMITE')
  assert.equal((await worker(sql, args(0))).rows[0].r.estado, 'DUPLICADO')
  assert.equal((await db.query('select count(*)::int n from private.vortx_callback_diagnosticos')).rows[0].n, 20)
  check('diagnostic_quota_is_bounded_at_twenty_distinct_bodies_per_endpoint')
  assert.equal((await worker('select vortx_limpar_callback_diagnosticos_expirados() n')).rows[0].n, 0)
  await db.query("update private.vortx_callback_diagnosticos set expira_em=now()-interval '1 second' where hash_corpo=$1", [a[5]])
  assert.equal((await worker('select vortx_limpar_callback_diagnosticos_expirados() n')).rows[0].n, 1)
  assert.equal((await db.query('select count(*)::int n from private.vortx_callback_diagnosticos')).rows[0].n, 19)
  assert.deepEqual((await db.query('select * from vortx_relatorio_eventos order by id')).rows, before)
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='private.vortx_callback_diagnosticos'::regclass")).rows[0].relrowsecurity, true)
  check('explicit_expiry_cleanup_only_removes_expired_diagnostics_never_valid_events')
}
