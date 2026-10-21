import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const migration = readFileSync(new URL('../../../supabase/migrations/20261021144651_vortx_pdd_advisory_persistence.sql', import.meta.url), 'utf8')

// Called only inside the existing two-stack native SQL rehearsal, after ALL old
// contracts (including the historical PDD publication denial) have passed.
export async function checkPddAdvisory({ db, internal, asRole, event, reserve, finish, payload, fund, otherFund, actor, stack }) {
  stack.pddMigration = { path: 'supabase/migrations/20261021144651_vortx_pdd_advisory_persistence.sql',
    sha256: createHash('sha256').update(migration.replace(/\r\n/g, '\n')).digest('hex') }
  async function prepare(date, change = {}) {
    await event('PosicaoAtivo', date); await event('PosicaoParcela', date)
    const job = await reserve(), body = payload({ date, pdd: '0.0000', suffix: `pdd-advisory-${date}` })
    Object.assign(body.parcelas[0].dados_normalizados, change)
    return { job, body }
  }
  const old = await prepare('2026-11-01')
  assert.equal((await finish(old.job, old.body)).reconciliado, false)
  const badOld = await prepare('2026-11-02', { valor_nominal: '99.0000' })
  assert.equal((await finish(badOld.job, badOld.body)).reconciliado, false)
  const beforeJob = (await db.query('select estado,atualizada_em from private.vortx_estoque_processamentos where id=$1', [old.job.id])).rows[0]
  assert.equal(beforeJob.estado, 'REVISAO')
  const native = async () => (await db.query(`select * from (select 'ativo' t,to_jsonb(a) r from vortx_posicao_ativos a union all select 'parcela',to_jsonb(p) from vortx_posicao_parcelas p) rows order by t,r->>'id'`)).rows
  const beforeRows = sha(await native())
  const preservedFunctions = async () => (await db.query(`select oid,pg_get_functiondef(oid) def,proacl::text acl from pg_proc
    where pronamespace in ('public'::regnamespace,'private'::regnamespace,'auth'::regnamespace)
    and proname not in ('vortx_concluir_processamento_estoque','vortx_central_bases_historico','vortx_estoque_reconciliado_financeiro') order by oid`)).rows
  const beforeFunctions = await preservedFunctions()
  const beforeTables = (await db.query("select oid,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where relnamespace in ('public'::regnamespace,'private'::regnamespace) order by oid")).rows
  const beforeAudit = (await db.query('select id,to_jsonb(a) r from plataforma_auditoria a order by id')).rows
  const completionAcl = (await db.query("select proacl::text acl,prosecdef,proconfig from pg_proc where oid='public.vortx_concluir_processamento_estoque(uuid,uuid,jsonb)'::regprocedure")).rows
  await db.query(migration)
  assert.equal(sha(await native()), beforeRows)
  assert.deepEqual(await preservedFunctions(), beforeFunctions)
  assert.deepEqual((await db.query("select oid,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where relnamespace in ('public'::regnamespace,'private'::regnamespace) order by oid")).rows, beforeTables)
  assert.deepEqual((await db.query('select id,to_jsonb(a) r from plataforma_auditoria a where id=ANY($1::uuid[]) order by id', [beforeAudit.map(r => r.id)])).rows, beforeAudit)
  assert.deepEqual((await db.query("select proacl::text acl,prosecdef,proconfig from pg_proc where oid='public.vortx_concluir_processamento_estoque(uuid,uuid,jsonb)'::regprocedure")).rows, completionAcl)
  stack.tests.push('pdd_forward_migration_preserves_native_bytes_original_audit_all_rls_acls_and_publication_guards')
  const afterJob = (await db.query('select estado,atualizada_em from private.vortx_estoque_processamentos where id=$1', [old.job.id])).rows[0]
  assert.deepEqual(afterJob, { estado: 'PERSISTIDO', atualizada_em: beforeJob.atualizada_em })
  assert.equal((await db.query('select estado from private.vortx_estoque_processamentos where id=$1', [badOld.job.id])).rows[0].estado, 'REVISAO')
  const oldImport = (await db.query('select status,publicada_em,metadados from importacoes_financeiras where id=$1', [old.body.id])).rows[0]
  assert.equal(oldImport.status, 'VALIDA'); assert.equal(oldImport.publicada_em, null)
  assert.equal(oldImport.metadados.reconciliado, false); assert.equal(oldImport.metadados.pdd_pendente, true)
  assert.equal((await db.query("select count(*)::int n from plataforma_auditoria where tipo_evento='VORTX_PDD_CONFERENCIA_ADIADA'")).rows[0].n, 1)
  await assert.rejects(internal('select publicar_estoque_vortx($1)', [old.body.id]), { code: '23514' })
  stack.tests.push('only_pdd_old_review_reclassified_with_audit_timestamp_and_full_reconciliation_preserved_no_publication')
  const fresh = await prepare('2026-11-03')
  await assert.rejects(finish({ ...fresh.job, lease: randomUUID() }, fresh.body), { code: '42501' })
  await assert.rejects(finish(fresh.job, { ...fresh.body, fundo_id: otherFund }), { code: '42501' })
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(asRole(role, 'select vortx_concluir_processamento_estoque($1,$2,$3)', [fresh.job.id, fresh.job.lease, fresh.body], actor), { code: '42501' })
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await assert.rejects(asRole(role, 'select private.vortx_estoque_reconciliado_financeiro($1)', [old.body.id], actor), { code: '42501' })
  }
  const result = await finish(fresh.job, fresh.body)
  assert.equal(result.reconciliado, false); assert.equal(result.reconciliadoFinanceiro, true); assert.equal(result.pddPendente, true)
  assert.equal((await db.query('select estado from private.vortx_estoque_processamentos where id=$1', [fresh.job.id])).rows[0].estado, 'PERSISTIDO')
  assert.equal((await db.query('select valor_pdd::text valor from vortx_posicao_ativos where importacao_id=$1', [fresh.body.id])).rows[0].valor, '2.0000')
  assert.equal((await db.query('select valor_pdd::text valor from vortx_posicao_parcelas where importacao_id=$1', [fresh.body.id])).rows[0].valor, '0.0000')
  await assert.rejects(internal('select publicar_estoque_vortx($1)', [fresh.body.id]), { code: '23514' })
  stack.tests.push('pdd_only_new_pair_persisted_original_values_warning_no_publication_and_same_worker_security')
  for (const [index, campo] of ['valor_nominal', 'valor_aquisicao', 'valor_presente'].entries()) {
    const test = await prepare(`2026-11-0${index + 4}`, { [campo]: '1.0000' })
    const result = await finish(test.job, test.body)
    assert.equal(result.reconciliadoFinanceiro, false); assert.equal(result.pddPendente, false)
    assert.equal((await db.query('select estado from private.vortx_estoque_processamentos where id=$1', [test.job.id])).rows[0].estado, 'REVISAO')
    await assert.rejects(internal('select publicar_estoque_vortx($1)', [test.body.id]), { code: '23514' })
  }
  stack.tests.push('nominal_acquisition_present_value_discrepancies_still_review_and_publication_denied')
  const missing = await prepare('2026-11-07', { valor_pdd: null })
  const missingResult = await finish(missing.job, missing.body)
  assert.equal(missingResult.reconciliadoFinanceiro, true); assert.equal(missingResult.pddPendente, true)
  assert.equal((await db.query('select valor_pdd from vortx_posicao_parcelas where importacao_id=$1', [missing.body.id])).rows[0].valor_pdd, null)
  stack.tests.push('missing_pdd_is_preserved_as_null_never_filled_with_fictitious_zero')
  // New callback, identical bytes: reuse snapshot and its actual advisory decision.
  await event('PosicaoAtivo', '2026-11-03')
  const repeatJob = await reserve()
  const duplicate = await finish(repeatJob, { ...fresh.body, id: randomUUID() })
  assert.equal(duplicate.id, fresh.body.id); assert.equal(duplicate.duplicada, true)
  assert.equal(duplicate.reconciliado, false); assert.equal(duplicate.reconciliadoFinanceiro, true); assert.equal(duplicate.pddPendente, true)
  stack.tests.push('identical_file_reprocessing_keeps_one_snapshot_and_recomputes_canonical_advisory')
  assert.equal((await db.query('select count(*)::int n from importacoes_financeiras where fundo_id=$1 and id=ANY($2::uuid[]) and status=\'PUBLICADA\'', [fund, [old.body.id, fresh.body.id, missing.body.id]])).rows[0].n, 0)
}
