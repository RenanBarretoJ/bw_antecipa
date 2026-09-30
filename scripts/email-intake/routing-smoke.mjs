import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Real shared importer and Storage; only the transport bytes are controlled QA fixtures.
export async function verifySharedRouting({ db, admin, human, userId, dependencies, importFiscalFile,
  processAttachmentJob, sourceIntegration, reviewFile, missingKeyFile }) {
  const fund = '22000000-0000-4000-8000-000000000001'
  const cedenteA = '23000000-0000-4000-8000-000000000001', linkA = '24000000-0000-4000-8000-000000000001'
  const cedenteB = randomUUID(), linkB = randomUUID(), integration = randomUUID(), message = randomUUID()
  const dates = (await db.query('select current_date::text issued,(current_date+30)::text due')).rows[0]
  // A separate QA policy for the new cedente preserves all earlier validity windows.
  const version = randomUUID(), policy = randomUUID()
  await db.query(`insert into public.politicas_operacionais(id,codigo,nome,status,created_by,fundo_id,padrao)
    select $1,'QA_EMAIL03_DOCS','Politica documental QA','ativa',created_by,fundo_id,false
    from public.politicas_operacionais where id='26000000-0000-4000-8000-000000000001'`, [policy])
  await db.query(`insert into public.politica_operacional_versoes(id,politica_operacional_id,versao,vigente_desde,
    aceite_sacado_obrigatorio,cessao_no_desembolso,cria_acompanhamento_entrega,configuracao,conteudo_hash,
    fundo_id,status,metodo_calculo_financeiro)
    select $1,$2,1,now()-interval '1 minute',aceite_sacado_obrigatorio,cessao_no_desembolso,
    cria_acompanhamento_entrega,configuracao,repeat('b',64),fundo_id,'rascunho',metodo_calculo_financeiro
    from public.politica_operacional_versoes where id='27000000-0000-4000-8000-000000000001'`, [version, policy])
  await db.query(`insert into public.politica_requisitos_documentais(politica_operacional_versao_id,politica_operacional_id,
    fundo_id,codigo,escopo,categoria,momento_obrigatorio,bloqueia_fluxo,tipo_documento_codigo,formatos_aceitos,responsavel_upload,responsavel_aprovacao)
    select id,politica_operacional_id,fundo_id,'QA_XML','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao',true,'nf_xml',ARRAY['xml'],'cedente','gestor'
    from public.politica_operacional_versoes where id=$1`, [version])
  await db.query(`update public.politica_operacional_versoes set status='publicada',publicada_em=now(),
    publicada_por='21000000-0000-4000-8000-000000000004' where id=$1`, [version])
  await db.query(`insert into public.cedentes(id,cnpj,razao_social,status,fundo_id)
    values($1,'11222333000181','CEDENTE B QA SEM VALOR FISCAL','ativo',$2)`, [cedenteB, fund])
  await db.query("insert into public.cedente_fundos(id,cedente_id,fundo_id,status) values($1,$2,$3,'ativo')", [linkB, cedenteB, fund])
  await db.query(`insert into public.cedente_fundo_politicas(cedente_fundo_id,politica_operacional_id,status,vigente_desde,atribuido_por)
    select $1,$3,status,vigente_desde,atribuido_por from public.cedente_fundo_politicas where cedente_fundo_id=$2`, [linkB, linkA, policy])
  await db.query(`insert into private.email_integrations(id,fundo_id,name,provider,mailbox_address,enabled,start_at,
    scope_verified_at,scope_evidence_hash,credential_env_ref,created_by,routing_mode)
    select $1,fundo_id,'Routing QA',provider,mailbox_address,true,start_at,scope_verified_at,
    scope_evidence_hash,credential_env_ref,created_by,'ALL_ACTIVE_CEDENTES' from private.email_integrations where id=$2`, [integration, sourceIntegration])
  await db.query('insert into private.email_intake_messages(id,integration_id,external_id,received_at) values($1,$2,$3,now())', [message, integration, randomUUID()])
  const api = async (name, args) => {
    const result = await admin.rpc(name, args)
    assert.ok(!result.error, `${name}:${result.error?.code ?? 'UNKNOWN'}`)
    return result.data
  }
  let serial = 800
  const xmlFile = (issuer = '98100000000168') => {
    const number = ++serial
    const key = ['35', '2609', issuer, '55', '001', String(number).padStart(9, '0'), '1', '12345678', '9'].join('')
    return new File([`<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${key}">
      <ide><serie>1</serie><nNF>${number}</nNF><dhEmi>${dates.issued}T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>${issuer}</CNPJ><xNome>CEDENTE QA SEM VALOR FISCAL</xNome></emit>
      <dest><CNPJ>88999888000100</CNPJ><xNome>SACADO QA</xNome></dest>
      <total><ICMSTot><vNF>100.00</vNF></ICMSTot></total>
      <cobr><fat><vOrig>100.00</vOrig><vLiq>100.00</vLiq></fat><dup><nDup>001</nDup><dVenc>${dates.due}</dVenc><vDup>100.00</vDup></dup></cobr>
      </infNFe></NFe></nfeProc>`], `routing-${number}.xml`, { type: 'application/xml' })
  }
  const run = async (file, expected, override = {}) => {
    const id = randomUUID()
    await db.query(`insert into private.email_intake_attachments(id,message_id,external_id,file_name,content_type,size_bytes,kind)
      values($1,$2,$3,$4,$5,$6,'FILE')`, [id, message, randomUUID(), file.name, file.type, file.size])
    const claim = (await api('email_intake_claim_attachment', { p_queue: 'TEXT' }))[0]
    assert.equal(claim.id, id)
    const job = await api('email_intake_get_attachment_claim', { p_id: id, p_token: claim.token })
    const originalRpc = admin.rpc
    const errors = []
    admin.rpc = async function (name, args) {
      const response = await originalRpc.call(this, name, args)
      if (response.error) errors.push({ rpc: name, code: response.error.code, message: response.error.message.replace(/\d{14,}/g, '[QA_IDENTIFIER]') })
      return response
    }
    let result
    try {
      result = await processAttachmentJob({ ...job, ...override },
        { downloadAttachment: async () => new Uint8Array(await file.arrayBuffer()) },
        input => importFiscalFile(input, dependencies(admin)))
    } finally { admin.rpc = originalRpc }
    assert.equal(result.status, expected, `ROUTING_IMPORT:${JSON.stringify(errors)}`)
    if (!['IMPORTED', 'REQUIRES_REVIEW'].includes(result.status)) {
      await api('email_intake_settle_attachment', { p_id: id, p_token: claim.token, p_outcome: result.status, p_retry_after_ms: 900000 })
    }
    return result
  }
  const valid = xmlFile()
  const importedA = await run(valid, 'IMPORTED')
  const validB = xmlFile('11222333000181')
  const importedB = await run(validB, 'IMPORTED')
  const original = await api('fiscal_intake_get_original', { p_nf_id: importedB.nfId })
  assert.equal(original.bucket, 'documentos-v2')
  const stored = await admin.storage.from(original.bucket).download(original.path)
  assert.equal(stored.error, null)
  assert.equal(await stored.data.text(), await validB.text())
  const repository = (await db.query(`select count(*)::int n from public.documento_requisito_instancias ri
    join public.documento_versoes v on v.documento_id=ri.documento_id
    where ri.nota_fiscal_id=$1 and v.bucket=$2 and v.path=$3`, [importedB.nfId, original.bucket, original.path])).rows[0]
  assert.equal(repository.n, 1)
  const documentLink = (await db.query(`select id,documento_id from public.documento_requisito_instancias
    where nota_fiscal_id=$1 and documento_id is not null`, [importedB.nfId])).rows[0]
  // A completed import must NOT confer technical-actor authority on legacy writes.
  await db.query('begin')
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: 'service_role' })])
    await db.query('set local role service_role')
    await db.query('update public.documento_requisito_instancias set documento_id=null where id=$1', [documentLink.id])
    await assert.rejects(db.query('update public.documento_requisito_instancias set documento_id=$1 where id=$2',
      [documentLink.documento_id, documentLink.id]), /Usuario sem permissao para reconciliar documentos da NF/)
  } finally { await db.query('rollback') }
  assert.equal((await db.query('select documento_id from public.documento_requisito_instancias where id=$1', [documentLink.id])).rows[0].documento_id, documentLink.documento_id)
  const cedentes = (await db.query('select cedente_id from public.notas_fiscais where id=any($1::uuid[])', [[importedA.nfId, importedB.nfId]])).rows.map(r => r.cedente_id).sort()
  assert.deepEqual(cedentes, [cedenteA, cedenteB].sort())
  await run(valid, 'DUPLICATE')
  await run(reviewFile, 'REQUIRES_REVIEW')
  await run(missingKeyFile, 'MISSING_IDENTITY')
  assert.equal((await importFiscalFile({ actor: { type: 'HUMAN', userId }, fundoId: fund, cedenteFundoId: linkA, file: missingKeyFile }, dependencies(human))).status, 'MISSING_IDENTITY')
  assert.equal((await db.query('select count(*)::int n from public.notas_fiscais where id=any($1::uuid[])', [[importedA.nfId, importedB.nfId]])).rows[0].n, 2)
  const outcomes = (await db.query('select status from private.email_intake_attachments where message_id=$1', [message])).rows.map(r => r.status).sort()
  assert.deepEqual(outcomes, ['IMPORTED', 'IMPORTED', 'DUPLICATE', 'REQUIRES_REVIEW', 'REJECTED'].sort())
  await db.query("update private.email_integrations set routing_mode='ALLOWLIST' where id=$1", [integration])
  await db.query(`insert into private.email_integration_cedentes(integration_id,cedente_id,created_by)
    select id,$2,created_by from private.email_integrations where id=$1`, [integration, cedenteA])
  await run(xmlFile(), 'IMPORTED')
  await run(xmlFile('11222333000181'), 'ROUTING_DENIED')
  await run(xmlFile('88999888000100'), 'UNKNOWN_CEDENTE')
  await run(xmlFile(), 'ROUTING_DENIED', { fundoId: randomUUID() })
  return ['SHARED_DOCUMENT_REPOSITORY_ORIGINAL_API_BYTES_MATCH', 'LEGACY_DOCUMENT_TRIGGER_STILL_REQUIRES_HUMAN',
    'SHARED_ROUTING_ALL_TWO_CEDENTES_ONE_MESSAGE', 'SHARED_PER_FILE_VALID_DUPLICATE_REVIEW_INVALID',
    'MANUAL_EMAIL_PDF_MISSING_KEY_BLOCKED', 'SHARED_ALLOWLIST_ALLOWED_AND_DENIED', 'SHARED_UNKNOWN_CEDENTE_DENIED', 'SHARED_CROSS_FUND_DENIED']
}
