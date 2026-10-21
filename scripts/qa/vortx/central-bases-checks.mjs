import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'

// Synthetic read-only contract proof. Actors use the existing canonical Auth/MFA fixture.
export async function runCentralBasesChecks({ db, user, as, admin, ordinary, cross, unbound, fund, version, check, migration }) {
  const catalog = async () => (await db.query(`select p.oid,pg_get_functiondef(p.oid) definition,p.proacl::text
    from pg_proc p where p.pronamespace in ('auth'::regnamespace,'private'::regnamespace,'public'::regnamespace) order by p.oid`)).rows
  const rows = async () => (await db.query('select to_jsonb(s) row from vortx_relatorio_solicitacoes s order by id')).rows
  const policies = async () => (await db.query(`select c.oid,c.relrowsecurity,c.relacl::text,
    coalesce((select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p where p.polrelid=c.oid),'[]') policies
    from pg_class c where c.relnamespace in ('public'::regnamespace,'private'::regnamespace) and c.relkind='r' order by c.oid`)).rows
  const original = { functions: await catalog(), rows: await rows(), policies: await policies() }
  await db.query(migration)
  assert.deepEqual((await catalog()).filter(f => original.functions.some(o => o.oid === f.oid)), original.functions)
  assert.deepEqual(await rows(), original.rows)
  assert.deepEqual(await policies(), original.policies)
  check('central_migration_preserves_every_existing_function_grant_policy_rls_and_row')
  const sql = 'select public.vortx_central_bases_historico($1,$2,$3,$4,$5,$6) r'
  const args = [fund, 1, null, null, null, null]
  const history = async (actor = ordinary, changes = {}) => (await user(sql, Object.assign([...args], changes), actor)).rows[0].r
  const legacy = (await user('select admin_listar_relatorios_vortx($1,1) r', [fund], ordinary)).rows[0].r
  const initial = await history()
  assert.deepEqual(initial.solicitacoes, legacy.solicitacoes)
  assert.equal(initial.total, legacy.total)
  assert(initial.resumo.length <= 4)
  check('central_unfiltered_history_matches_canonical_projection_exactly')
  for (let index = 0; index < 30; index++) {
    const type = index < 26 ? 'Inclusao' : index < 29 ? 'Exclusao' : 'PosicaoParcela'
    const pedido = { codigoCarteira: 'synthetic', tipoRelatorio: type, dataInicio: '2019-06-09', dataFim: '2019-06-10', dataReferencia: '2019-06-10', extensaoArquivo: 2 }
    await db.query(`insert into vortx_relatorio_solicitacoes(id,fundo_id,integracao_versao_id,ambiente,pedido,hash_pedido,
      estado,codigo_http,solicitada_por,session_id,lease_hash,criada_em)
      values($1,$2,$3,'producao',$4,$5,$6,$7,$8,$9,$10,'2019-06-10T12:00:00Z')`,
    [randomUUID(), fund, version, pedido, createHash('sha256').update(randomUUID()).digest('hex'),
      index === 29 ? 'recusada' : 'registrada', index === 29 ? 422 : null, ordinary.id, ordinary.session, '0'.repeat(64)])
  }
  const first = await history(ordinary, { 2: 'Inclusao', 5: '2019-06-10' })
  const second = await history(ordinary, { 1: 2, 2: 'Inclusao', 5: '2019-06-10' })
  assert.equal(first.total, 26); assert.equal(first.solicitacoes.length, 20); assert.equal(second.solicitacoes.length, 6)
  assert.equal(new Set([...first.solicitacoes, ...second.solicitacoes].map(s => s.id)).size, 26)
  assert.deepEqual((await history(ordinary, { 2: 'Inclusao', 5: '2019-06-10' })).solicitacoes, first.solicitacoes)
  assert.deepEqual(first.resumo, second.resumo)
  assert(first.solicitacoes.every(s => s.pedido.tipoRelatorio === 'Inclusao' && s.fundo_id === fund))
  check('central_filters_before_pagination_stable_ties_no_omissions_no_duplicates')
  assert.equal((await history(ordinary, { 2: 'Exclusao', 3: 'MANUAL', 4: 'registrada', 5: '2019-06-10' })).total, 3)
  assert.equal((await history(ordinary, { 4: 'recusada', 5: '2019-06-10' })).total, 1)
  const empty = await history(ordinary, { 2: 'PosicaoAtivo', 5: '2019-06-10' })
  assert.equal(empty.total, 0); assert.deepEqual(empty.solicitacoes, [])
  assert.deepEqual(empty.resumo, first.resumo)
  assert((await history(ordinary, { 3: 'CRON' })).solicitacoes.every(s => s.origem === 'CRON'))
  assert.deepEqual((await history(ordinary, { 1: 0, 2: 'Inclusao', 5: '2019-06-10' })).solicitacoes, first.solicitacoes)
  assert.deepEqual((await history(ordinary, { 1: 20000 })).solicitacoes, [])
  check('central_type_origin_request_state_date_empty_and_page_bounds_are_server_side')
  for (const a of [cross, unbound]) await assert.rejects(history(a), { code: '42501' })
  await assert.rejects(as('anon', sql, args), { code: '42501' })
  await assert.rejects(as('service_role', sql, args), { code: '42501' })
  for (const changes of [{ 2: "Inclusao' OR true" }, { 3: 'UPLOAD' }, { 4: 'PUBLICADA' }]) {
    await assert.rejects(history(ordinary, changes), { code: '22023' })
  }
  check('central_anon_service_role_cross_fund_unbound_and_tampered_filters_fail_closed')
  await db.query("update usuario_fundos set perfil_no_fundo='LEITOR' where usuario_id=$1", [ordinary.id])
  assert.equal((await history()).total, (await history(admin)).total)
  await db.query("update usuario_fundos set perfil_no_fundo='gestor' where usuario_id=$1", [ordinary.id])
  for (const role of ['cedente', 'consultor', 'sacado']) {
    await db.query('update profiles set role=$1 where id=$2', [role, ordinary.id])
    await assert.rejects(history(), { code: '42501' })
  }
  await db.query("update profiles set role='gestor' where id=$1", [ordinary.id])
  for (const claims of [{ aal: 'aal1' }, { session_id: null }]) await assert.rejects(user(sql, args, ordinary, claims), { code: '42501' })
  await db.query('update sessoes_elevadas set revogada_em=now() where user_id=$1', [ordinary.id])
  await assert.rejects(history(), { code: '42501' })
  await db.query('update sessoes_elevadas set revogada_em=null where user_id=$1', [ordinary.id])
  check('central_leitor_read_only_and_canonical_roles_session_and_mfa_guards_preserved')
  const beforeReads = await rows()
  const projected = await history()
  assert(!JSON.stringify(projected).match(/lease_hash|session_id|payload_criptografado|urlRelatorio|storage_path/))
  await history(ordinary, { 2: 'Inclusao' })
  assert.deepEqual(await rows(), beforeReads)
  assert.deepEqual(await policies(), original.policies)
  check('central_read_only_projection_has_no_credentials_signed_urls_or_write_side_effects')
}
