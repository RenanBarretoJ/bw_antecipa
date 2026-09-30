import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function verifyFiscalRecovery({ admin, clients, fundId, linkId, establishment, actors, messages, cedenteId, storageFixtures }) {
  const nfId = randomUUID(), attachmentId = randomUUID(), token = randomUUID()
  const fiscalKey = '35260998100000000168' + '8'.repeat(24)
  const dates = (await admin.query('select current_date::text issued,(current_date+30)::text due')).rows[0]
  const values = { tipo_documento_fiscal: 'NFE', numero_nf: 'RECOVERED-XML', chave_acesso: fiscalKey,
    cnpj_emitente: '98100000000168', razao_social_emitente: 'Cedente QA', cnpj_destinatario: '11222333000181',
    razao_social_destinatario: 'Sacado QA', valor_bruto: 100, valor_liquido: 100, data_emissao: dates.issued,
    data_vencimento: dates.due, valor_icms: 0, valor_iss: 0, valor_pis: 0, valor_cofins: 0, valor_ipi: 0 }
  await admin.query(`insert into public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,estabelecimento_id,numero_nf,chave_acesso,
    cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,data_emissao,data_vencimento,status)
    values($1,$2,$3,$4,$5,'LEGACY-INCOMPLETE',$6,'98100000000168','Cedente QA','11222333000181','Sacado QA',100,100,$7,$8,'rascunho')`,
  [nfId, cedenteId, linkId, fundId, establishment, fiscalKey, dates.issued, dates.due])
  const oldFile = { bucket: 'notas-fiscais', path: `qa-recovery-original/${nfId}.pdf` }
  if (storageFixtures) await storageFixtures.put(oldFile)
  else await admin.query('insert into storage.objects(bucket_id,name) values($1,$2)', [oldFile.bucket, oldFile.path])
  await admin.query('update public.notas_fiscais set arquivo_url=$2 where id=$1', [nfId, oldFile.path])
  await admin.query(`insert into private.email_intake_attachments(id,message_id,external_id,file_name,content_type,size_bytes,kind,status,lease_token,lease_expires_at)
    values($1,$2,$3,'recovery.xml','application/xml',100,'FILE','PROCESSING',$4,now()+interval '1 hour')`,
  [attachmentId, messages[0], randomUUID(), token])
  const actor = { ...actors[1], attachmentId, attachmentToken: token }
  const reserveArgs = [actors[0], fundId, linkId, establishment, 'NFE', fiscalKey, 'a'.repeat(64), true]
  await clients[0].query('begin')
  const claim = (await clients[0].query('select public.fiscal_intake_reserve($1,$2,$3,$4,$5,$6,$7,$8) result', reserveArgs)).rows[0].result
  assert.equal(claim.status, 'RESERVED')
  const rival = clients[1].query('select public.fiscal_intake_reserve($1,$2,$3,$4,$5,$6,$7,$8) result', [actor, ...reserveArgs.slice(1)])
  let blocked = false
  for (let attempt = 0; attempt < 40; attempt++) {
    const waits = await admin.query("select 1 from pg_stat_activity where wait_event_type='Lock' and query like 'select public.fiscal_intake_reserve%'")
    if (waits.rowCount) { blocked = true; break }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.ok(blocked)
  await clients[0].query('commit')
  assert.equal((await rival).rows[0].result.status, 'IN_PROGRESS')
  assert.equal((await admin.query('select recovery_nf_id from private.fiscal_identity_reservations where id=$1', [claim.id])).rows[0].recovery_nf_id, nfId)

  const stage = async (reservation, amount) => {
    await clients[1].query('select public.fiscal_intake_stage($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [reservation.id, reservation.token, reservation.generation, values,
        JSON.stringify([{ numero_parcela: 1, valor_nominal: amount, data_vencimento: dates.due }]), 'synthetic.xml', 'application/xml', 100, 'nf_xml'])
    const intent = (await clients[0].query('select public.fiscal_intake_prepare_storage($1,$2,$3) result', [reservation.id, reservation.token, reservation.generation])).rows[0].result
    if (storageFixtures) await storageFixtures.put(intent)
    else await admin.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', [intent.bucket, intent.path, { size: 100 }])
    return intent
  }
  const badIntent = await stage(claim, 50)
  await assert.rejects(clients[0].query('select public.fiscal_intake_commit($1,$2,$3,$4)', [claim.id, claim.token, claim.generation, badIntent.id]))
  assert.equal((await admin.query('select numero_nf from public.notas_fiscais where id=$1', [nfId])).rows[0].numero_nf, 'LEGACY-INCOMPLETE')
  assert.equal((await admin.query('select count(*)::int n from public.nota_fiscal_parcelas where nota_fiscal_id=$1', [nfId])).rows[0].n, 0)
  await clients[1].query('select public.fiscal_intake_abort($1,$2,$3)', [claim.id, claim.token, claim.generation])
  if (storageFixtures) await storageFixtures.remove(badIntent)
  else await admin.query('delete from storage.objects where bucket_id=$1 and name=$2', [badIntent.bucket, badIntent.path])
  const cleanup = (await clients[1].query('select public.fiscal_intake_claim_cleanup($1) result', [claim.id])).rows[0].result
  await clients[1].query('select public.fiscal_intake_settle_cleanup($1,$2,true)', [cleanup.id, cleanup.token])
  const retry = (await clients[0].query('select public.fiscal_intake_reserve($1,$2,$3,$4,$5,$6,$7,$8) result', reserveArgs)).rows[0].result
  assert.equal(retry.generation, claim.generation + 1)
  await assert.rejects(clients[0].query('select public.fiscal_intake_commit($1,$2,$3,$4)',
    [claim.id, claim.token, claim.generation, badIntent.id]), /FISCAL_LEASE_LOST/)
  const intent = await stage(retry, 100)
  const imported = (await clients[0].query('select public.fiscal_intake_commit($1,$2,$3,$4) result', [retry.id, retry.token, retry.generation, intent.id])).rows[0].result
  assert.equal(imported.nfId, nfId)
  assert.equal((await admin.query('select arquivo_url from public.notas_fiscais where id=$1', [nfId])).rows[0].arquivo_url, oldFile.path)
  assert.equal((await admin.query('select count(*)::int n from storage.objects where bucket_id=$1 and name=$2', [oldFile.bucket, oldFile.path])).rows[0].n, 1)
  const original = (await clients[1].query('select public.fiscal_intake_get_original($1) result', [nfId])).rows[0].result
  assert.equal(original.path, intent.path)
  assert.equal((await admin.query('select count(*)::int n from public.notas_fiscais where chave_acesso=$1', [fiscalKey])).rows[0].n, 1)
  assert.equal((await clients[0].query('select public.fiscal_intake_reserve($1,$2,$3,$4,$5,$6,$7,$8) result', reserveArgs)).rows[0].result.status, 'DUPLICATE')
  // Historical records remain immutable even when the NF still says draft.
  for (const history of ['DOCUMENT', 'OPERATION']) {
    const id = randomUUID(), historicalKey = '35260998100000000168' + (history === 'DOCUMENT' ? '61' : '62').repeat(12)
    await admin.query(`insert into public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,estabelecimento_id,numero_nf,chave_acesso,
      cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,data_emissao,data_vencimento,status)
      values($1,$2,$3,$4,$5,'LEGACY-HISTORY',$6,'98100000000168','Cedente QA','11222333000181','Sacado QA',100,100,$7,$8,'rascunho')`,
    [id, cedenteId, linkId, fundId, establishment, historicalKey, dates.issued, dates.due])
    if (history === 'DOCUMENT') {
      const document = randomUUID()
      await admin.query(`insert into public.documentos_repositorio(id,documento_tipo_id,status,criado_por)
        select $1,id,'aprovado',$2 from public.documento_tipos where codigo='nf_xml'`, [document, actors[0].userId])
      await admin.query(`insert into public.documento_versoes(documento_id,numero_versao,bucket,path,nome_original,mime_type,tamanho_bytes,sha256,status,enviado_por)
        values($1,1,'documentos-v2',$2,'history.xml','application/xml',100,repeat('d',64),'aprovado',$3)`, [document, `qa-history/${id}.xml`, actors[0].userId])
      await admin.query('insert into public.documento_vinculos(documento_id,nota_fiscal_id,cedente_id) values($1,$2,$3)', [document, id, cedenteId])
    } else {
      const operation = randomUUID()
      await admin.query(`insert into public.operacoes(id,cedente_id,cedente_fundo_id,politica_operacional_id,politica_operacional_versao_id,
        politica_atribuicao_id,politica_versao,politica_snapshot,politica_snapshot_hash,contexto_configuracao_status,contexto_capturado_em,
        aceite_sacado_exigido,aceite_sacado_status,valor_bruto_total,taxa_desconto,prazo_dias,data_vencimento,status,valor_liquido_desembolso)
        values($1,$2,$3,'26000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001',
        '28000000-0000-4000-8000-000000000001',1,'{"calculo_financeiro":{"metodo":"TRINTA_360","versao_motor":2}}',repeat('a',64),'completo',now(),false,'dispensado',100,0,30,$4,'cancelada',100)`,
      [operation, cedenteId, linkId, dates.due])
      await admin.query('insert into public.operacoes_nfs(operacao_id,nota_fiscal_id) values($1,$2)', [operation, id])
    }
    const snapshot = (await admin.query('select to_jsonb(n) snapshot from public.notas_fiscais n where id=$1', [id])).rows[0].snapshot
    const denied = (await clients[0].query('select public.fiscal_intake_reserve($1,$2,$3,$4,$5,$6,$7,$8) result',
      [actors[0], fundId, linkId, establishment, 'NFE', historicalKey, 'a'.repeat(64), true])).rows[0].result
    assert.equal(denied.status, 'DUPLICATE')
    assert.deepEqual((await admin.query('select to_jsonb(n) snapshot from public.notas_fiscais n where id=$1', [id])).rows[0].snapshot, snapshot)
  }
  return ['XML_RECOVERY_REAL_CONCURRENCY', 'XML_RECOVERY_PRESERVES_NF_ID', 'PARCEL_FAILURE_ATOMIC_ROLLBACK',
    'RECOVERY_RETRY_AFTER_CONFIRMED_CLEANUP', 'XML_RECOVERY_STALE_COMMIT_DENIED', 'XML_RECOVERY_OLD_FILE_PRESERVED_NEW_XML_RESOLVED',
    'XML_RECOVERY_DOCUMENT_HISTORY_DENIED', 'XML_RECOVERY_CANCELLED_OPERATION_HISTORY_DENIED']
}
