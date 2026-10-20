import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { fileURLToPath } from 'node:url'
import { checkStockCallbackProcessing } from './native-stock-callback-checks.mjs'

// Focused structural/RLS rehearsal, not full Supabase/Auth/Storage E2E.
// Uses schema-only read-only export. No hosted connections or real credentials.
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const evidence = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-native-stock-20261019', `sql-${Date.now()}`)
mkdirSync(evidence, { recursive: true })
const read = path => readFileSync(resolve(repo, path), 'utf8').replace(/\r\n/g, '\n')
const migrationPath = 'supabase/migrations/20261019192624_vortx_native_stock.sql'
const migration = read(migrationPath)
const catalog = JSON.parse(read('scripts/qa/vortx/__fixtures__/native-stock-catalog.json'))
const oldFunctions = JSON.parse(read('scripts/qa/vortx/__fixtures__/native-stock-functions-baseline.json')).functions
const fiscal = JSON.parse(read('scripts/qa/vortx/__fixtures__/native-stock-fiscal-helper.json'))
const sha = value => createHash('sha256').update(value).digest('hex')
const q = value => '"' + value.replaceAll('"', '""') + '"'
function docker(args, allowFailure = false) {
  const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 60000 })
  if (!allowFailure) assert.equal(r.status, 0, `DOCKER_${args[0]}_FAILED`)
  return r.stdout.trim()
}
const inventory = () => ({ containers: docker(['ps', '-aq']).split(/\s+/).filter(Boolean).sort(), networks: docker(['network', 'ls', '-q']).split(/\s+/).filter(Boolean).sort() })
const before = inventory()
const report = { scope: 'LOCAL_FOCUSED_NATIVE_STOCK_SQL_RLS', migration: migrationPath, migrationSha256: sha(migration),
  migrations: [migrationPath, 'supabase/migrations/20261020192527_vortx_stock_callback_processing.sql'].map(path => ({ path, sha256: sha(read(path)) })),
  catalogSha256: sha(JSON.stringify(catalog)), preservedFunctionHashes: oldFunctions.map(f => ({ name: f.name, sha256: sha(f.definition) })),
  stacks: [], error: null, DOCKER_TEST_ENV_CLEANUP: false }
