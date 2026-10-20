import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const read = name => readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const sha = value => createHash('sha256').update(value).digest('hex')
export async function checkStockCallbackProcessing({ db, config, internal, asRole, payload, fund, otherFund, actor, integration, version, stack }) {
  // Exact table DDL from the canonical migrations; focused worker/RLS rehearsal, not Auth/UI E2E.
  const requests = read('supabase/migrations/20261019180624_vortx_report_requests_preview.sql')
  const inbox = read('supabase/migrations/20261019201346_vortx_report_callback_inbox.sql')
  await db.query(requests.slice(requests.indexOf('CREATE TABLE public.vortx_relatorio_solicitacoes'), requests.indexOf('CREATE INDEX')))
  await db.query(inbox.slice(inbox.indexOf('CREATE TABLE private.vortx_callback_endpoints'), inbox.indexOf('-- Fixed global key')))
  await db.query(inbox.slice(inbox.indexOf('CREATE TABLE public.vortx_relatorio_eventos'), inbox.indexOf('CREATE INDEX vortx_callback_evento_protocolo_idx')))
  await db.query(inbox.slice(inbox.indexOf('CREATE FUNCTION private.vortx_callback_exigir_worker'), inbox.indexOf('-- Administrative server tooling only')))
  await db.query(read('supabase/migrations/20261020192527_vortx_stock_callback_processing.sql'))
  stack.tests.push('callback_processing_forward_migration_on_exact_table_contracts')
  const endpoint = randomUUID(), wallet = 'QA-CARTEIRA'
  await db.query(`insert into private.vortx_callback_endpoints(id,fundo_id,integracao_id,ambiente,codigo_carteira,segredo_hash)
    values($1,$2,$3,'homologacao',$4,$5)`, [endpoint, fund, integration, wallet, sha('synthetic-only')])
  async function event(type, date, { correlated = true, requestId = null } = {}) {
    const id = randomUUID(), protocol = randomUUID(), request = requestId || randomUUID()
    if (!requestId) await db.query(`insert into vortx_relatorio_solicitacoes(id,fundo_id,integracao_versao_id,ambiente,pedido,hash_pedido,estado,protocolo_externo,codigo_http,solicitada_por,session_id,lease_hash)
      values($1,$2,$3,'homologacao',$4,$5,'aceita',$6,201,$7,$8,$9)`,
    [request, fund, version, { tipoRelatorio: type, dataReferencia: date, codigoCarteira: wallet }, sha(id), protocol, actor, randomUUID(), sha(request)])
    const actualProtocol = requestId ? (await db.query('select protocolo_externo from vortx_relatorio_solicitacoes where id=$1', [requestId])).rows[0].protocolo_externo : protocol
    await db.query(`insert into vortx_relatorio_eventos(id,endpoint_id,fundo_id,ambiente,solicitacao_id,protocolo_externo,tipo_relatorio,status_relatorio,
      data_referencia,data_inicio,data_fim,data_expiracao,correlacao,metadados,hash_evento,payload_criptografado,chave_versao)
      values($1,$2,$3,'homologacao',$4,$5,$6,'Disponível',$7,$7,$7,now()+interval '1 day',$8,$9,$10,$11,'synthetic')`,
    [id, endpoint, fund, correlated ? request : null, actualProtocol, type, date, correlated ? 'CORRELACIONADO' : 'PENDENTE',
      { idCarteira: wallet }, sha(id), 'v1:' + 'x'.repeat(50)])
    return { id, request }
  }
  const reserve = () => internal('select vortx_reservar_processamento_estoque($1) r', [fund]).then(r => r.rows[0].r)
  const finish = (job, body, lease = job.lease) => internal('select vortx_concluir_processamento_estoque($1,$2,$3) r', [job.id, lease, body]).then(r => r.rows[0].r)
  await event('PosicaoAtivo', '2026-10-19', { correlated: false })
  await event('PosicaoParcela', '2026-10-19', { correlated: false })
  assert.equal(await reserve(), null); stack.tests.push('orphan_events_never_adopted_or_downloaded')
  const asset = await event('PosicaoAtivo', '2026-10-19')
  await event('PosicaoParcela', '2026-10-18')
  assert.equal(await reserve(), null); stack.tests.push('different_point_dates_never_paired')
  await event('PosicaoParcela', '2026-10-19')
  // Independent authenticated worker connections, not a shared transaction/mock.
  const concurrent = async () => {
    const client = new pg.Client(config); await client.connect()
    try {
      await client.query('begin; set local role service_role')
      await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: 'service_role' })])
      const result = await client.query('select vortx_reservar_processamento_estoque($1) r', [fund])
      await client.query('commit'); return result.rows[0].r
    } finally { await client.end() }
  }
  const claims = await Promise.all([concurrent(), concurrent()])
  assert.equal(claims.filter(Boolean).length, 1)
  const job = claims.find(Boolean)
  stack.tests.push('two_workers_exactly_one_live_lease')
  const body = payload({ date: '2026-10-19', twoCedentes: true, suffix: 'callback' })
  await assert.rejects(finish(job, body, randomUUID()), { code: '42501' })
  await assert.rejects(finish(job, { ...body, fundo_id: otherFund }), { code: '42501' })
  await assert.rejects(finish(job, { ...body, ambiente: 'producao' }), { code: '42501' })
  assert.equal((await db.query('select count(*)::int n from importacoes_financeiras where id=$1', [body.id])).rows[0].n, 0)
  stack.tests.push('lease_fund_environment_tampering_rolls_back_all_rows')
  await db.query('update private.vortx_callback_endpoints set ativo=false where id=$1', [endpoint])
  await assert.rejects(finish(job, body), { code: '42501' })
  await db.query('update private.vortx_callback_endpoints set ativo=true where id=$1', [endpoint])
  await db.query('update integracao_fundo_versao_capacidades set disponivel_ate=now() where integracao_fundo_versao_id=$1', [version])
  await assert.rejects(finish(job, body), { code: '42501' })
  await db.query('update integracao_fundo_versao_capacidades set disponivel_ate=null where integracao_fundo_versao_id=$1', [version])
  stack.tests.push('endpoint_and_capability_revocation_rechecked_at_commit')
  const saved = await finish(job, body)
  assert.equal(saved.reconciliado, true)
  const ledger = (await db.query('select estado,lease,importacao_id from private.vortx_estoque_processamentos where id=$1', [job.id])).rows[0]
  assert.deepEqual(ledger, { estado: 'PERSISTIDO', lease: null, importacao_id: body.id })
  assert.equal((await db.query('select status from importacoes_financeiras where id=$1', [body.id])).rows[0].status, 'VALIDA')
  assert.equal(await reserve(), null)
  stack.tests.push('atomic_ledger_native_rows_audit_no_implicit_publication')
  await assert.rejects(finish(job, body), { code: '42501' })
  assert.equal((await internal('select vortx_falhar_processamento_estoque($1,$2,$3) r', [job.id, job.lease, 'DOWNLOAD_FALHOU'])).rows[0].r, false)
  stack.tests.push('late_worker_cannot_overwrite_committed_success')
  await event('PosicaoAtivo', '2026-10-19', { requestId: asset.request })
  const renewed = await reserve()
  assert(renewed && renewed.id !== job.id)
  const duplicate = await finish(renewed, { ...body, id: randomUUID() })
  assert.equal(duplicate.id, body.id); assert.equal(duplicate.duplicada, true)
  stack.tests.push('renewed_callback_same_file_maps_to_existing_snapshot')
  for (const role of ['anon', 'authenticated']) {
    for (const [sql, args] of [
      ['select vortx_reservar_processamento_estoque($1)', [fund]],
      ['select vortx_concluir_processamento_estoque($1,$2,$3)', [job.id, job.lease, body]],
      ['select vortx_falhar_processamento_estoque($1,$2,$3)', [job.id, job.lease, 'DOWNLOAD_FALHOU']],
      ['select vortx_estagiar_linhas_estoque($1,$2,$3,$4,$5)', [job.id, job.lease, 'ativos', 1, '[]']],
      ['select vortx_reservar_manifesto_estoque($1,$2,$3)', [job.id, job.lease, {}]],
      ['select * from private.vortx_estoque_processamentos', []],
      ['select * from private.vortx_estoque_blocos', []],
    ]) await assert.rejects(asRole(role, sql, args, actor), { code: '42501' })
  }
  stack.tests.push('private_processing_ledger_no_anon_or_authenticated_access')
  await event('PosicaoAtivo', '2026-10-20'); await event('PosicaoParcela', '2026-10-20')
  const expired = await reserve()
  await db.query("update private.vortx_estoque_processamentos set lease_ate=now()-interval '1 second' where id=$1", [expired.id])
  const resumed = await reserve()
  assert.equal(resumed.id, expired.id); assert.notEqual(resumed.lease, expired.lease)
  await assert.rejects(finish(expired, payload({ date: '2026-10-20' })), { code: '42501' })
  assert.equal((await internal('select vortx_falhar_processamento_estoque($1,$2,$3) r', [resumed.id, resumed.lease, 'CONTRATO_INVALIDO'])).rows[0].r, true)
  assert.equal(await reserve(), null)
  stack.tests.push('crashed_lease_resumable_old_worker_fenced_permanent_invalid_contract_not_retried')
  await event('PosicaoAtivo', '2026-10-22'); await event('PosicaoParcela', '2026-10-22')
  const stagedJob = await reserve(), stagedBody = payload({ date: '2026-10-22', suffix: 'staged' })
  const { ativos, parcelas, ...header } = stagedBody
  const manifest = { ...header, processamento_id: stagedJob.id, processamento_lease: stagedJob.lease,
    ativos_total: ativos.length, parcelas_total: parcelas.length }
  await assert.rejects(finish(stagedJob, manifest), { code: '23514' })
  const intent = () => internal('select vortx_reservar_manifesto_estoque($1,$2,$3) r', [stagedJob.id, stagedJob.lease, manifest])
  await assert.rejects(internal('select vortx_reservar_manifesto_estoque($1,$2,$3)', [stagedJob.id, stagedJob.lease,
    { ...manifest, urlRelatorio: 'https://example.invalid/never-store-signed-url' }]), { code: '22023' })
  assert.equal((await intent()).rows[0].r, true); assert.equal((await intent()).rows[0].r, true)
  await assert.rejects(internal('select vortx_reservar_manifesto_estoque($1,$2,$3)', [stagedJob.id, stagedJob.lease, { ...manifest, hash_conteudo: sha('changed') }]), { code: '23514' })
  // pg encodes a top-level JS array as a PostgreSQL array; the RPC contract is JSONB.
  const chunk = (tipo, ordem, linhas, lease = stagedJob.lease) => internal('select vortx_estagiar_linhas_estoque($1,$2,$3,$4,$5) r', [stagedJob.id, lease, tipo, ordem, JSON.stringify(linhas)])
  await assert.rejects(chunk('ativos', 1, ativos, randomUUID()), { code: '42501' })
  assert.equal((await chunk('ativos', 1, ativos)).rows[0].r, ativos.length)
  assert.equal((await chunk('ativos', 1, ativos)).rows[0].r, ativos.length)
  await assert.rejects(chunk('ativos', 1, [{ ...ativos[0], numero_linha: 999 }]), { code: '23514' })
  await assert.rejects(chunk('parcelas', 1, Array.from({ length: 501 }, () => parcelas[0])), { code: '22023' })
  await chunk('parcelas', 2, parcelas)
  await assert.rejects(finish(stagedJob, manifest), { code: '23514' })
  assert.equal((await db.query('select count(*)::int n from importacoes_financeiras where id=$1', [stagedBody.id])).rows[0].n, 0)
  // This is disposable transport staging, not historical callbacks/native data.
  await db.query("delete from private.vortx_estoque_blocos where processamento_id=$1 and tipo='parcelas'", [stagedJob.id])
  await chunk('parcelas', 1, parcelas)
  assert.equal((await finish(stagedJob, manifest)).id, stagedBody.id)
  assert.equal((await db.query('select count(*)::int n from private.vortx_estoque_blocos where processamento_id=$1', [stagedJob.id])).rows[0].n, 0)
  assert.equal((await db.query('select jsonb_array_length(manifestos)::int n from private.vortx_estoque_processamentos where id=$1', [stagedJob.id])).rows[0].n, 1)
  stack.tests.push('bounded_chunks_idempotent_conflicts_and_gaps_denied_atomic_cleanup_intent_preserved')
  // Actual bounded transport followed by one set-based financial transaction.
  const bulk = payload({ date: '2026-10-21', suffix: 'bulk-5000' })
  const base = bulk.parcelas[0]
  bulk.parcelas = Array.from({ length: 5000 }, (_, index) => ({ ...base, numero_linha: index + 2,
    dados_normalizados: { ...base.dados_normalizados, chave_parcela: String(index), external_title_key: sha(`bulk:${index}`) } }))
  for (const [field, value] of [['valor_nominal', '500000.0000'], ['valor_aquisicao', '450000.0000'], ['valor_presente', '455000.0000'], ['valor_pdd', '10000.0000']]) bulk.ativos[0].dados_normalizados[field] = value
  await event('PosicaoAtivo', '2026-10-21'); await event('PosicaoParcela', '2026-10-21')
  const bulkJob = await reserve()
  const { ativos: bulkAssets, parcelas: bulkParcels, ...bulkHeader } = bulk
  const bulkManifest = { ...bulkHeader, processamento_id: bulkJob.id, processamento_lease: bulkJob.lease,
    ativos_total: bulkAssets.length, parcelas_total: bulkParcels.length }
  const start = performance.now()
  await internal('select vortx_reservar_manifesto_estoque($1,$2,$3)', [bulkJob.id, bulkJob.lease, bulkManifest])
  let chunks = 0
  for (const [type, rows] of [['ativos', bulkAssets], ['parcelas', bulkParcels]]) {
    for (let offset = 0; offset < rows.length; offset += 500) {
      await internal('select vortx_estagiar_linhas_estoque($1,$2,$3,$4,$5)',
        [bulkJob.id, bulkJob.lease, type, offset / 500 + 1, JSON.stringify(rows.slice(offset, offset + 500))])
      chunks++
    }
  }
  assert.equal((await finish(bulkJob, bulkManifest)).reconciliado, true)
  assert.equal((await db.query('select count(*)::int n from vortx_posicao_parcelas where importacao_id=$1', [bulk.id])).rows[0].n, 5000)
  stack.bulk = { parcelas: 5000, chunks, normalizedJsonBytes: Buffer.byteLength(JSON.stringify(bulk)),
    manifestBytes: Buffer.byteLength(JSON.stringify(bulkManifest)), durationMs: Math.round(performance.now() - start) }
  stack.tests.push('bulk_5000_rows_bounded_transport_atomic_completion_measured')
  await db.query(read('supabase/migrations/20261020201600_vortx_stock_zip_recovery.sql'))
  for (const role of ['anon', 'authenticated']) await assert.rejects(asRole(role,
    'select vortx_retomar_download_estoque($1,$2)', [fund, randomUUID()], actor), { code: '42501' })
  const recover = (target = fund) => internal('select vortx_retomar_download_estoque($1,$2) r', [target, randomUUID()]).then(r => r.rows[0].r)
  assert.equal(await recover(otherFund), false)
  stack.tests.push('recovery_worker_only_and_no_cross_fund_job_adoption')
  await event('PosicaoAtivo', '2026-10-23'); await event('PosicaoParcela', '2026-10-23')
  const downloadFailure = await reserve()
  await internal('select vortx_falhar_processamento_estoque($1,$2,$3)', [downloadFailure.id, downloadFailure.lease, 'DOWNLOAD_FALHOU'])
  await db.query('update private.vortx_callback_endpoints set ativo=false where id=$1', [endpoint])
  assert.equal(await recover(), false)
  await db.query('update private.vortx_callback_endpoints set ativo=true where id=$1', [endpoint])
  assert.equal(await recover(), true); assert.equal(await recover(), false)
  const audit = (await db.query("select dados from plataforma_auditoria where tipo_evento='VORTX_CALLBACK_ESTOQUE_RETENTATIVA' order by created_at desc limit 1")).rows[0].dados
  assert.equal(audit.processamento_id, downloadFailure.id); assert.equal(audit.erro_anterior, 'DOWNLOAD_FALHOU')
  assert.equal(audit.tentativa_anterior, 1); assert.equal(audit.motivo, 'ZIP_CSV_SUPORTADO')
  const secondAttempt = await reserve(); assert.equal(secondAttempt.id, downloadFailure.id); assert.equal(secondAttempt.tentativas, 2)
  stack.tests.push('explicit_retry_rechecks_current_scope_and_retains_failed_attempt_in_audit')
  await internal('select vortx_falhar_processamento_estoque($1,$2,$3)', [secondAttempt.id, secondAttempt.lease, 'DOWNLOAD_FALHOU'])
  assert.equal(await recover(), true)
  const thirdAttempt = await reserve(); assert.equal(thirdAttempt.tentativas, 3)
  await internal('select vortx_falhar_processamento_estoque($1,$2,$3)', [thirdAttempt.id, thirdAttempt.lease, 'DOWNLOAD_FALHOU'])
  assert.equal(await recover(), false)
  stack.tests.push('explicit_recovery_never_resets_attempt_ceiling_or_retries_permanent_contract_failure')
  await event('PosicaoAtivo', '2026-10-24'); await event('PosicaoParcela', '2026-10-24')
  const intentJob = await reserve(), intentBody = payload({ date: '2026-10-24', suffix: 'recovery-intent' })
  const { ativos: intentAssets, parcelas: intentParcels, ...intentHeader } = intentBody
  await internal('select vortx_reservar_manifesto_estoque($1,$2,$3)', [intentJob.id, intentJob.lease, {
    ...intentHeader, processamento_id: intentJob.id, processamento_lease: intentJob.lease,
    ativos_total: intentAssets.length, parcelas_total: intentParcels.length,
  }])
  await internal('select vortx_falhar_processamento_estoque($1,$2,$3)', [intentJob.id, intentJob.lease, 'DOWNLOAD_FALHOU'])
  assert.equal(await recover(), false)
  stack.tests.push('recovery_refuses_upload_intents_or_possible_financial_side_effects')
  assert.equal((await db.query("select count(*)::int n from pg_indexes where schemaname='private' and indexname=any($1)",
    [['vortx_estoque_processamento_importacao_idx','vortx_estoque_processamento_parcela_idx','vortx_estoque_processamento_versao_idx']])).rows[0].n, 3)
  stack.tests.push('new_processing_foreign_keys_have_covering_indexes')
}
