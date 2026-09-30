import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Controlled XML fixtures exercise the official parser passed by the caller.
// This module never parses XML or provides an alternative fiscal identity.
export async function verifySharedConcurrency({ db, admin, human, userId, dependencies, importFiscalFile, processAttachmentJob, sourceIntegration }) {
  const fund = '22000000-0000-4000-8000-000000000001', link = '24000000-0000-4000-8000-000000000001'
  const dates = (await db.query('select current_date::text issued,(current_date+30)::text due')).rows[0]
  const integrations = [randomUUID(), randomUUID()], messages = [randomUUID(), randomUUID()]
  const checks = []
  for (let i = 0; i < 2; i++) {
    await db.query(`insert into private.email_integrations(id,fundo_id,name,provider,mailbox_address,enabled,start_at,
      scope_verified_at,scope_evidence_hash,credential_env_ref,created_by,routing_mode)
      select $1,fundo_id,'Cross channel QA',provider,mailbox_address,true,start_at,scope_verified_at,
      scope_evidence_hash,credential_env_ref,created_by,'ALL_ACTIVE_CEDENTES' from private.email_integrations where id=$2`, [integrations[i], sourceIntegration])
    await db.query('insert into private.email_intake_messages(id,integration_id,external_id,received_at) values($1,$2,$3,now())', [messages[i], integrations[i], randomUUID()])
  }
  const api = async (name, args) => {
    const result = await admin.rpc(name, args)
    assert.ok(!result.error, `${name}:${result.error?.code ?? 'UNKNOWN'}`)
    return result.data
  }
  async function emailInput(file, index) {
    const id = randomUUID()
    await db.query(`insert into private.email_intake_attachments(id,message_id,external_id,file_name,content_type,size_bytes,kind)
      values($1,$2,$3,$4,'application/xml',$5,'FILE')`, [id, messages[index], randomUUID(), file.name, file.size])
    const claim = (await api('email_intake_claim_attachment', { p_queue: 'TEXT' }))[0]
    assert.equal(claim.id, id)
    const job = await api('email_intake_get_attachment_claim', { p_id: id, p_token: claim.token })
    return { job, run: dep => processAttachmentJob(job, { downloadAttachment: async () => new Uint8Array(await file.arrayBuffer()) }, input => importFiscalFile(input, dep)) }
  }
  let sequence = 700
  for (const [winner, loser] of [['MANUAL', 'EMAIL_A'], ['EMAIL_A', 'MANUAL'], ['EMAIL_A', 'EMAIL_B']]) {
    const number = ++sequence
    const key = ['35', '2609', '98100000000168', '55', '001', String(number).padStart(9, '0'), '1', '12345678', '9'].join('')
    const xml = `<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe><infNFe Id="NFe${key}">
      <ide><serie>1</serie><nNF>${number}</nNF><dhEmi>${dates.issued}T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>98100000000168</CNPJ><xNome>CEDENTE QA SEM VALOR FISCAL</xNome></emit>
      <dest><CNPJ>11222333000181</CNPJ><xNome>SACADO QA</xNome></dest>
      <total><ICMSTot><vNF>100.00</vNF></ICMSTot></total>
      <cobr><fat><vOrig>100.00</vOrig><vLiq>100.00</vLiq></fat><dup><nDup>001</nDup><dVenc>${dates.due}</dVenc><vDup>100.00</vDup></dup></cobr>
      <infAdic><infCpl>SEM VALOR FISCAL - FIXTURE QA</infCpl></infAdic></infNFe></NFe></nfeProc>`
    const file = new File([xml], `cross-channel-${number}.xml`, { type: 'application/xml' })
    const mailA = await emailInput(file, 0)
    const mailB = loser === 'EMAIL_B' ? await emailInput(file, 1) : null
    const run = (channel, dep) => channel === 'MANUAL'
      ? importFiscalFile({ actor: { type: 'HUMAN', userId }, fundoId: fund, cedenteFundoId: link, file }, dep)
      : (channel === 'EMAIL_A' ? mailA : mailB).run(dep)
    let signal, release
    const reachedStorage = new Promise(resolve => { signal = resolve })
    const continueUpload = new Promise(resolve => { release = resolve })
    const dep = dependencies(winner === 'MANUAL' ? human : admin)
    const winning = run(winner, { ...dep, storage: { upload: async (intent, original) => {
      signal(); await continueUpload; return dep.storage.upload(intent, original)
    } } })
    try {
      await Promise.race([reachedStorage, winning.then(result => { throw new Error(`WINNER_DID_NOT_REACH_STORAGE:${result.status}`) })])
      const lost = await run(loser, dependencies(loser === 'MANUAL' ? human : admin))
      assert.equal(lost.status, 'IN_PROGRESS')
      if (loser !== 'MANUAL') {
        const job = (loser === 'EMAIL_A' ? mailA : mailB).job
        await api('email_intake_settle_attachment', { p_id: job.id, p_token: job.token, p_outcome: lost.status, p_retry_after_ms: 900000 })
      }
    } finally { release() }
    const imported = await winning
    assert.equal(imported.status, 'IMPORTED')
    const row = (await db.query(`select count(*)::int n,min(fiscal_reservation_id::text) reservation from public.notas_fiscais where chave_acesso=$1`, [key])).rows[0]
    assert.equal(row.n, 1)
    assert.equal((await db.query('select count(*)::int n from storage.objects where name like $1', [`${row.reservation}/%`])).rows[0].n, 1)
    checks.push(`SHARED_CONCURRENT_${winner}_WINNER_${loser}_LOSER_ONE_NF_ONE_OBJECT`)
  }
  return checks
}