try {
  for (let iteration = 1; iteration <= 2; iteration++) {
    const name = `bw-vortx-native-${Date.now()}-${iteration}`
    const stack = { iteration, tests: [], cleanup: false }; report.stacks.push(stack)
    let container = false, network = false, db
    try {
      docker(['network', 'create', '--label', `bw.qa.scope=${name}`, '--opt', 'com.docker.network.bridge.enable_icc=false', name]); network = true
      const password = randomBytes(32).toString('hex')
      docker(['run', '-d', '--name', name, '--label', `bw.qa.scope=${name}`, '--network', name,
        '-p', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data', '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:17-alpine']); container = true
      const mapping = docker(['port', name, '5432/tcp']); assert.match(mapping, /^127\.0\.0\.1:\d+$/)
      const config = { host: '127.0.0.1', port: Number(mapping.split(':')[1]), user: 'postgres', password, database: 'postgres', connectionTimeoutMillis: 3000 }
      for (let i = 0; i < 40; i++) {
        db = new pg.Client(config)
        try { await db.connect(); break } catch { await db.end().catch(() => {}); db = null; await new Promise(r => setTimeout(r, 500)) }
      }
      assert(db, 'LOCAL_POSTGRES_UNAVAILABLE')
      await db.query(`create schema auth; create schema private;
        create role anon nologin; create role authenticated nologin; create role service_role nologin;
        grant usage on schema public,private,auth to authenticated,service_role;
        create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
        create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;`)
      for (const e of catalog.enums) await db.query(`create type public.${q(e.name)} as enum (${e.labels.map(x => `'${x.replaceAll("'", "''")}'`).join(',')})`)
      for (const t of catalog.tables) await db.query(`create table public.${q(t.name)} (${t.columns})`)
      for (const f of fiscal) await db.query(f.definition)
      for (const foreign of [false, true]) for (const c of catalog.constraints) {
        if (c.definition.startsWith('FOREIGN KEY') !== foreign) continue
        await db.query(`alter table public.${q(c.table)} add constraint ${q(c.name)} ${c.definition}`)
      }
      // SQL-language wrappers are validated at creation, so install their exact dependency first.
      const dependencyOrder = ['gestor_tem_acesso_fundo_operacional', 'usuario_e_super_admin', 'financeiro_chamada_service_role']
      for (const f of [...catalog.functions].sort((a, b) => {
        const rank = name => dependencyOrder.includes(name) ? dependencyOrder.indexOf(name) : 100
        return rank(a.name) - rank(b.name)
      })) await db.query(f.definition)
      for (const f of oldFunctions) await db.query(f.definition)
      await db.query(`create unique index importacoes_publicada_unica_idx on importacoes_financeiras(fundo_id,tipo_base,data_referencia) where status='PUBLICADA';
        create trigger importacao_linhagem before insert or update on importacoes_financeiras for each row execute function validar_linhagem_integracao_financeira();
        alter table estoque_posicoes enable row level security;
        alter table importacoes_financeiras enable row level security;
        grant select on estoque_posicoes,importacoes_financeiras to authenticated;
        create policy legacy_stock_read on estoque_posicoes for select to authenticated using(private.financeiro_gestor_tem_acesso_fundo(fundo_id));
        create policy metadata_read on importacoes_financeiras for select to authenticated using(private.financeiro_gestor_tem_acesso_fundo(fundo_id));`)
      await db.query(migration)
      stack.tests.push('forward_migration_on_canonical_focused_baseline')
      const fund = randomUUID(), otherFund = randomUUID(), actor = randomUUID(), cross = randomUUID(), cedente = randomUUID(), inactive = randomUUID()
      for (const [id, cnpj] of [[fund, '98992300000280'], [otherFund, '98992300000360']]) {
        await db.query(`insert into fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj) values($1,'QA SINTETICO',$2,'QA',$2,'QA',$2)`, [id, cnpj])
      }
      for (const [id, role, status] of [[actor, 'gestor', 'ativo'], [cross, 'gestor', 'ativo'], [cedente, 'cedente', 'ativo'], [inactive, 'gestor', 'inativo']]) {
        await db.query(`insert into profiles(id,role,nome_completo,email,status) values($1,$2,'QA',$3,$4)`, [id, role, `${id}@example.invalid`, status])
        await db.query(`insert into usuario_fundos(usuario_id,fundo_id) values($1,$2)`, [id, id === cross ? otherFund : fund])
      }
      const integration = randomUUID(), version = randomUUID()
      await db.query(`insert into integracoes_fundo(id,fundo_id,provedor,nome,status,created_by,provider_key,system_name) values($1,$2,'VORTX','QA Vortx','ativa',$3,'VORTX','VRS 2.0')`, [integration, fund, actor])
      await db.query(`insert into integracao_fundo_versoes(id,integracao_fundo_id,versao,ambiente,status,identificador_cliente,endpoint_base,credential_ref,publicada_por,publicada_em,adapter_key,configuracao_nao_sensivel)
        values($1,$2,1,'homologacao','publicada','QA','https://example.invalid','qa-reference',$3,now(),'vortx_vrs','{"codigo_carteira":"QA-CARTEIRA"}')`, [version, integration, actor])
      await db.query(`insert into integracao_fundo_versao_capacidades(integracao_fundo_versao_id,fundo_id,ambiente,capability,disponivel_desde) values($1,$2,'homologacao','ESTOQUE',now()-interval '1 day')`, [version, fund])
      async function asRole(role, sql, params = [], user = null) {
        assert(['authenticated', 'anon', 'service_role'].includes(role))
        await db.query('begin')
        try {
          await db.query(`set local role ${role}`)
          await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role, sub: user, aal: 'aal2' })])
          const r = await db.query(sql, params); await db.query('commit'); return r
        } catch (e) { await db.query('rollback'); throw e }
      }
      const internal = (sql, params = []) => asRole('service_role', sql, params)
      function payload({ pdd = '2.0000', twoCedentes = false, suffix = '', date = '2026-10-16' } = {}) {
        const id = randomUUID(), assets = [], parcels = []
        for (const [index, doc] of (twoCedentes ? ['98992300000280', '98992300000441'] : ['98992300000280']).entries()) {
          const base = { identidade_ativo: sha(`qa:${doc}`), codigo_carteira: 'QA-CARTEIRA', chave_ativo: 'A1', cedente_documento: doc, cedente_nome: 'CEDENTE QA',
            sacado_documento: '98992300000360', sacado_nome: 'SACADO QA', tipo_recebivel: 'DUPLICATA', valor_nominal: '100.0000', valor_aquisicao: '90.0000', valor_presente: '91.0000', valor_pdd: '2.0000',
            data_aquisicao: '2026-10-15', data_emissao: '2026-10-01', data_vencimento: '2026-11-20', data_vencimento_original: '2026-11-20', status_entrada_provedor: 'EM_TRANSITO' }
          assets.push({ numero_linha: index + 2, dados_brutos: { 'Campo Customizado 2': 'Em trânsito' }, dados_normalizados: base })
          parcels.push({ numero_linha: index + 2, dados_brutos: { 'Chave Única da Parcela': 'P1' }, dados_normalizados: { ...base, chave_parcela: 'P1', external_title_key: sha(`qa:${doc}:P1`), valor_pdd: pdd, status_entrada_provedor: 'NAO_INFORMADO' } })
        }
        return { id, correlation_id: randomUUID(), fundo_id: fund, integracao_fundo_versao_id: version, ambiente: 'homologacao', codigo_carteira: 'QA-CARTEIRA', data_referencia: date,
          hash_conteudo: sha(`qa:${date}:${pdd}:${twoCedentes}:${suffix}`), arquivos: [1, 2].map(ordem => ({ id: randomUUID(), ordem, nome_arquivo: `${ordem}.csv`, tamanho_bytes: 100, hash_conteudo: sha(`file:${ordem}:${pdd}:${suffix}`), storage_bucket: 'financeiro-importacoes', storage_path: `${fund}/vortx/${id}/${ordem}.csv` })), ativos: assets, parcelas: parcels }
      }
      const stage = async p => (await internal('select persistir_estoque_vortx($1) r', [p])).rows[0].r
      const publish = async id => (await internal('select publicar_estoque_vortx($1) r', [id])).rows[0].r
      const good = payload({ twoCedentes: true })
      assert.equal((await stage(good)).reconciliado, true)
      assert.equal((await db.query('select count(*)::int n from estoque_posicoes')).rows[0].n, 0)
      assert.equal((await db.query('select count(*)::int n from estoque_fontes_leitura')).rows[0].n, 0)
      stack.tests.push('two_native_tables_no_legacy_copy_no_unpublished_projection')
      const duplicate = await stage({ ...good, id: randomUUID() }); assert.equal(duplicate.id, good.id); assert.equal(duplicate.duplicada, true)
      stack.tests.push('snapshot_exact_retry_idempotent')
      for (const [label, change] of [['fund', { fundo_id: otherFund }], ['environment', { ambiente: 'producao' }], ['carteira', { codigo_carteira: 'OTHER' }], ['version', { integracao_fundo_versao_id: randomUUID() }]]) {
        await assert.rejects(stage({ ...payload({ suffix: label }), ...change }), { code: '42501' }); stack.tests.push(`cross_${label}_denied`)
      }
      for (const [label, change] of [['missing_pair', { parcelas: [] }], ['missing_file', { arquivos: [] }]]) {
        await assert.rejects(stage({ ...payload({ suffix: label }), ...change }), { code: '23514' }); stack.tests.push(label)
      }
      const orphan = payload({ suffix: 'orphan' }); orphan.parcelas[0].dados_normalizados.identidade_ativo = sha('orphan')
      await assert.rejects(stage(orphan), { code: '23503' })
      assert.equal((await db.query('select count(*)::int n from importacoes_financeiras where id=$1', [orphan.id])).rows[0].n, 0)
      stack.tests.push('orphan_rolls_back_files_header_rows_and_audit')
      const keyDuplicate = payload({ suffix: 'duplicate' }); keyDuplicate.parcelas.push({ ...keyDuplicate.parcelas[0], numero_linha: 3 })
      await assert.rejects(stage(keyDuplicate), { code: '23505' }); stack.tests.push('same_cedente_key_duplicate_denied')
      const nonFinite = payload({ suffix: 'non-finite' }); nonFinite.parcelas[0].dados_normalizados.valor_pdd = 'NaN'
      await assert.rejects(stage(nonFinite), { code: '23514' }); stack.tests.push('non_finite_financial_values_denied')
      assert.equal((await db.query('select count(distinct cedente_documento)::int n from vortx_posicao_parcelas where importacao_id=$1', [good.id])).rows[0].n, 2)
      stack.tests.push('same_provider_keys_different_cedentes_preserved')
      const bad = payload({ pdd: '0.0000' }); assert.equal((await stage(bad)).reconciliado, false)
      await assert.rejects(publish(bad.id), { code: '23514' })
      await db.query(`update importacoes_financeiras set metadados=metadados||'{"reconciliado":true}' where id=$1`, [bad.id])
      await assert.rejects(publish(bad.id), { code: '23514' })
      stack.tests.push('pdd_discrepancy_preserved_and_rechecked_not_metadata_trusted')
      await assert.rejects(internal('select publicar_importacao_financeira($1)', [good.id]), { code: '23514' })
      stack.tests.push('legacy_publisher_rejects_native_stock')
      await db.query(`update integracao_fundo_versoes set status='desativada' where id=$1`, [version])
      await assert.rejects(publish(good.id), { code: '42501' })
      await db.query(`update integracao_fundo_versoes set status='publicada' where id=$1`, [version])
      stack.tests.push('revocation_before_publication_denied')
      await db.query('update integracao_fundo_versao_capacidades set disponivel_ate=now() where integracao_fundo_versao_id=$1', [version])
      await assert.rejects(publish(good.id), { code: '42501' })
      await db.query('update integracao_fundo_versao_capacidades set disponivel_ate=null where integracao_fundo_versao_id=$1', [version])
      stack.tests.push('retired_capability_cannot_publish')
      assert.equal((await internal("select financeiro_possui_historico_fonte_vortx($1,'homologacao') r", [fund])).rows[0].r, true)
      assert.equal((await internal("select financeiro_possui_historico_fonte_vortx($1,'producao') r", [fund])).rows[0].r, false)
      assert.equal((await internal("select financeiro_possui_historico_fonte_vortx($1,'homologacao') r", [otherFund])).rows[0].r, false)
      await assert.rejects(asRole('authenticated', "select financeiro_possui_historico_fonte_vortx($1,'homologacao')", [fund], actor), { code: '42501' })
      stack.tests.push('revoked_source_history_fence_is_scoped_and_internal_only')
      assert.equal((await publish(good.id)).status, 'PUBLICADA')
      assert.equal((await publish(good.id)).idempotente, true)
      const visible = (await asRole('authenticated', 'select * from estoque_fontes_leitura order by id', [], actor)).rows
      assert.equal(visible.length, 2); assert.equal(visible.reduce((sum, r) => sum + Number(r.valor_aquisicao), 0), 180)
      assert(visible.every(r => r.provedor === 'VORTX' && r.numero_documento === null && r.chave_nfe === null && r.situacao_recebivel === null))
      assert(visible.every(r => r.status_entrada_provedor === 'EM_TRANSITO'))
      assert((await db.query('select status_entrada_provedor from vortx_posicao_parcelas where importacao_id=$1', [good.id])).rows.every(p => p.status_entrada_provedor === 'NAO_INFORMADO'))
      stack.tests.push('published_native_projection_once_per_parcel_no_fake_invoice_or_delivery')
      for (const user of [cross, cedente, inactive, randomUUID()]) {
        assert.equal((await asRole('authenticated', 'select id from vortx_posicao_ativos', [], user)).rowCount, 0)
        assert.equal((await asRole('authenticated', 'select id from estoque_fontes_leitura', [], user)).rowCount, 0)
      }
      stack.tests.push('canonical_rls_cross_fund_cedente_inactive_unlinked_denied')
      const realActor = (await asRole('authenticated', 'select current_user actor,(select rolbypassrls from pg_roles where rolname=current_user) bypass', [], actor)).rows[0]
      assert.deepEqual(realActor, { actor: 'authenticated', bypass: false }); stack.tests.push('rls_actor_non_owner_non_bypass')
      for (const role of ['anon', 'authenticated']) for (const sql of ['select persistir_estoque_vortx($1)', 'select publicar_estoque_vortx($1)']) {
        await assert.rejects(asRole(role, sql, [sql.includes('persistir') ? payload() : good.id], actor), { code: '42501' })
      }
      for (const sql of ['delete from vortx_posicao_parcelas', "update vortx_posicao_ativos set valor_pdd=0"]) await assert.rejects(asRole('authenticated', sql, [], actor), { code: '42501' })
      await assert.rejects(asRole('anon', 'select id from estoque_fontes_leitura'), { code: '42501' })
      stack.tests.push('no_public_write_rpc_or_anon_read')
      await assert.rejects(db.query('update vortx_posicao_parcelas set valor_nominal=1'), { code: 'P0001' })
      stack.tests.push('native_history_immutable_even_owner')
      await assert.rejects(db.query("update importacoes_financeiras set fonte_carteira='OTHER' where id=$1", [good.id]), { code: '23514' })
      await db.query('update fundos set ativo=false where id=$1', [fund])
      const disabledFund = payload({ suffix: 'disabled' })
      await assert.rejects(stage(disabledFund), { code: '42501' })
      await db.query('update fundos set ativo=true where id=$1', [fund])
      stack.tests.push('immutable_snapshot_scope_and_disabled_fund_denied')
      assert.equal((await internal('select resolver_bootstrap_financeiro($1) r', [fund])).rows[0].r.fundo_virgem, false)
      stack.tests.push('native_published_economics_prevents_false_virgin_bootstrap')
      const newer = payload({ twoCedentes: true, suffix: 'correction' }); await stage(newer); await publish(newer.id)
      assert.equal((await db.query('select status from importacoes_financeiras where id=$1', [good.id])).rows[0].status, 'RETIFICADA')
      assert.equal((await db.query('select count(*)::int n from estoque_fontes_leitura where importacao_id=$1 and not vigente', [good.id])).rows[0].n, 2)
      assert.equal((await db.query('select count(*)::int n from estoque_fontes_leitura where vigente')).rows[0].n, 2)
      stack.tests.push('correction_preserves_prior_rows_and_one_current_snapshot')
      // Compatibility publication on the exact legacy function, same date/fund.
      const legacy = randomUUID()
      await db.query(`insert into importacoes_financeiras(id,fundo_id,provedor,tipo_base,data_referencia,versao_layout,layout_nome,status,completude,hash_conteudo,nome_arquivo,mime_type,tamanho_bytes,storage_path,encoding_detectado)
        values($1,$2,'FROMTIS','ESTOQUE','2026-10-16','RLX_V1','RLX','VALIDA','COMPLETO_COM_DADOS',$3,'qa.csv','text/csv',100,'qa-only','utf-8')`, [legacy, fund, sha('legacy')])
      await db.query(`insert into importacao_linhas(importacao_id,fundo_id,numero_linha,status,dados_brutos,dados_normalizados) values($1,$2,2,'VALIDA','{}',$3)`, [legacy, fund, { id_recebivel: 'legacy-1', external_title_key: 'legacy-1', valor_nominal: '50', valor_aquisicao: '45' }])
      await internal('select publicar_importacao_financeira($1)', [legacy])
      assert.equal((await db.query('select status from importacoes_financeiras where id=$1', [newer.id])).rows[0].status, 'PUBLICADA')
      assert.equal((await db.query('select count(*)::int n from estoque_posicoes')).rows[0].n, 1)
      stack.tests.push('legacy_publication_does_not_retify_native_namespace')
      // Native IDs must persist through the original logistics security contract.
      const positions = (await db.query('select * from estoque_fontes_leitura where importacao_id=$1 order by id', [newer.id])).rows
      const matchPayload = { fundo_id: fund, data_referencia: '2026-10-16', regra_versao: 'RLX_MATCH_V1', input_import_ids: [newer.id], assinatura_execucao: sha('match-native'), correlation_id: randomUUID(), criado_por: actor,
        resultados: positions.map(p => ({ provedor: 'VORTX', origem_registro: 'ESTOQUE', origem_registro_id: p.id, identidade_externa: p.id_recebivel, id_recebivel: p.id_recebivel, status: 'NAO_CONCILIADO', metodo: 'NAO_CONCILIADO', valor_referencia: p.valor_aquisicao, candidatos: [] })) }
      const matching = (await internal('select persistir_matching_execucao($1) id', [matchPayload])).rows[0].id
      const matches = (await db.query('select * from matching_resultados where execucao_id=$1', [matching])).rows
      const logPayload = { fundo_id: fund, data_referencia: '2026-10-16', regra_versao: 'RLX_LOGISTICA_V1', estoque_importacao_id: newer.id, matching_execucao_id: matching, assinatura_execucao: sha('log-native'), fingerprint_logistico: sha('empty-evidence'), logistica_as_of: new Date().toISOString(), correlation_id: randomUUID(), criado_por: actor,
        resultados: positions.map(p => ({ estoque_posicao_id: p.id, matching_resultado_id: matches.find(m => m.origem_registro_id === p.id).id, matching_status: 'NAO_CONCILIADO', matching_metodo: 'NAO_CONCILIADO', status_vinculo: 'SEM_MATCH_FINANCEIRO_NF', status_logistico: null, valor_nominal: p.valor_nominal, valor_aquisicao: p.valor_aquisicao, valor_aquisicao_qualidade: 'PRESENTE', id_recebivel: p.id_recebivel })) }
      const logistics = (await internal('select persistir_posicao_logistica_execucao($1) id', [logPayload])).rows[0].id
      const saved = (await db.query('select * from posicao_logistica_resultados where execucao_id=$1', [logistics])).rows
      assert.equal(saved.length, 2); assert(saved.every(p => p.estoque_posicao_id === null && p.vortx_posicao_parcela_id && p.status_logistico === null))
      stack.tests.push('matching_logistics_native_fk_not_legacy_and_entry_status_not_evidence')
      const tamper = structuredClone(logPayload); tamper.assinatura_execucao = sha('tampered-log'); tamper.resultados[0].estoque_posicao_id = randomUUID()
      await assert.rejects(internal('select persistir_posicao_logistica_execucao($1)', [tamper]), { code: '22023' })
      stack.tests.push('logistics_tampered_source_id_denied')
      const incomplete = structuredClone(logPayload); incomplete.assinatura_execucao = sha('missing-parcel'); incomplete.resultados.pop()
      await assert.rejects(internal('select persistir_posicao_logistica_execucao($1)', [incomplete]), { code: '22023' })
      stack.tests.push('logistics_rejects_partial_native_snapshot')
      // Original Fromtis logistics still resolves its original FK, not the new native FK.
      const legacyPosition = (await db.query('select * from estoque_posicoes where importacao_id=$1', [legacy])).rows[0]
      const legacyMatch = { ...matchPayload, input_import_ids: [legacy], assinatura_execucao: sha('legacy-match'),
        resultados: [{ ...matchPayload.resultados[0], provedor: 'FROMTIS', origem_registro_id: legacyPosition.id, identidade_externa: 'legacy-1', id_recebivel: 'legacy-1', valor_referencia: '45' }] }
      const legacyMatching = (await internal('select persistir_matching_execucao($1) id', [legacyMatch])).rows[0].id
      const legacyMatchRow = (await db.query('select id from matching_resultados where execucao_id=$1', [legacyMatching])).rows[0].id
      const legacyLog = { ...logPayload, estoque_importacao_id: legacy, matching_execucao_id: legacyMatching, assinatura_execucao: sha('legacy-log'),
        resultados: [{ ...logPayload.resultados[0], estoque_posicao_id: legacyPosition.id, matching_resultado_id: legacyMatchRow, valor_nominal: '50', valor_aquisicao: '45' }] }
      const legacyLogId = (await internal('select persistir_posicao_logistica_execucao($1) id', [legacyLog])).rows[0].id
      const legacySaved = (await db.query('select * from posicao_logistica_resultados where execucao_id=$1', [legacyLogId])).rows[0]
      assert.equal(legacySaved.estoque_posicao_id, legacyPosition.id); assert.equal(legacySaved.vortx_posicao_parcela_id, null)
      stack.tests.push('legacy_logistics_original_fk_preserved')
      assert((await db.query('select count(*)::int n from plataforma_auditoria')).rows[0].n >= 5)
      stack.tests.push('publication_and_staging_audit_retained')
      await checkStockCallbackProcessing({ db, config, internal, asRole, payload, fund, otherFund, actor, integration, version, stack })
    } finally {
      if (db) await db.end()
      if (container) { assert.equal(docker(['inspect', '--format', '{{index .Config.Labels "bw.qa.scope"}}', name]), name); docker(['rm', '-f', name]) }
      if (network) { assert.equal(docker(['network', 'inspect', '--format', '{{index .Labels "bw.qa.scope"}}', name]), name); docker(['network', 'rm', name]) }
      stack.cleanup = true
    }
  }
} catch (error) { report.error = { name: error.name, code: error.code ?? null, message: error.message?.slice(0, 250) }; process.exitCode = 1 }
finally {
  report.DOCKER_TEST_ENV_CLEANUP = JSON.stringify(before) === JSON.stringify(inventory()) && report.stacks.every(s => s.cleanup)
  if (!report.DOCKER_TEST_ENV_CLEANUP) process.exitCode = 1
  writeFileSync(resolve(evidence, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ evidence, passed: !report.error && report.DOCKER_TEST_ENV_CLEANUP, stacks: report.stacks.map(s => ({ iteration: s.iteration, checks: s.tests.length, cleanup: s.cleanup })), error: report.error, DOCKER_TEST_ENV_CLEANUP: report.DOCKER_TEST_ENV_CLEANUP }))
}
