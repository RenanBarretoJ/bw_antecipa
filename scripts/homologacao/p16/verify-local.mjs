import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

// Fixtures sinteticas exclusivamente no clean-room P16, sem acesso remoto.
const connectionString = 'postgresql://postgres:postgres@127.0.0.1:56322/postgres'
const db = new pg.Client({ connectionString })
const id = (prefix, end = 1) => `${prefix}0000000-0000-4000-8000-${String(end).padStart(12, '0')}`
const cedente = id(4), vinculo = id(5), fundo = id(3), nf = id(7)
const owner = id(1), leitor = id(1, 3), crossOrg = id(1, 5), cedenteUser = id(1, 6)
const policy = id(8), version = id(9)
const report = []
function pass(name) { report.push(name); console.log(`PASS ${name}`) }
async function actor(client, user) {
  await client.query('set local role authenticated')
  await client.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",
    [user, JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })])
}
async function admin(client) { await client.query('reset role') }
async function submit(client, { user = cedenteUser, legacy = false, key = randomUUID() } = {}) {
  await actor(client, user)
  const args = [cedente, vinculo, policy, version, 1, JSON.stringify({ calculo_financeiro: { metodo: 'DIAS_UTEIS_252' } }), 'p16-synthetic', false, 'dispensado', [nf], 100, 1, 30, 99, '2027-01-01', key]
  const types = ['uuid','uuid','uuid','uuid','integer','jsonb','text','boolean','text','uuid[]','numeric','numeric','integer','numeric','date','text']
  if (!legacy) { args.push(null); types.push('uuid[]') }
  const sql = `select public.solicitar_operacao_antecipacao_atomica(${types.map((t,i)=>`$${i+1}::${t}`).join(',')}) as result`
  const { rows } = await client.query(sql, args)
  return rows[0].result.operacao_id
}
async function expectDenied(fn, pattern) {
  await db.query('savepoint denied')
  let failure
  try { await fn() } catch (error) { failure = error }
  await db.query('rollback to savepoint denied')
  assert.ok(failure, 'request unexpectedly allowed')
  assert.match(failure.message, pattern)
}
async function setHistoryStatus(op, status) {
  await admin(db)
  // Somente montagem de estado historico sintetico; nao e teste de aprovacao.
  await db.query("select set_config('app.calculo_aprovacao','true',true)")
  await db.query('update public.operacoes set status=$1 where id=$2', [status, op])
  await db.query("select set_config('app.calculo_aprovacao','false',true)")
  await db.query("update public.notas_fiscais set status='aprovada' where id=$1", [nf])
}
async function seed() {
  // Reutiliza a fixture organizacional versionada do C1.1, incluindo seus asserts.
  const c11 = readFileSync('supabase/tests/c1_1_organizacao_consultora.test.sql', 'utf8')
  await db.query(c11.slice(c11.indexOf('DO $test$'), c11.indexOf('SET LOCAL ROLE authenticated;')))
  await db.query("select set_config('request.jwt.claim.sub','',true)")
  await db.query(`insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values ($1,'cedente-p16@example.invalid','{}','{}');`, [cedenteUser])
  await db.query("update public.profiles set role='cedente',status='ativo' where id=$1", [cedenteUser])
  await db.query('update public.cedentes set user_id=$1 where id=$2', [cedenteUser, cedente])
  await db.query("insert into public.politicas_operacionais(id,fundo_id,codigo,nome,status,created_by) values ($1,$2,'P16','P16 QA','ativa',$3)", [policy, fundo, owner])
  await db.query(`insert into public.politica_operacional_versoes(id,politica_operacional_id,fundo_id,versao,vigente_desde,conteudo_hash,metodo_calculo_financeiro,publicada_por,publicada_em,status)
    values ($1,$2,$3,1,now()-interval '1 day',repeat('a',64),'DIAS_UTEIS_252',$4,now(),'publicada')`, [version, policy, fundo, owner])
  await db.query('insert into public.cedente_fundo_politicas(cedente_fundo_id,politica_operacional_id,vigente_desde) values ($1,$2,now()-interval \'1 day\')', [vinculo, policy])
  await db.query("insert into public.contas_escrow(cedente_id,identificador,status) values ($1,'P16-QA','ativa')", [cedente])
  await db.query("update public.notas_fiscais set status='aprovada',data_vencimento='2027-01-01' where id=$1", [nf])
}
await db.connect()
try {
  await db.query('begin')
  await seed()
  const matrix = (await db.query('select s::text as status, private.operacao_status_reserva_nf(s) as reserves from unnest(enum_range(null::public.operacao_status)) s')).rows
  for (const row of matrix) assert.equal(row.reserves, !['cancelada','reprovada'].includes(row.status))
  pass('status_matrix')
  const definitions = (await db.query("select pronargs,prosrc from pg_proc where proname='solicitar_operacao_antecipacao_atomica'")).rows
  assert.equal(definitions.length, 2)
  for (const row of definitions) { assert.match(row.prosrc,/FOR UPDATE/); assert.match(row.prosrc,/private.operacao_status_reserva_nf/); }
  pass('all_overloads_use_locked_predicate')
  for (const legacy of [false, true]) {
    await db.query('savepoint scenario')
    if (legacy) {
      // A sobrecarga de 17 argumentos tem DEFAULT NULL e torna a chamada SQL
      // de 16 argumentos ambigua no baseline. Isolamos o corpo legado somente
      // nesta transacao local; o rollback restaura o nome original.
      await admin(db)
      const signature = (await db.query("select oid::regprocedure::text as signature from pg_proc where proname='solicitar_operacao_antecipacao_atomica' and pronargs=17")).rows[0].signature
      await db.query(`alter function ${signature} rename to p16_current_overload`)
    }
    const first = await submit(db, { legacy })
    // Mesmas escritas do fluxo cancelarOperacao, sob RLS do proprio Cedente.
    const cancelled = await db.query("update public.operacoes set status='cancelada' where id=$1 returning id", [first])
    assert.equal(cancelled.rowCount, 1)
    const restored = await db.query("update public.notas_fiscais set status='aprovada',aprovacao_sacado_em=null where id=$1 returning id", [nf])
    assert.equal(restored.rowCount, 1)
    await db.query('select public.liberar_parcelas_operacao_rejeitada($1)', [first])
    const second = await submit(db, { legacy })
    assert.notEqual(first, second)
    await admin(db)
    assert.equal((await db.query('select count(*)::int as n from public.operacoes_nfs where nota_fiscal_id=$1', [nf])).rows[0].n, 2)
    assert.equal((await db.query("select count(*)::int as n from public.logs_auditoria where entidade_id=$1 and tipo_evento='OPERACAO_SOLICITADA'", [second])).rows[0].n, 1)
    pass(`cancel_reuse_history_audit_${legacy ? 'legacy' : 'current'}`)
    await db.query('rollback to savepoint scenario')
  }
  await db.query('savepoint matrix')
  const previous = await submit(db)
  for (const status of matrix.map(row=>row.status)) {
    await setHistoryStatus(previous, status)
    await db.query('savepoint status_case')
    if (['cancelada','reprovada'].includes(status)) await submit(db)
    else await expectDenied(()=>submit(db), /NF_ALREADY_LINKED_TO_ACTIVE_OPERATION/)
    await db.query('rollback to savepoint status_case')
    pass(`rpc_${status}`)
  }
  await setHistoryStatus(previous, 'reprovada')
  const cancelled = await submit(db)
  await setHistoryStatus(cancelled, 'cancelada')
  const active = await submit(db, { user: owner })
  await admin(db)
  assert.equal((await db.query('select count(*)::int as n from public.operacoes_nfs where nota_fiscal_id=$1', [nf])).rows[0].n,3)
  // NF aprovada com historico ativo ainda precisa ser negada pelo predicado.
  await db.query("update public.notas_fiscais set status='aprovada' where id=$1", [nf])
  await expectDenied(()=>submit(db), /NF_ALREADY_LINKED_TO_ACTIVE_OPERATION/)
  pass('multi_history_and_consultor_C2')
  await setHistoryStatus(active, 'cancelada')
  for (const user of [leitor, crossOrg]) await expectDenied(()=>submit(db,{user}), /Consultor sem vinculo organizacional ativo/)
  pass('C1_1_leitor_cross_org_denied')
  await admin(db)
  await db.query('update public.cedentes set user_id=null where id=$1', [cedente])
  await expectDenied(()=>submit(db), /Cedente sem acesso/)
  pass('cross_cedente_denied')
  await db.query('rollback to savepoint matrix')
  await admin(db)
  await db.query('rollback')
  if (process.argv.includes('--concurrency')) {
    // Este modo deixa fixtures sinteticas no banco descartavel. Executar
    // supabase db reset --local --no-seed no clean-room antes/depois do teste.
    await db.query('begin')
    await seed()
    const history = await submit(db)
    await setHistoryStatus(history, 'cancelada')
    await db.query('commit')
    const first = new pg.Client({ connectionString, application_name: 'p16-first' })
    const second = new pg.Client({ connectionString, application_name: 'p16-second' })
    await Promise.all([first.connect(), second.connect()])
    try {
      await first.query('begin')
      await second.query('begin')
      const winner = await submit(first)
      const competing = submit(second).then(()=>({ allowed:true }),error=>({ allowed:false, message:error.message }))
      let waiting = false
      for (let attempt = 0; attempt < 50; attempt++) {
        const state = (await db.query("select wait_event_type from pg_stat_activity where application_name='p16-second'")).rows[0]
        if (state?.wait_event_type === 'Lock') { waiting = true; break }
        await new Promise(resolve=>setTimeout(resolve,20))
      }
      assert.ok(waiting, 'second request must wait on the first transaction lock')
      await first.query('commit')
      const loser = await competing
      assert.equal(loser.allowed, false)
      assert.match(loser.message,/nao estao aprovadas|NF_ALREADY_LINKED_TO_ACTIVE_OPERATION/)
      await second.query('rollback')
      const count = (await db.query(`select count(*)::int as n from public.operacoes_nfs link join public.operacoes op on op.id=link.operacao_id
        where link.nota_fiscal_id=$1 and private.operacao_status_reserva_nf(op.status)`,[nf])).rows[0].n
      assert.equal(count,1)
      assert.equal((await db.query("select count(*)::int as n from public.logs_auditoria where entidade_id=$1 and tipo_evento='OPERACAO_SOLICITADA'",[winner])).rows[0].n,1)
      pass('concurrency_one_winner_one_denied_one_active')
    } finally {
      await Promise.allSettled([first.query('rollback'),second.query('rollback')])
      await Promise.all([first.end(),second.end()])
    }
  }
  console.log(JSON.stringify({ result: 'PASS', checks: report.length }))
} finally { await db.query('rollback').catch(()=>{}); await db.end() }
