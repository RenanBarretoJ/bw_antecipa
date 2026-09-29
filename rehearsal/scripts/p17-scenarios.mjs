import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import calculo from '../../src/lib/operacoes/calculo.ts'
const { calcularValorPresenteNota } = calculo

// Transacional, sintetico e rollback-only. Nunca executar como smoke de producao.
export async function runP17Scenarios(db, root) {
  const evidence = { parity: [], flows: [], historicalPreserved: false }
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
  const actor = (suffix) => db.query("select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',$1,true)", [`21000000-0000-4000-8000-00000000000${suffix}`])
  const create = async (nf, key) => (await one(`select public.solicitar_operacao_antecipacao_consultor_atomica(
    '23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001',1,
    '{"calculo_financeiro":{"metodo":"TRINTA_360","versao_motor":2}}',repeat('a',64),false,'dispensado',
    array[$1]::uuid[],3.99,$2,null) result`, [nf, key.repeat(64)])).result.operacao_id
  const op = async (id) => (await one('select to_jsonb(o) result from public.operacoes o where id=$1', [id])).result
  await db.query('BEGIN')
  try {
    const setup = readFileSync(resolve(root,'supabase/tests/c2_1_r2_fluxo_taxa.test.sql'),'utf8').match(/DO \$setup\$[\s\S]*?\$setup\$;/)?.[0]
    assert.ok(setup)
    await db.query(setup)
    const dates = [
      ['2026-09-29','2026-11-09',41],['2026-09-30','2026-10-30',30],
      ['2026-01-31','2026-02-28',28],['2026-02-28','2026-03-31',31],
      ['2024-02-29','2024-03-31',31],['2024-02-28','2024-03-01',2],
      ['2026-12-31','2027-01-01',1],['2026-09-29','2026-09-29',0],
      ['2018-11-03','2018-11-05',2],
    ]
    for (const [base,due,days] of dates) {
      for (const rate of [0,2.35,3.99]) {
        const sql = (await one("select private.calcular_memoria_financeira_nf('2a000000-0000-4000-8000-000000000001',122386.47,$1,$2,$3,'TRINTA_360') m",[rate,base,due])).m
        const ts = calcularValorPresenteNota({ notaFiscalId: 'nf', valorNominal: 122386.47, taxaMensal: rate, dataBase: base, vencimento: due, metodo: 'TRINTA_360' })
        assert.equal(sql.dias,days)
        assert.equal(sql.dias,ts.dias)
        assert.equal(sql.valor_presente,ts.valorPresente)
        assert.equal(sql.versao_motor,2)
        assert.equal(sql.dias_financeiros,null)
        evidence.parity.push({base,due,rate,days,pv:sql.valor_presente})
      }
    }
    const acl = await one("select has_function_privilege('authenticated','private.recalcular_previa_operacao_p17(uuid,timestamptz)','EXECUTE') authenticated,has_function_privilege('anon','private.recalcular_previa_operacao_p17(uuid,timestamptz)','EXECUTE') anon,has_function_privilege('service_role','private.recalcular_previa_operacao_p17(uuid,timestamptz)','EXECUTE') service")
    assert.deepEqual(acl,{authenticated:false,anon:false,service:false})
    const nf='2a000000-0000-4000-8000-000000000001'
    // Data-base oficial e sempre hoje. O caso fixo de 29/09 fica na matriz pura;
    // a fixture de fluxo conserva 41 dias em qualquer data de execucao.
    await db.query("update public.notas_fiscais set valor_bruto=122386.47,valor_liquido=122386.47,data_vencimento=(now() at time zone 'America/Sao_Paulo')::date+41 where id=$1",[nf])
    await actor(1)
    const cancelled=await create(nf,'1')
    // Fixture de previa antiga v1: simula estado anterior ao hotfix, nao dado real.
    await db.query("update public.operacoes set valor_liquido_desembolso=116165.72,prazo_dias=40,calculo_versao_motor=1 where id=$1",[cancelled])
    const before=await op(cancelled)
    const nfBefore=await one('select to_jsonb(n) n from public.notas_fiscais n where id=$1',[nf])
    const repair=(await one('select private.recalcular_previa_operacao_p17($1,$2) result',[cancelled,before.updated_at])).result
    assert.equal(repair.depois.valor_liquido_desembolso,116014.32)
    assert.equal(repair.depois.prazo_dias,41)
    assert.deepEqual((await op(cancelled)).calculo_proposta_memoria,before.calculo_proposta_memoria)
    assert.deepEqual((await op(cancelled)).politica_snapshot,before.politica_snapshot)
    assert.deepEqual(await one('select to_jsonb(n) n from public.notas_fiscais n where id=$1',[nf]),nfBefore)
    assert.equal((await one("select count(*)::int n from public.logs_auditoria where entidade_id=$1 and tipo_evento='OPERACAO_PREVIA_RECALCULADA_P17'",[cancelled])).n,1)
    const repaired=await op(cancelled)
    assert.equal((await one('select private.recalcular_previa_operacao_p17($1,$2) result',[cancelled,repaired.updated_at])).result.idempotent_replay,true)
    // Cancelamento segue transicao atual (status + liberacao da NF), sem apagar link.
    await db.query("update public.operacoes set status='cancelada' where id=$1",[cancelled])
    await db.query("update public.notas_fiscais set status='aprovada' where id=$1",[nf])
    const cancelledSnapshot=await op(cancelled)
    const fresh=await create(nf,'2')
    const requested=await op(fresh)
    assert.equal(requested.valor_liquido_desembolso,116014.32)
    assert.equal(requested.prazo_dias,41)
    assert.equal(requested.calculo_proposta_memoria.itens[0].dias,41)
    assert.equal(requested.calculo_proposta_memoria.versao_motor,2)
    assert.equal(requested.calculo_memoria,null)
    assert.deepEqual(await op(cancelled),cancelledSnapshot)
    await db.query('SAVEPOINT active_nf')
    await assert.rejects(create(nf,'3'))
    await db.query('ROLLBACK TO SAVEPOINT active_nf')
    await actor(4)
    await db.query('select public.aprovar_operacao_atomica_financeiro_v1($1,3.99)',[fresh])
    await db.query("select set_config('app.calculo_aprovacao','false',true)")
    const approved=await op(fresh)
    assert.equal(approved.valor_liquido_desembolso,116014.32)
    assert.equal(approved.calculo_memoria.prazo_unidade,'dias_corridos')
    assert.equal(approved.calculo_versao_motor,2)
    assert.equal(approved.taxa_proposta_consultor,3.99)
    assert.equal(approved.taxa_desconto,3.99)
    const memory=await one('select dias_aplicados,versao_motor,valor_presente::float8 vp from public.operacao_calculo_nfs where operacao_id=$1',[fresh])
    assert.deepEqual(memory,{dias_aplicados:41,versao_motor:2,vp:116014.32})
    await db.query('select public.aprovar_operacao_atomica_financeiro_v1($1,2.35)',[fresh])
    assert.deepEqual(await op(fresh),approved)
    for (const historical of [fresh,cancelled]) {
      await db.query('SAVEPOINT history_guard')
      await assert.rejects(db.query('select private.recalcular_previa_operacao_p17($1,$2)',[historical,(await op(historical)).updated_at]),/historico financeiro/)
      await db.query('ROLLBACK TO SAVEPOINT history_guard')
    }
    await actor(1)
    const otherNf='2a000000-0000-4000-8000-000000000003'
    await db.query("update public.notas_fiscais set data_vencimento=(now() at time zone 'America/Sao_Paulo')::date+41 where id=$1",[otherNf])
    const changed=await create(otherNf,'4')
    await actor(4)
    await db.query('select public.aprovar_operacao_atomica_financeiro_v1($1,2.35)',[changed])
    const altered=await op(changed)
    assert.equal(altered.prazo_dias,41)
    assert.equal(altered.taxa_proposta_consultor,3.99)
    assert.equal(altered.taxa_desconto,2.35)
    assert.equal(altered.calculo_memoria.versao_motor,2)
    evidence.flows=['audited_pending_repair','repair_idempotency','NF_unchanged','immutable_policy_and_proposal','cancelled_NF_reused','active_NF_blocked','gestor_keeps_3.99','gestor_changes_2.35','approved_idempotent_replay','historical_repair_refused']
    evidence.historicalPreserved=true
    return evidence
  } finally { await db.query('ROLLBACK') }
}
