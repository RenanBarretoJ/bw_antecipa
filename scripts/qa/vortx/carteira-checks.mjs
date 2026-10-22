import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const path = 'supabase/migrations/20261022121028_vortx_carteira_atomic_persistence.sql'
const q = value => `'${String(value).replaceAll("'", "''")}'`
const json = value => `${q(JSON.stringify(value))}::jsonb`
const fund = '22000000-0000-4000-8000-000000000003', user = '21000000-0000-4000-8000-000000000003'
const cnpj = '98000000000196', date = '2026-10-20'
const roster = { versao: 1, cotas: ['SR', 'MZ', 'SUB'].map(codigoCarteira => ({ codigoCarteira, rotulo: codigoCarteira })) }
const original = [{ carteiras: ['SR', 'MZ', 'SUB'].map((carteira, index) => ({ carteira, cnpjFundo: cnpj, dataAtual: `${date}T03:00:00.000Z`, status: 'Ativa', pl: [12021826.39, 13532225.29, 4438232.36][index] })), ativos: [{ plTotal: 999999999 }], passivos: [{ plTotal: -999 }] }]

/** New empty native Docker DB only, invoked by the ownership-checked native runner. */
export async function rehearseCarteira(sql, phase, checkpoint, nativeStorageProof) {
  const report = { result: 'IN_PROGRESS', checks: [], syntheticOnly: true, remoteCalls: false,
    storageProof: 'SQL_METADATA_CONTRACT_ONLY_NOT_HTTP_UPLOAD_E2E', migrationHistoryWritten: false }
  const check = async (name, work) => { await phase(`CARTEIRA_${name}`); await work(); report.checks.push({ name, result: 'PASS' }); await checkpoint(report) }
  const scalar = async statement => (await sql(statement)).split('\n').at(-1)
  const machine = async statement => JSON.parse((await sql(`BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',true); ${statement}; COMMIT;`)).split('\n').filter(line => line.startsWith('{')).at(-1))
  const reject = async (statement, pattern) => { await assert.rejects(() => sql(statement), pattern) }
  const asActor = (role, id, statement) => `BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claims',${json({ role, sub: id })}::text,true); ${statement}; COMMIT;`
  const asMachine = statement => asActor('service_role', user, statement)
  const source = await readFile(path, 'utf8')
  report.migration = { path, sha256: createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex') }
  const existing = JSON.parse(await scalar(`SELECT json_build_object(
    'tables',(SELECT array_agg(c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','auth','storage') AND c.relkind IN ('r','p')),
    'functions',(SELECT array_agg(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','auth','storage')),
    'policies',(SELECT array_agg(oid) FROM pg_policy));`))
  const preserved = `SELECT md5(jsonb_build_object(
    'tables',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl) ORDER BY c.oid) FROM pg_class c WHERE c.oid=ANY(ARRAY[${existing.tables}]::oid[])),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.oid=ANY(ARRAY[${existing.policies}]::oid[])),
    'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,CASE WHEN p.oid='private.integracao_adapter_capability_suportada(text,text)'::regprocedure THEN NULL ELSE p.prosrc END,p.proacl,p.proowner,p.prosecdef,p.proconfig) ORDER BY p.oid) FROM pg_proc p WHERE p.oid=ANY(ARRAY[${existing.functions}]::oid[])))::text);`
  const before = await scalar(preserved)
  await check('DDL_ROLLBACK', async () => {
    assert.match(source, /COMMIT;\s*$/)
    // Explicit transaction-outcome variation; source file and historical bytes unchanged.
    await sql(source.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await scalar("SELECT to_regclass('public.vortx_carteira_cotas') IS NULL;"), 't')
    assert.equal(await scalar(preserved), before)
  })
  await check('INCREMENTAL_MIGRATION_AND_PRESERVATION', async () => {
    await sql(source)
    assert.equal(await scalar(preserved), before)
    report.preexistingSecurityHash = before
    report.catalogExtension = 'VORTX_CARTEIRA_ONLY_EXISTING_FUNCTION_ACL_UNCHANGED'
    assert.equal(await scalar("SELECT private.integracao_adapter_capability_suportada('vortx_vrs','CARTEIRA') AND NOT private.integracao_adapter_capability_suportada('sinqia_portal_fidc','CARTEIRA');"), 't')
  })
  const integration = randomUUID(), version = randomUUID(), credential = randomUUID()
  await check('SYNTHETIC_PUBLISHED_CONTEXT', async () => {
    await sql(`INSERT INTO public.integracoes_fundo(id,fundo_id,provedor,provider_key,system_name,nome,status,created_by)
      VALUES(${q(integration)},${q(fund)},'custom','VORTX','QA VRS','QA Carteira','ativa',${q(user)});
      INSERT INTO public.integracao_fundo_versoes(id,integracao_fundo_id,versao,ambiente,status,identificador_cliente,endpoint_base,credential_ref,adapter_key,configuracao_nao_sensivel,vigente_desde)
      VALUES(${q(version)},${q(integration)},1,'producao','rascunho','','','nao_configurada','vortx_vrs',${json({ codigo_carteira: 'QA-VRS', carteira_consolidada: roster })},now()-interval '1 day');
      INSERT INTO public.integracao_fundo_versao_capacidades(integracao_fundo_versao_id,fundo_id,ambiente,capability,disponivel_desde)
      VALUES(${q(version)},${q(fund)},'producao','CARTEIRA',now()-interval '1 hour');
      UPDATE public.integracao_fundo_versoes SET status='publicada',publicada_por=${q(user)},publicada_em=now()-interval '1 hour' WHERE id=${q(version)};
      INSERT INTO public.integracoes_vortx_vrs_credenciais(id,fundo_id,ambiente,base_url,key_criptografada,secret_criptografada,certificado_criptografado,chave_privada_criptografada,chave_versao,criada_por)
      VALUES(${q(credential)},${q(fund)},'producao','https://api.vortx.com.br','v1:QA:QA:QA','v1:QA:QA:QA','v1:QA:QA:QA','v1:QA:QA:QA','qa',${q(user)});`)
  })
  const reserve = async () => machine(`SELECT public.vortx_reservar_carteira(${q(fund)},${q(version)},${q(date)},repeat('a',64),123)`)
  const file = async job => sql(`INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('vortx-carteiras',${q(job.storage_path)},'{"size":123,"mimetype":"application/json"}');`)
  const conclude = (job, response = original) => `SELECT public.vortx_concluir_carteira(${q(job.id)},${q(job.lease)},${json(response)})`
  const fence = job => machine(`SELECT public.vortx_encerrar_carteira(${q(job.id)},${q(job.lease)})`)
  const financialHash = () => scalar(`SELECT md5(jsonb_build_object(
    'headers',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.importacoes_financeiras i WHERE fundo_id=${q(fund)}),
    'cotas',(SELECT jsonb_agg(to_jsonb(c) ORDER BY importacao_id,codigo_cota) FROM public.vortx_carteira_cotas c WHERE fundo_id=${q(fund)}),
    'snapshots',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.carteira_snapshots s WHERE fundo_id=${q(fund)}))::text);`)
  await check('COMPLETE_ATOMIC_PUBLICATION', async () => {
    const job = await reserve(); await file(job)
    const result = await machine(conclude(job)); assert.equal(result.estado, 'PERSISTIDA')
    report.firstImportId = result.id
    assert.equal(await scalar(`SELECT patrimonio_liquido::text FROM public.carteira_snapshots WHERE importacao_id=${q(result.id)} AND vigente;`), '29992284.0400')
    assert.equal(await scalar(`SELECT count(*)||':'||sum(patrimonio_liquido)::text FROM public.vortx_carteira_cotas WHERE importacao_id=${q(result.id)};`), '3:29992284.0400')
    assert.equal(await scalar(`SELECT status FROM public.importacoes_financeiras WHERE id=${q(result.id)};`), 'PUBLICADA')
    assert.deepEqual(await fence(job), { estado: 'PERSISTIDA', id: result.id, podeRemoverArquivo: false })
    assert.equal((await machine(conclude(job))).id, result.id)
  })
  const invalidCases = [
    ['MISSING_QUOTA', [{ carteiras: original[0].carteiras.slice(0, 2) }]],
    ['DUPLICATE_QUOTA', [{ carteiras: [original[0].carteiras[0], original[0].carteiras[0], original[0].carteiras[2]] }]],
    ['UNKNOWN_QUOTA', [{ carteiras: original[0].carteiras.map(h => ({ ...h, carteira: h.carteira === 'SUB' ? 'UNKNOWN' : h.carteira })) }]],
    ['WRONG_FUND', [{ carteiras: original[0].carteiras.map(h => ({ ...h, cnpjFundo: '98000000000277' })) }]],
    ['WRONG_DATE', [{ carteiras: original[0].carteiras.map(h => ({ ...h, dataAtual: '2026-10-19' })) }]],
    ['INACTIVE_QUOTA', [{ carteiras: original[0].carteiras.map(h => ({ ...h, status: 'Inativa' })) }]],
    ['NEGATIVE_PL', [{ carteiras: original[0].carteiras.map(h => ({ ...h, pl: -1 })) }]],
    ['ZERO_TOTAL', [{ carteiras: original[0].carteiras.map(h => ({ ...h, pl: 0 })) }]],
    ['OVERFLOW', [{ carteiras: original[0].carteiras.map(h => ({ ...h, pl: '99999999999999999' })) }]],
    ['PRECISION_LOSS', [{ carteiras: original[0].carteiras.map(h => ({ ...h, pl: '1.12345' })) }]],
    ['EMPTY_RESPONSE', []], ['NULL_RESPONSE', null],
  ]
  for (const [name, response] of invalidCases) await check(name, async () => {
    const before = await financialHash(), job = await reserve(); await file(job)
    await reject(asMachine(conclude(job, response)), /ERROR/)
    assert.equal(await financialHash(), before, 'FINANCIAL_PARTIAL_WRITE')
    assert.equal((await fence(job)).podeRemoverArquivo, true)
    await reject(asMachine(conclude(job)), /encerrada/)
  })
  await check('PRIVATE_ORIGINAL_REQUIRED', async () => {
    const job = await reserve(), before = await financialHash()
    await reject(asMachine(conclude(job)), /Original privado/)
    await file(job); await sql(`UPDATE storage.objects SET metadata='{"size":124}' WHERE name=${q(job.storage_path)} AND bucket_id='vortx-carteiras';`)
    await reject(asMachine(conclude(job)), /Original privado/)
    assert.equal(await financialHash(), before)
    await fence(job)
  })
  await check('LEASE_AND_SCOPE', async () => {
    const job = await reserve(); await file(job)
    await reject(asMachine(`SELECT public.vortx_concluir_carteira(${q(job.id)},${q(randomUUID())},${json(original)})`), /indisponivel/)
    await sql(`UPDATE private.vortx_carteira_execucoes SET lease_ate=now()-interval '1 minute' WHERE id=${q(job.id)};`)
    await reject(asMachine(conclude(job)), /encerrada/); await fence(job)
    await reject(asMachine(`SELECT public.vortx_reservar_carteira(${q(randomUUID())},${q(version)},${q(date)},repeat('a',64),123)`), /indisponiveis/)
    await reject(asMachine(`SELECT public.vortx_reservar_carteira(${q(fund)},${q(randomUUID())},${q(date)},repeat('a',64),123)`), /indisponiveis/)
  })
  await check('TRANSACTION_ROLLBACK_PRESERVES_LAST_PUBLISHED_PL', async () => {
    const before = await financialHash(), job = await reserve(); await file(job)
    const corrected = structuredClone(original); corrected[0].carteiras[2].pl += 2
    await reject(asMachine(`${conclude(job, corrected)}; SELECT 1/0`), /division by zero/)
    assert.equal(await financialHash(), before)
    assert.equal(await scalar(`SELECT estado FROM private.vortx_carteira_execucoes WHERE id=${q(job.id)};`), 'RESERVADA')
    await fence(job)
  })
  await check('DUPLICATION_ORDER_AND_JSON_FORMAT_INDEPENDENT', async () => {
    const job = await reserve(); await file(job)
    const result = await machine(conclude(job, [{ carteiras: [...original[0].carteiras].reverse() }]))
    assert.equal(result.estado, 'DUPLICADA'); assert.equal(result.id, report.firstImportId)
    assert.equal((await fence(job)).podeRemoverArquivo, true)
    assert.equal(await scalar(`SELECT count(*) FROM public.carteira_snapshots WHERE fundo_id=${q(fund)};`), '1')
  })
  await check('REVISION_PRESERVES_HISTORY_AND_OLD_RETRY_DOES_NOT_REACTIVATE', async () => {
    const job = await reserve(); await file(job)
    const corrected = structuredClone(original); corrected[0].carteiras[2].pl += 1
    const result = await machine(conclude(job, corrected)); report.revisedImportId = result.id
    assert.equal(await scalar(`SELECT status FROM public.importacoes_financeiras WHERE id=${q(report.firstImportId)};`), 'RETIFICADA')
    assert.equal(await scalar(`SELECT patrimonio_liquido::text FROM public.carteira_snapshots WHERE fundo_id=${q(fund)} AND vigente;`), '29992285.0400')
    const retry = await reserve(); await file(retry)
    assert.equal((await machine(conclude(retry))).id, report.firstImportId)
    assert.equal((await fence(retry)).podeRemoverArquivo, true)
    assert.equal(await scalar(`SELECT importacao_id::text FROM public.carteira_snapshots WHERE fundo_id=${q(fund)} AND vigente;`), result.id)
    assert.equal(await scalar(`SELECT count(*) FROM public.vortx_carteira_cotas WHERE fundo_id=${q(fund)};`), '6')
  })
  await check('AUTHORIZATION_RLS_AND_STORAGE_BOUNDARY', async () => {
    for (const role of ['anon', 'authenticated']) {
      await reject(asActor(role, user, `SELECT public.vortx_reservar_carteira(${q(fund)},${q(version)},${q(date)},repeat('a',64),123)`), /permission denied/)
      await reject(asActor(role, user, 'SELECT * FROM private.vortx_carteira_execucoes'), /permission denied/)
      await reject(asActor(role, user, "INSERT INTO storage.objects(bucket_id,name) VALUES('vortx-carteiras','forbidden')"), /row-level security|permission denied/)
    }
    const visible = await sql(asActor('authenticated', user, 'SELECT count(*) FROM public.vortx_carteira_cotas'))
    assert(visible.split('\n').includes('6'), 'LEGITIMATE_GESTOR_QUOTAS_MISSING')
    const noLink = await sql(asActor('authenticated', randomUUID(), 'SELECT count(*) FROM public.vortx_carteira_cotas'))
    assert(noLink.split('\n').includes('0'), 'UNLINKED_ACTOR_DATA_LEAK')
    const raw = await sql(asActor('authenticated', user, "SELECT count(*) FROM storage.objects WHERE bucket_id='vortx-carteiras'"))
    assert(raw.split('\n').includes('0'), 'RAW_JSON_CLIENT_LEAK')
    await reject(asActor('authenticated', user, `UPDATE public.vortx_carteira_cotas SET patrimonio_liquido=0 WHERE fundo_id=${q(fund)}`), /permission denied/)
    assert.equal(await scalar("SELECT public::text||':'||file_size_limit::text FROM storage.buckets WHERE id='vortx-carteiras';"), 'false:20971520')
  })
  await check('HISTORY_COLLECTOR_MULTIROW_JSON_CONTROL', async () => {
    // PostgreSQL json_agg(record) may include real newlines. Selecting only the
    // first line truncates valid multirow evidence; jsonb serializes it in one line.
    const multiline = await sql("SELECT json_build_object('count',count(*),'rows',json_agg(h)) FROM (VALUES(1),(2)) h(id);")
    const complete = JSON.parse(multiline)
    assert.equal(complete.rows.length, 2); assert(multiline.includes('\n'), 'MULTILINE_CONTROL_NOT_REPRODUCED')
    assert.throws(() => JSON.parse(multiline.split('\n')[0]), SyntaxError)
    const compact = await sql("SELECT jsonb_build_object('count',count(*),'rows',jsonb_agg(to_jsonb(h))) FROM (VALUES(1),(2)) h(id);")
    assert.deepEqual(JSON.parse(compact), complete); assert(!compact.includes('\n'), 'COMPACT_COLLECTOR_NOT_SINGLE_LINE')
    report.historyCollector = { result: 'PASS', multiline, compact, completeRowCount: 2, previousFirstLineParserRejectedTruncation: true }
  })
  await check('REAL_SYNTHETIC_ACTORS_CROSS_FUND_AND_ROLE_MATRIX', async () => {
    const otherFund = randomUUID()
    await sql(`INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
      VALUES(${q(otherFund)},'QA OTHER FUND','98000000000277','QA','98000000000358','QA','98000000000439',true);`)
    report.actorMatrix = []
    for (const scenario of [
      { name: 'OTHER_FUND_GESTOR', role: 'gestor', fund: otherFund, expected: 0 },
      { name: 'NO_LINK_GESTOR', role: 'gestor', fund: null, expected: 0 },
      { name: 'OWN_FUND_CEDENTE', role: 'cedente', fund, expected: 0 },
      { name: 'OWN_FUND_CONSULTOR', role: 'consultor', fund, expected: 0 },
      { name: 'OWN_FUND_SUSPENDED_LINK', role: 'gestor', fund, status: 'suspenso', expected: 0 },
      { name: 'OWN_FUND_GESTOR', role: 'gestor', fund, expected: 6 },
      // Super Admin reads the already-authorized canonical import DTO, not the
      // restricted quota table directly. No extra grant or policy is introduced.
      { name: 'OWN_FUND_SUPER_ADMIN_CANONICAL_POSITION', role: 'super_admin', fund, expected: 0, canonical: 2 },
    ]) {
      const actor = randomUUID(), email = `${actor}@example.invalid`
      await sql(`INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES(${q(actor)},${q(email)},'{}','{}',now(),now());`)
      const canonical = JSON.parse(await scalar(`SELECT json_build_object('count',count(*),'role',min(role::text),'status',min(status::text),'email',min(email),'name',min(nome_completo)) FROM public.profiles WHERE id=${q(actor)};`))
      assert.deepEqual(canonical, { count: 1, role: 'cedente', status: 'ativo', email, name: email }, 'UNEXPECTED_CANONICAL_AUTH_PROFILE')
      if (scenario.role !== 'cedente') await sql(`UPDATE public.profiles SET role=${q(scenario.role)} WHERE id=${q(actor)} AND role='cedente';`)
      if (scenario.fund) await sql(`INSERT INTO public.usuario_fundos(usuario_id,fundo_id,status) VALUES(${q(actor)},${q(scenario.fund)},${q(scenario.status ?? 'ativo')});`)
      const visible = await sql(asActor('authenticated', actor, `SELECT json_build_object('count',count(*),'ids',coalesce(json_agg(importacao_id::text||':'||codigo_cota ORDER BY importacao_id,codigo_cota),'[]'::json)) FROM public.vortx_carteira_cotas`))
      const result = JSON.parse(visible.split('\n').find(line => line.startsWith('{"count"')))
      assert.equal(result.count, scenario.expected, scenario.name)
      if (scenario.canonical !== undefined) {
        const canonicalQuery = asActor('authenticated', actor, `SELECT json_build_object('count',count(*),'total',max(valor_total)::text) FROM public.importacoes_financeiras WHERE fundo_id=${q(fund)} AND tipo_base='CARTEIRA'`)
        assert.equal(await scalar(`SELECT count(*) FROM public.usuario_papeis WHERE usuario_id=${q(actor)} AND papel='super_admin' AND ativo;`), '0', 'UNEXPECTED_PREEXISTING_PLATFORM_ROLE')
        const denied = JSON.parse((await sql(canonicalQuery)).split('\n').find(line => line.startsWith('{"count"')))
        assert.equal(denied.count, 0, 'PROFILE_LABEL_ALONE_MUST_NOT_GRANT_ADMIN')
        // Canonical platform role is the documented actor fixture, not a GRANT,
        // policy change or assertion relaxation. The pre-role denial is retained.
        await sql(`INSERT INTO public.usuario_papeis(usuario_id,papel,ativo,origem) VALUES(${q(actor)},'super_admin',true,'administracao');`)
        const canonicalRows = JSON.parse((await sql(canonicalQuery)).split('\n').find(line => line.startsWith('{"count"')))
        assert.equal(canonicalRows.count, scenario.canonical, 'SUPER_ADMIN_CANONICAL_POSITION_RLS')
        assert(canonicalRows.total, 'SUPER_ADMIN_CANONICAL_PL_MISSING')
        const quotas = await sql(asActor('authenticated', actor, 'SELECT count(*) FROM public.vortx_carteira_cotas'))
        assert(quotas.split('\n').includes('0'), 'ADMIN_QUOTA_TABLE_ACCESS_NOT_BROADENED')
        report.superAdminCanonicalPosition = { actor, role: 'authenticated', profileRole: scenario.role, fund, beforeCanonicalRole: denied,
          explicitFixturePlatformRole: 'super_admin', visible: canonicalRows, directQuotaAccess: 0, result: 'PASS', grantsChanged: false }
      }
      const historySql = `SELECT jsonb_build_object('count',count(*),'rows',coalesce(jsonb_agg(to_jsonb(h) ORDER BY data_referencia DESC,publicada_em DESC,id DESC),'[]'::jsonb)) FROM (
        SELECT id,data_referencia,status,valor_total,metadados->'cotas' AS cotas,recebida_em,publicada_em,substituida_em
        FROM public.importacoes_financeiras WHERE fundo_id=${q(fund)} AND provedor='VORTX' AND tipo_base='CARTEIRA'
        AND fonte_ambiente='producao' AND status IN ('PUBLICADA','RETIFICADA')
        ORDER BY data_referencia DESC,publicada_em DESC,id DESC LIMIT 20 OFFSET 0) h`
      const historyOutput = (await sql(asActor('authenticated', actor, historySql))).split('\n').filter(line => line.startsWith('{')).at(-1)
      assert(historyOutput, 'CANONICAL_HISTORY_RESULT_MISSING')
      const history = JSON.parse(historyOutput)
      assert.equal(history.count, scenario.role === 'super_admin' || scenario.name === 'OWN_FUND_GESTOR' ? 2 : 0, `CANONICAL_WALLET_HISTORY_SCOPE:${scenario.name}`)
      for (const item of history.rows) {
        assert.equal(item.cotas.length, 3, 'CANONICAL_HISTORY_QUOTA_DTO'); assert(item.publicada_em, 'HISTORY_PUBLICATION_TIME_MISSING')
        assert(!('storage_path' in item) && !('contexto' in item), 'HISTORY_PRIVATE_FIELDS_EXPOSED')
      }
      report.historyActorMatrix ??= []
      report.historyActorMatrix.push({ scenario: scenario.name, role: 'authenticated', actor, fund, query: historySql, result: history, status: 'PASS' })
      report.actorMatrix.push({ scenario: scenario.name, actor, role: scenario.role, fund: scenario.fund, claimsRole: 'authenticated', initialProfile: canonical, testProfileRole: scenario.role, visible: result, result: 'PASS' })
    }
  })
  if (nativeStorageProof) await check('NATIVE_STORAGE_HTTP_AND_POSTGREST', async () => {
    report.nativeStorage = await nativeStorageProof({ fund, version, date, original, user })
    report.storageProof = 'OFFICIAL_STORAGE_HTTP_PRIVATE_UPLOAD_HASH_DOWNLOAD_AND_AUTHENTICATED_DENIAL'
  })
  await check('REVOKED_CREDENTIAL_FENCES_PENDING_PUBLICATION', async () => {
    const job = await reserve(); await file(job); const before = await financialHash()
    await sql(`UPDATE public.integracoes_vortx_vrs_credenciais SET status='revogada',revogada_em=now(),revogada_por=${q(user)} WHERE id=${q(credential)};`)
    await reject(asMachine(conclude(job)), /indisponiveis/)
    assert.equal(await financialHash(), before)
    assert.equal((await fence(job)).podeRemoverArquivo, true)
  })
  assert.equal(await scalar(preserved), before, 'PREEXISTING_SECURITY_CHANGED_DURING_TESTS')
  report.result = 'PASS'; await checkpoint(report); return report
}
