import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

// Called only inside the disposable clean-room, using its real Auth/MFA user.
// Temporarily give that human the consultant role, then restore the browser fixture.
export async function verifyConsultorIntake({ db, admin, human, userId, dependencies, importFiscalFile }) {
  assert.equal(process.env.EMAIL_INTAKE_DISPOSABLE_SMOKE, 'true')
  const fund = '22000000-0000-4000-8000-000000000001'
  const cedente = '23000000-0000-4000-8000-000000000001'
  const link = '24000000-0000-4000-8000-000000000001'
  const organization = '29000000-0000-4000-8000-000000000001'
  const dates = (await db.query('select current_date::text issued,(current_date+30)::text due')).rows[0]
  const checks = []
  let sequence = 940000
  function fixture() {
    const number = String(++sequence)
    const prefix = ['35', '2609', '98100000000168', '55', '001', number.padStart(9, '0'), '1', '12345678'].join('')
    let sum = 0, weight = 2
    for (const digit of [...prefix].reverse()) { sum += Number(digit) * weight; weight = weight === 9 ? 2 : weight + 1 }
    const remainder = sum % 11, key = prefix + String(remainder < 2 ? 0 : 11 - remainder)
    const xml = `<nfeProc><NFe><infNFe Id="NFe${key}">
      <ide><serie>1</serie><nNF>${number}</nNF><dhEmi>${dates.issued}T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>98100000000168</CNPJ><xNome>CEDENTE QA SEM VALOR FISCAL</xNome></emit>
      <dest><CNPJ>11222333000181</CNPJ><xNome>SACADO QA</xNome></dest>
      <total><ICMSTot><vNF>100.00</vNF></ICMSTot></total>
      <cobr><fat><vOrig>100.00</vOrig><vLiq>100.00</vLiq></fat><dup><nDup>001</nDup><dVenc>${dates.due}</dVenc><vDup>100.00</vDup></dup></cobr>
      <infAdic><infCpl>SEM VALOR FISCAL - FIXTURE QA</infCpl></infAdic></infNFe></NFe></nfeProc>`
    return { number, file: new File([xml], `consultor-${number}.xml`, { type: 'application/xml' }) }
  }
  const input = file => ({ actor: { type: 'HUMAN', userId }, fundoId: fund, cedenteFundoId: link, file })
  const helperBefore = (await db.query("select pg_get_functiondef('private.consultor_usuario_pode_operar_cedente(uuid,uuid)'::regprocedure) body")).rows[0].body
  assert.match(helperBefore, /p_user_id\s*=\s*\(\s*SELECT auth.uid\(\)/i)
  const privileges = (await db.query(`select
    has_function_privilege('authenticated','private.fiscal_validate_stored_actor(private.fiscal_identity_reservations)','EXECUTE') human,
    has_function_privilege('anon','private.fiscal_validate_stored_actor(private.fiscal_identity_reservations)','EXECUTE') anon,
    has_function_privilege('service_role','private.fiscal_validate_stored_actor(private.fiscal_identity_reservations)','EXECUTE') service`)).rows[0]
  assert.deepEqual(privileges, { human: false, anon: false, service: false })
  try {
    await db.query("update public.profiles set role='consultor' where id=$1", [userId])
    await db.query("insert into public.consultor_usuarios(consultor_id,user_id,papel,status,ativado_em) values($1,$2,'OPERADOR','ativo',now())", [organization, userId])
    for (const role of ['OWNER', 'ADMIN', 'OPERADOR']) {
      await db.query('update public.consultor_usuarios set papel=$2 where user_id=$1', [userId, role])
      const { file, number } = fixture()
      const result = await importFiscalFile(input(file), dependencies(human))
      assert.equal(result.status, 'IMPORTED', `CONSULTOR_${role}_IMPORT`)
      assert.equal(result.numero, number)
      const audit = (await db.query(`select usuario_id,ator_tipo from public.logs_auditoria
        where entidade_id::text=$1 and origem='fiscal_intake' and tipo_evento='NF_SALVA_RASCUNHO'`, [result.nfId])).rows
      assert.deepEqual(audit, [{ usuario_id: userId, ator_tipo: 'usuario' }])
      const original = await admin.rpc('fiscal_intake_get_original', { p_nf_id: result.nfId })
      assert.ok(!original.error, 'CONSULTOR_ORIGINAL_REFERENCE')
      const downloaded = await admin.storage.from(original.data.bucket).download(original.data.path)
      assert.ok(!downloaded.error, 'CONSULTOR_ORIGINAL_DOWNLOAD')
      assert.deepEqual(Buffer.from(await downloaded.data.arrayBuffer()), Buffer.from(await file.arrayBuffer()))
      assert.equal((await importFiscalFile(input(file), dependencies(human))).status, 'DUPLICATE')
      checks.push(`CONSULTOR_${role}_REAL_AUTH_MFA_IMPORT_DOWNLOAD_DUPLICATE`)
    }
    const negatives = [
      ['READER', "update public.consultor_usuarios set papel='LEITOR' where user_id=$1", "update public.consultor_usuarios set papel='OPERADOR' where user_id=$1", [userId]],
      ['MEMBERSHIP_REVOKED', "update public.consultor_usuarios set status='inativo',desativado_em=now() where user_id=$1", "update public.consultor_usuarios set status='ativo',desativado_em=null where user_id=$1", [userId]],
      ['ORGANIZATION_INACTIVE', "update public.consultores set status='inativo' where id=$1", "update public.consultores set status='ativo' where id=$1", [organization]],
      ['FUND_REVOKED', "update public.consultor_fundos set status='inativo' where consultor_id=$1 and fundo_id=$2", "update public.consultor_fundos set status='ativo' where consultor_id=$1 and fundo_id=$2", [organization, fund]],
      ['CEDENTE_PENDING', "update public.consultor_cedentes set status='pendente' where consultor_id=$1 and cedente_id=$2", "update public.consultor_cedentes set status='ativo' where consultor_id=$1 and cedente_id=$2", [organization, cedente]],
      ['MFA_REVOKED', 'update public.sessoes_elevadas set revogada_em=now() where user_id=$1', 'update public.sessoes_elevadas set revogada_em=null where user_id=$1', [userId]],
    ]
    for (const [name, revoke, restore, parameters] of negatives) {
      const { file } = fixture(), dep = dependencies(human)
      let reserved = false, uploaded = false
      try {
        const result = await importFiscalFile(input(file), {
          ...dep,
          repository: { ...dep.repository, reserve: async (...args) => {
            const claim = await dep.repository.reserve(...args)
            assert.ok('id' in claim, `CONSULTOR_${name}_RESERVE`)
            reserved = true
            await db.query(revoke, parameters)
            return claim
          } },
          storage: { upload: async (...args) => { uploaded = true; await dep.storage.upload(...args) } },
        })
        assert.equal(reserved, true)
        assert.equal(result.status, 'FAILED', `CONSULTOR_${name}_STAGING_DENIED`)
        assert.equal(uploaded, false, `CONSULTOR_${name}_NO_UPLOAD`)
        const hash = createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex')
        const reservation = (await db.query(`select r.state,r.nota_fiscal_id,
          (select count(*)::int from private.fiscal_storage_intents s where s.reservation_id=r.id) intents
          from private.fiscal_identity_reservations r where r.file_sha256=$1`, [hash])).rows[0]
        assert.deepEqual(reservation, { state: 'RELEASED', nota_fiscal_id: null, intents: 0 })
        checks.push(`CONSULTOR_${name}_AFTER_RESERVATION_DENIED_NO_STORAGE`)
      } finally { await db.query(restore, parameters) }
    }
    const helperAfter = (await db.query("select pg_get_functiondef('private.consultor_usuario_pode_operar_cedente(uuid,uuid)'::regprocedure) body")).rows[0].body
    assert.equal(helperAfter, helperBefore)
    checks.push('CONSULTOR_RLS_SESSION_BINDING_UNCHANGED_PRIVATE_VALIDATOR_NOT_CALLABLE')
    return checks
  } finally {
    await db.query('delete from public.consultor_usuarios where user_id=$1', [userId])
    await db.query("update public.profiles set role='cedente' where id=$1", [userId])
  }
}
