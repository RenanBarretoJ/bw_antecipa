import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'

export async function runCallbackSemanticsChecks({ db, worker, admin, check }) {
  const sha = value => createHash('sha256').update(value).digest('hex')
  const fund = randomUUID(), otherFund = randomUUID(), integration = randomUUID(), otherIntegration = randomUUID()
  const version = randomUUID(), otherVersion = randomUUID(), wallet = `qa-semantic-${randomUUID()}`
  const hash = sha(randomUUID())
  await db.query('insert into fundos values($1,true),($2,true)', [fund, otherFund])
  await db.query("insert into integracoes_fundo values($1,$2,'ativa','VORTX'),($3,$2,'ativa','VORTX')", [integration, fund, otherIntegration])
  for (const [v, i] of [[version, integration], [otherVersion, otherIntegration]]) {
    await db.query("insert into integracao_fundo_versoes values($1,$2,'producao','publicada','vortx_vrs',$3)", [v, i, { codigo_carteira: wallet }])
  }
  const endpoint = (await worker('select vortx_configurar_callback($1,$2,$3) as r', [fund, version, hash])).rows[0].r.id
  async function scenario(name, type, patch = {}, requestPatch = {}, expected = 'CORRELACIONADO') {
    const id = randomUUID(), protocol = randomUUID()
    const pedido = { codigoCarteira: wallet, tipoRelatorio: type, dataInicio: '2026-10-01', dataFim: '2026-10-19',
      dataReferencia: '2026-10-19', extensaoArquivo: 2, ...requestPatch.pedido }
    await db.query(`insert into vortx_relatorio_solicitacoes(id,fundo_id,integracao_versao_id,ambiente,pedido,hash_pedido,
      estado,protocolo_externo,codigo_http,solicitada_por,session_id,lease_hash)
      values($1,$2,$3,$4,$5,$6,'aceita',$7,201,$8,$9,$10)`,
    [id, requestPatch.fund ?? fund, requestPatch.version ?? version, requestPatch.environment ?? 'producao', pedido, sha(id), protocol, admin.id, admin.session, sha(protocol)])
    const meta = { idRelatorio: protocol, idCarteira: wallet, tipoRelatorio: type, statusRelatorio: 'Disponível',
      dataReferencia: '2026-10-19', dataInicio: '2026-10-01', dataFim: '2026-10-19', dataExpiracao: '2026-10-22T17:55:36.000Z', urlHash: sha('synthetic-url'), ...patch }
    const digest = sha(['VORTX_RELATORIO_CALLBACK_V1', endpoint, meta.idRelatorio, meta.idCarteira, meta.tipoRelatorio,
      meta.statusRelatorio, meta.dataReferencia, meta.dataInicio, meta.dataFim, meta.dataExpiracao ?? '', meta.urlHash ?? ''].join('|'))
    const args = [endpoint, hash, 1, meta, digest, 'v1:synthetic-only-not-cryptographic-proof', 'qa']
    await worker('select vortx_receber_callback($1,$2,$3,$4,$5,$6,$7)', args)
    const actual = (await db.query('select correlacao,solicitacao_id from vortx_relatorio_eventos where endpoint_id=$1 and hash_evento=$2', [endpoint, digest])).rows[0]
    assert.deepEqual(actual, { correlacao: expected, solicitacao_id: expected === 'CORRELACIONADO' ? id : null })
    check(name)
  }
  await scenario('semantic_position_asset_uses_reference_only', 'PosicaoAtivo', { dataInicio: '2026-10-19', dataFim: '2026-10-19' })
  await scenario('semantic_position_installment_ignores_provider_sentinel_range', 'PosicaoParcela', { dataInicio: '1900-01-01', dataFim: '1900-01-01' })
  await scenario('semantic_position_wrong_reference_stays_conflicting', 'PosicaoParcela', { dataReferencia: '2026-10-18' }, {}, 'CONFLITANTE')
  await scenario('semantic_inclusion_requires_period_not_position_reference', 'Inclusao', { dataReferencia: '1900-01-01' })
  await scenario('semantic_exclusion_requires_period_not_position_reference', 'Exclusao', {}, { pedido: { dataReferencia: '2026-10-18' } })
  await scenario('semantic_inclusion_wrong_start_stays_conflicting', 'Inclusao', { dataInicio: '2026-10-02' }, {}, 'CONFLITANTE')
  await scenario('semantic_exclusion_wrong_end_stays_conflicting', 'Exclusao', { dataFim: '2026-10-18' }, {}, 'CONFLITANTE')
  await scenario('semantic_cross_fund_never_binds', 'PosicaoAtivo', {}, { fund: otherFund }, 'CONFLITANTE')
  await scenario('semantic_cross_integration_never_binds', 'PosicaoParcela', {}, { version: otherVersion }, 'CONFLITANTE')
  await scenario('semantic_other_environment_remains_pending', 'Inclusao', {}, { environment: 'homologacao' }, 'PENDENTE')
  await scenario('semantic_wrong_report_type_stays_conflicting', 'Inclusao', { tipoRelatorio: 'Exclusao' }, {}, 'CONFLITANTE')
}
