import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import pg from 'pg'

export async function runReportRevisionChecks({ db, config, user, as, worker, endpoint, admin, ordinary, cross, unbound, fund, version, check }) {
  const sha = value => createHash('sha256').update(value).digest('hex')
  const initial = 'select admin_reservar_relatorio_vortx($1,$2,$3,$4,$5,$6,2,$7,$8) r'
  const repeat = 'select admin_ressolicitar_relatorio_vortx($1,$2,$3,$4,$5,$6,2,$7,$8,$9) r'
  const params = [fund, version, 'PosicaoAtivo', '2020-01-01', '2020-01-02', '2020-01-02']
  async function nonce(a = admin) {
    const hash = sha(randomUUID())
    await db.query("insert into autorizacoes_acoes_sensiveis values($1,$2,$3,'testar_conexao_vortx_vrs',$4,null,null,now()+interval '2 minutes')", [randomUUID(), a.id, a.session, hash])
    return hash
  }
  async function reserve(parent = null, { actor = admin, changes = {}, role = 'authenticated', claims = {}, client = db, token = null } = {}) {
    const values = [...params]; for (const [index, value] of Object.entries(changes)) values[Number(index)] = value
    const lease = sha(randomUUID()), hash = token ?? await nonce(actor)
    values.push(hash, sha(lease)); if (parent) values.push(parent)
    const result = (await as(role, parent ? repeat : initial, values, actor, claims, client)).rows[0].r
    return { ...result, lease, nonce: hash }
  }
  async function finish(result, state = 'aceita') {
    await user('select admin_transicionar_relatorio_vortx($1,$2,$3)', [result.solicitacao.id, result.lease, 'enviando'])
    await user('select admin_transicionar_relatorio_vortx($1,$2,$3,$4,$5)', [result.solicitacao.id, result.lease, state, state === 'aceita' ? randomUUID() : null, state === 'recusada' ? 422 : 200])
  }
  const first = await reserve(); assert.equal(first.criada, true); assert.equal(first.solicitacao.revisao, 1)
  const initialDuplicate = await reserve(); assert.equal(initialDuplicate.criada, false); assert.equal(initialDuplicate.solicitacao.id, first.solicitacao.id)
  check('revisions_keep_initial_request_idempotent')
  await assert.rejects(reserve(first.solicitacao.id), { code: '23514' })
  await user('select admin_transicionar_relatorio_vortx($1,$2,$3)', [first.solicitacao.id, first.lease, 'enviando'])
  await assert.rejects(reserve(first.solicitacao.id), { code: '23514' })
  await user('select admin_transicionar_relatorio_vortx($1,$2,$3,$4,201)', [first.solicitacao.id, first.lease, 'aceita', randomUUID()])
  check('revisions_deny_registered_and_sending_predecessor')
  const old = (await db.query('select to_jsonb(s) row from vortx_relatorio_solicitacoes s where id=$1', [first.solicitacao.id])).rows[0].row
  const second = await reserve(first.solicitacao.id)
  assert.equal(second.criada, true); assert.equal(second.solicitacao.revisao, 2)
  assert.equal(second.solicitacao.solicitacao_anterior_id, first.solicitacao.id)
  assert.deepEqual((await db.query('select to_jsonb(s) row from vortx_relatorio_solicitacoes s where id=$1', [first.solicitacao.id])).rows[0].row, old)
  assert.equal(second.solicitacao.hash_pedido, first.solicitacao.hash_pedido)
  assert(!('lease_hash' in second.solicitacao)); assert(!('session_id' in second.solicitacao))
  check('revisions_create_linked_successor_without_rewriting_original_or_content_identity')
  const duplicate = await reserve(first.solicitacao.id)
  assert.equal(duplicate.criada, false); assert.equal(duplicate.solicitacao.id, second.solicitacao.id)
  const latest = await reserve(); assert.equal(latest.criada, false); assert.equal(latest.solicitacao.id, second.solicitacao.id)
  check('revisions_same_parent_retry_and_regular_form_return_existing_latest_without_resend')
  await assert.rejects(reserve(first.solicitacao.id, { token: second.nonce }), { code: '42501' })
  check('revisions_replayed_mfa_nonce_denied')
  for (const a of [ordinary, cross, unbound]) await assert.rejects(reserve(first.solicitacao.id, { actor: a }), { code: '42501' })
  for (const role of ['anon', 'service_role']) await assert.rejects(reserve(first.solicitacao.id, { role }), { code: '42501' })
  await assert.rejects(reserve(first.solicitacao.id, { claims: { aal: 'aal1' } }), { code: '42501' })
  check('revisions_deny_non_admin_other_fund_unbound_anon_machine_and_aal1')
  for (const changes of [{ 0: randomUUID() }, { 1: randomUUID() }, { 2: 'PosicaoParcela' }, { 5: '2020-01-03' }]) {
    await assert.rejects(reserve(first.solicitacao.id, { changes }), { code: '42501' })
  }
  await assert.rejects(reserve(randomUUID()), { code: '42501' })
  check('revisions_deny_wrong_fund_version_type_date_and_unknown_predecessor')
  const unused = await nonce()
  await assert.rejects(reserve(first.solicitacao.id, { token: unused, changes: { 5: '2020-01-03' } }), { code: '42501' })
  assert.equal((await db.query('select consumida_em from autorizacoes_acoes_sensiveis where nonce_hash=$1', [unused])).rows[0].consumida_em, null)
  check('revisions_invalid_scope_rolls_back_without_consuming_nonce')
  await db.query('update sessoes_elevadas set revogada_em=now() where user_id=$1', [admin.id])
  await assert.rejects(reserve(first.solicitacao.id), { code: '42501' })
  await db.query('update sessoes_elevadas set revogada_em=null where user_id=$1', [admin.id])
  check('revisions_revoked_elevated_session_denied')
  await finish(second, 'indeterminada')
  const clients = [new pg.Client(config), new pg.Client(config)]; await Promise.all(clients.map(c => c.connect()))
  let results
  try { results = await Promise.all(clients.map(client => reserve(second.solicitacao.id, { client }))) }
  finally { await Promise.all(clients.map(c => c.end())) }
  assert.equal(results.filter(r => r.criada).length, 1)
  assert.equal(new Set(results.map(r => r.solicitacao.id)).size, 1)
  const third = results.find(r => r.criada)
  assert.equal(third.solicitacao.revisao, 3)
  check('revisions_concurrent_confirmations_create_exactly_one_successor')
  await finish(third, 'recusada')
  const fourth = await reserve(third.solicitacao.id)
  await user('select admin_transicionar_relatorio_vortx($1,$2,$3)', [fourth.solicitacao.id, fourth.lease, 'falha_autenticacao'])
  const fifth = await reserve(fourth.solicitacao.id)
  assert.equal(fifth.solicitacao.revisao, 5)
  check('revisions_allow_explicit_indeterminate_refused_and_not_sent_with_history_retained')
  const replayOld = await reserve(first.solicitacao.id)
  assert.equal(replayOld.criada, false); assert.equal(replayOld.solicitacao.id, second.solicitacao.id)
  assert.equal((await reserve()).solicitacao.id, fifth.solicitacao.id)
  check('revisions_stale_parent_retry_cannot_fork_or_create_unrequested_generation')
  const listed = (await user('select admin_listar_relatorios_vortx($1) r', [fund])).rows[0].r
  assert(listed.solicitacoes.some(s => s.id === fifth.solicitacao.id && s.revisao === 5 && s.solicitacao_anterior_id === fourth.solicitacao.id))
  assert.equal((await as('authenticated', 'select id from vortx_relatorio_solicitacoes where fundo_id=$1', [fund], cross)).rowCount, 0)
  await assert.rejects(user('delete from vortx_relatorio_solicitacoes where id=$1', [first.solicitacao.id]), { code: '42501' })
  await assert.rejects(user('update vortx_relatorio_solicitacoes set revisao=99 where id=$1', [first.solicitacao.id]), { code: '42501' })
  check('revisions_history_lists_lineage_under_rls_no_direct_delete_or_write')
  const audits = (await db.query("select dados from seguranca_eventos where origem='vortx_relatorios' and dados->>'etapa'='RESSOLICITADA' and dados->>'fundo_id'=$1", [fund])).rows
  assert.equal(audits.length, 4)
  assert(audits.some(a => a.dados.estado_anterior === 'indeterminada'))
  check('revisions_one_audit_per_new_generation_includes_previous_state')
  await finish(fifth)
  const endpointState = (await db.query('select revisao,segredo_hash,codigo_carteira from private.vortx_callback_endpoints where id=$1', [endpoint])).rows[0]
  const receive = async requestId => {
    const source = (await db.query('select * from vortx_relatorio_solicitacoes where id=$1', [requestId])).rows[0]
    const meta = { idRelatorio: source.protocolo_externo, idCarteira: endpointState.codigo_carteira,
      tipoRelatorio: 'PosicaoAtivo', statusRelatorio: 'Disponível', dataReferencia: params[5], dataInicio: params[3], dataFim: params[4],
      dataExpiracao: new Date(Date.now() + 86400000).toISOString(), urlHash: sha('https://example.invalid/synthetic.csv') }
    const digest = sha(['VORTX_RELATORIO_CALLBACK_V1', endpoint, meta.idRelatorio, meta.idCarteira, meta.tipoRelatorio,
      meta.statusRelatorio, meta.dataReferencia, meta.dataInicio, meta.dataFim, meta.dataExpiracao, meta.urlHash].join('|'))
    await worker('select vortx_receber_callback($1,$2,$3,$4,$5,$6,$7)',
      [endpoint, endpointState.segredo_hash, endpointState.revisao, meta, digest, 'v1:' + 'x'.repeat(50), 'synthetic'])
    return (await db.query('select solicitacao_id,correlacao from vortx_relatorio_eventos where hash_evento=$1', [digest])).rows[0]
  }
  assert.deepEqual(await receive(first.solicitacao.id), { solicitacao_id: first.solicitacao.id, correlacao: 'CORRELACIONADO' })
  assert.deepEqual(await receive(fifth.solicitacao.id), { solicitacao_id: fifth.solicitacao.id, correlacao: 'CORRELACIONADO' })
  check('revisions_old_and_new_protocol_callbacks_bind_their_exact_request_without_history_reassignment')
}
