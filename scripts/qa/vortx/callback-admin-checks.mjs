import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
const sha = value => createHash('sha256').update(value).digest('hex')

export async function runCallbackAdminChecks({ db, config, fund, otherFund, admin, ordinary, cross, unbound, as, user, worker, check }) {
  const integration = randomUUID(), version = randomUUID(), wallet = 'qa-admin-callback-synthetic'
  await db.query("insert into integracoes_fundo values($1,$2,'ativa','VORTX')", [integration, fund])
  await db.query("insert into integracao_fundo_versoes values($1,$2,'producao','publicada','vortx_vrs',$3)", [version, integration, { codigo_carteira: wallet }])
  const statusSql = 'select admin_vortx_callback_status($1,$2) r', mutateSql = 'select admin_vortx_callback_mutar($1,$2,$3,$4,$5,$6) r'
  async function nonce(actor = admin, action = 'configurar_credencial_vortx_vrs') {
    const hash = sha(randomUUID())
    await db.query("insert into autorizacoes_acoes_sensiveis values($1,$2,$3,$4,$5,null,null,now()+interval '2 minutes')", [randomUUID(), actor.id, actor.session, action, hash]); return hash
  }
  const hash1 = sha('qa-secret-1'), hash2 = sha('qa-secret-2')
  const args = (acao, revision, hash, authNonce, targetFund = fund, targetVersion = version) => [targetFund, targetVersion, acao, revision, hash, authNonce]
  assert.equal((await user(statusSql, [fund, version])).rows[0].r.revisao, 0); check('admin_empty_state_no_secret')
  for (const [label, actor] of [['ordinary', ordinary], ['cross_fund', cross], ['unbound', unbound]]) {
    await assert.rejects(user(statusSql, [fund, version], actor), { code: '42501' })
    await assert.rejects(user(mutateSql, args('gerar', 0, hash1, await nonce(actor)), actor), { code: '42501' }); check(`admin_${label}_read_and_mutation_denied`)
  }
  for (const role of ['anon', 'service_role']) for (const sql of [statusSql, mutateSql]) {
    await assert.rejects(as(role, sql, sql === statusSql ? [fund, version] : args('gerar', 0, hash1, await nonce()), admin), { code: '42501' })
  }
  await assert.rejects(user('select private.vortx_callback_configurar_base($1,$2,$3)', [fund, version, hash1]), { code: '42501' }); check('admin_rpc_grants_no_anon_service_or_private_helper_execution')
  for (const claims of [{ aal: 'aal1' }, { session_id: null }]) await assert.rejects(user(statusSql, [fund, version], admin, claims), { code: '42501' })
  check('admin_status_requires_canonical_mfa_claims')
  await assert.rejects(user(mutateSql, args('gerar', 0, hash1, sha('missing'))), { code: '42501' })
  await assert.rejects(user(mutateSql, args('gerar', 0, hash1, await nonce(admin, 'testar_conexao_vortx_vrs'))), { code: '42501' })
  assert.equal((await user(statusSql, [fund, version])).rows[0].r.revisao, 0); check('missing_or_wrong_action_nonce_rolls_back_creation')
  const firstNonce = await nonce()
  const first = (await user(mutateSql, args('gerar', 0, hash1, firstNonce))).rows[0].r
  assert.equal(first.ativo, true); assert.equal(first.revisao, 1); assert.equal(first.carteira, wallet)
  assert.equal(first.cadastroInformadoEm, null)
  assert(!JSON.stringify(first).includes(hash1)); assert.deepEqual(Object.keys(first).sort(), ['id', 'revisao', 'ativo', 'carteira', 'ambiente', 'geradaEm', 'cadastroInformadoEm', 'ultimoEventoEm'].sort())
  assert((await db.query('select consumida_em from autorizacoes_acoes_sensiveis where nonce_hash=$1', [firstNonce])).rows[0].consumida_em)
  check('generation_atomic_with_nonce_and_minimal_safe_dto')
  await assert.rejects(user(mutateSql, args('rotacionar', 1, hash2, firstNonce)), { code: '42501' }); check('nonce_reuse_denied')
  await assert.rejects(user(mutateSql, args('gerar', 1, hash2, await nonce())), { code: '23514' })
  const stale = await nonce()
  await assert.rejects(user(mutateSql, args('rotacionar', 0, hash2, stale)), { code: '40001' })
  assert.equal((await db.query('select consumida_em from autorizacoes_acoes_sensiveis where nonce_hash=$1', [stale])).rows[0].consumida_em, null)
  check('stale_revision_and_invalid_state_do_not_consume_nonce')
  const informed = (await user(mutateSql, args('informar_cadastro', 1, null, await nonce()))).rows[0].r
  assert.equal(informed.revisao, 2); assert(informed.cadastroInformadoEm); assert.equal(informed.ultimoEventoEm, null)
  assert.equal((await worker('select vortx_autorizar_callback($1,$2) r', [first.id, hash1])).rows[0].r.status, 'AUTHORIZED')
  check('operator_registration_is_not_provider_event_proof_and_does_not_change_secret')
  const eventCount = (await db.query('select count(*)::int n from vortx_relatorio_eventos')).rows[0].n
  const rotated = (await user(mutateSql, args('rotacionar', 2, hash2, await nonce()))).rows[0].r
  assert.equal(rotated.revisao, 3); assert.equal(rotated.id, first.id); assert.equal(rotated.cadastroInformadoEm, null)
  assert.equal((await worker('select vortx_autorizar_callback($1,$2) r', [first.id, hash1])).rows[0].r.status, 'UNAUTHORIZED')
  assert.equal((await worker('select vortx_autorizar_callback($1,$2) r', [first.id, hash2])).rows[0].r.status, 'AUTHORIZED')
  check('rotation_invalidates_old_url_and_clears_registration_indicator')
  const revoked = (await user(mutateSql, args('revogar', 3, null, await nonce()))).rows[0].r
  assert.equal(revoked.ativo, false); assert.equal(revoked.revisao, 4)
  assert.equal((await worker('select vortx_autorizar_callback($1,$2) r', [first.id, hash2])).rows[0].r.status, 'UNAUTHORIZED')
  assert.equal((await db.query('select count(*)::int n from vortx_relatorio_eventos')).rows[0].n, eventCount)
  check('revocation_preserves_all_prior_events')
  const regenerated = (await user(mutateSql, args('gerar', 4, hash1, await nonce()))).rows[0].r
  assert.equal(regenerated.revisao, 5); assert.equal(regenerated.id, first.id); check('regeneration_after_revocation_uses_same_scoped_endpoint')
  await assert.rejects(user(mutateSql, args('rotacionar', 5, hash2, await nonce(), otherFund)), { code: '42501' })
  await db.query("update integracao_fundo_versoes set status='rascunho' where id=$1", [version])
  await assert.rejects(user(mutateSql, args('rotacionar', 5, hash2, await nonce())), { code: '42501' })
  await db.query("update integracao_fundo_versoes set status='publicada' where id=$1", [version])
  check('mutation_revalidates_fund_and_published_version')
  const clients = await Promise.all([1, 2].map(async () => { const c = new pg.Client(config); await c.connect(); return c }))
  const nonces = [await nonce(), await nonce()]
  try {
    const result = await Promise.allSettled(clients.map((c, i) => as('authenticated', mutateSql, args('rotacionar', 5, sha(`qa-concurrent-${i}`), nonces[i]), admin, {}, c)))
    assert.equal(result.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(result.find(r => r.status === 'rejected').reason.code, '40001')
    assert.equal((await user(statusSql, [fund, version])).rows[0].r.revisao, 6)
    assert.equal((await db.query('select count(*)::int n from autorizacoes_acoes_sensiveis where nonce_hash=any($1) and consumida_em is not null', [nonces])).rows[0].n, 1)
  } finally { await Promise.all(clients.map(c => c.end())) }
  check('concurrent_rotation_one_winner_one_consumed_nonce')
  const audits = (await db.query("select ator_usuario_id,dados from seguranca_eventos where tipo_evento='VORTX_CALLBACK_ADMIN_ALTERADO'")).rows
  assert(audits.length >= 6); assert(audits.every(a => a.ator_usuario_id === admin.id))
  assert(!JSON.stringify(audits).includes(hash1)); assert(!JSON.stringify(audits).includes(hash2))
  check('admin_audit_identifies_actor_without_url_secret_or_hash')
}
