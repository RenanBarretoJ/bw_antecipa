import { randomUUID } from 'node:crypto'
import { assertHomologEnvironment, connectDb, loadHomologEnv, parseArgs } from '../../rlx-golden/helpers.mjs'
import { buildGoldenV2 } from '../../rlx-golden-v2/scenario-definitions.mjs'

loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'p26_verify_security')
const dataset = buildGoldenV2()
const failures = []
let checks = 0
const check = (condition, label, details) => { checks += 1; if (!condition) failures.push({ label, details }) }

async function actor(userId, role = 'authenticated') {
  await db.query('RESET ROLE')
  await db.query(`SET LOCAL ROLE ${role}`)
  const claims = { sub: userId, role, aal: 'aal2', session_id: randomUUID() }
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)])
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId])
  await db.query("select set_config('request.jwt.claim.role',$1,true)", [role])
}

async function visible(table, fundId) {
  if (!['risco_execucoes','risco_motivos','risco_revisoes'].includes(table)) throw new Error('Tabela P2.6 invalida.')
  const result = await db.query(`select count(*)::int total from public.${table} where fundo_id=$1`, [fundId])
  return result.rows[0].total
}

async function deny(label, operation) {
  await db.query('SAVEPOINT denied')
  try { await operation(); check(false, label, 'aceito') }
  catch (error) { check(['42501','P0001','23502','22023'].includes(error?.code), label, { code: error?.code, message: error?.message }) }
  finally { await db.query('ROLLBACK TO SAVEPOINT denied'); await db.query('RELEASE SAVEPOINT denied') }
}

try {
  await db.query('BEGIN')
  const schema = await db.query(`select c.relname,c.relrowsecurity,
    has_table_privilege('authenticated',c.oid,'SELECT') auth_select,
    has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') auth_write,
    has_table_privilege('anon',c.oid,'SELECT') anon_select,
    (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname and p.cmd='SELECT')::int policies
    from pg_class c where c.relnamespace='public'::regnamespace and c.relname=any($1)`, [['risco_execucoes','risco_motivos','risco_revisoes']])
  check(schema.rows.length === 3 && schema.rows.every((row) => row.relrowsecurity && row.auth_select && !row.auth_write && !row.anon_select && row.policies === 1), 'RLS/grants P2.6', schema.rows)
  const functions = await db.query(`select p.oid::regprocedure::text signature,p.prosecdef,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') auth_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
    from pg_proc p where p.oid=any($1::regprocedure[])`, [[
      'public.persistir_risco_execucao(jsonb)',
      'public.simular_memoria_financeira_operacao(uuid,numeric)',
      'public.decidir_revisao_risco(uuid,text,text,uuid)',
      'public.aprovar_operacao_com_risco_atomica(uuid,numeric,uuid,text)',
    ]])
  check(functions.rows.length === 4 && functions.rows.every((row) => row.prosecdef && !row.anon_execute), 'SECURITY DEFINER sem anon', functions.rows)
  const internal = functions.rows.filter((row) => row.signature.startsWith('persistir_') || row.signature.startsWith('simular_'))
  check(internal.every((row) => !row.auth_execute && row.service_execute), 'persistencia/simulacao exclusivas do service role', internal)
  const oldApproval = await db.query(`select
    has_function_privilege('authenticated','public.aprovar_operacao_atomica(uuid,numeric)'::regprocedure,'EXECUTE') old_two,
    case when to_regprocedure('public.aprovar_operacao_atomica(uuid,numeric,numeric)') is null then false
      else has_function_privilege('authenticated','public.aprovar_operacao_atomica(uuid,numeric,numeric)'::regprocedure,'EXECUTE') end old_three`)
  check(!oldApproval.rows[0].old_two && !oldApproval.rows[0].old_three, 'rotas RPC antigas sem bypass', oldApproval.rows[0])
  const policy = await db.query(`select pg_get_functiondef('public.decidir_revisao_risco(uuid,text,text,uuid)'::regprocedure) review,
    pg_get_functiondef('public.aprovar_operacao_com_risco_atomica(uuid,numeric,uuid,text)'::regprocedure) approval`)
  check(policy.rows[0].review.includes("financeiro_autorizacao_consumida('revisar_risco_operacao')"), 'revisao exige TOTP fresco', null)
  check(policy.rows[0].review.includes('Super Admin puro'), 'Super Admin puro proibido', null)
  check(policy.rows[0].approval.includes("decisao='BLOQUEADO'"), 'bloqueio sem override', null)
  check(policy.rows[0].approval.includes('operacao_updated_at_snapshot IS DISTINCT FROM v_op.updated_at'), 'TOCTOU por snapshot', null)

  const identities = await db.query(`select
    (select id from public.profiles where status::text='ativo' and role::text='gestor' order by id limit 1) gestor,
    (select p.id from public.profiles p join public.usuario_papeis up on up.usuario_id=p.id where p.status::text='ativo' and up.papel::text='super_admin' and up.ativo order by p.id limit 1) super_admin,
    (select id from public.profiles where status::text='ativo' and role::text='cedente' order by id limit 1) cedente,
    (select id from public.profiles where status::text='ativo' and role::text='consultor' order by id limit 1) consultor,
    (select id from public.profiles where status::text='ativo' and role::text='sacado' order by id limit 1) sacado`)
  const ids = identities.rows[0]
  check(Boolean(ids.gestor && ids.super_admin && ids.cedente && ids.sacado), 'perfis obrigatorios presentes', ids)
  if (failures.length) throw new Error('Pre-condicoes de seguranca incompletas.')

  for (const id of new Set([ids.gestor, ids.super_admin])) {
    await db.query('delete from public.usuario_fundos where usuario_id=$1 and fundo_id=any($2)', [id, [dataset.mainFund.id,dataset.adversarialFund.id]])
  }
  await db.query(`insert into public.usuario_fundos(id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
    values(gen_random_uuid(),$1,$2,'gestor','ativo',false)`, [ids.gestor,dataset.mainFund.id])
  await actor(ids.gestor)
  check(await visible('risco_execucoes', dataset.mainFund.id) > 0, 'Gestor A le risco do fundo A', null)
  check(await visible('risco_execucoes', dataset.adversarialFund.id) === 0, 'Gestor A nao le fundo B', null)

  await db.query('RESET ROLE')
  await db.query('delete from public.usuario_fundos where usuario_id=$1', [ids.gestor])
  await db.query(`insert into public.usuario_fundos(id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
    values(gen_random_uuid(),$1,$2,'gestor','ativo',false)`, [ids.gestor,dataset.adversarialFund.id])
  await actor(ids.gestor)
  check(await visible('risco_execucoes', dataset.mainFund.id) === 0, 'Gestor B nao cruza para fundo A', null)
  check(await visible('risco_execucoes', dataset.adversarialFund.id) > 0, 'Gestor B le risco do fundo B', null)

  await actor(ids.super_admin)
  check(await visible('risco_execucoes', dataset.mainFund.id) === 0, 'Super Admin puro sem visao operacional', null)
  await db.query('RESET ROLE')
  await db.query(`insert into public.usuario_fundos(id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
    values(gen_random_uuid(),$1,$2,'gestor','ativo',false)`, [ids.super_admin,dataset.mainFund.id])
  await actor(ids.super_admin)
  check(await visible('risco_execucoes', dataset.mainFund.id) > 0, 'Hibrido com vinculo le fundo A', null)
  check(await visible('risco_execucoes', dataset.adversarialFund.id) === 0, 'Hibrido nao cruza para fundo B', null)

  for (const [label,id] of [['Cedente',ids.cedente],['Consultor',ids.consultor || '00000000-0000-0000-0000-000000000099'],['Sacado',ids.sacado]]) {
    await actor(id)
    check(await visible('risco_execucoes', dataset.mainFund.id) === 0, `${label} sem visao global`, null)
  }
  await actor('00000000-0000-0000-0000-000000000000', 'anon')
  await deny('Anon sem SELECT', () => db.query('select count(*) from public.risco_execucoes'))

  await db.query('RESET ROLE')
  await db.query('delete from public.usuario_fundos where usuario_id=$1', [ids.gestor])
  await db.query(`insert into public.usuario_fundos(id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
    values(gen_random_uuid(),$1,$2,'gestor','ativo',false)`, [ids.gestor,dataset.mainFund.id])
  await actor(ids.gestor)
  await deny('Gestor nao insere execucao', () => db.query('insert into public.risco_execucoes default values'))
  await deny('Gestor nao altera historico', () => db.query("update public.risco_execucoes set status_tecnico='NAO_APLICAVEL' where fundo_id=$1", [dataset.mainFund.id]))
  await deny('Gestor nao exclui historico', () => db.query('delete from public.risco_execucoes where fundo_id=$1', [dataset.mainFund.id]))
  await deny('Gestor nao executa persistencia interna', () => db.query("select public.persistir_risco_execucao('{}'::jsonb)"))
  await deny('Gestor nao executa simulacao interna', () => db.query("select public.simular_memoria_financeira_operacao('00000000-0000-0000-0000-000000000000'::uuid,1)"))
  await db.query('ROLLBACK')
  if (failures.length) throw new Error(`P2.6 security falhou em ${failures.length} de ${checks} verificacoes.`)
  console.log(`P2.6 security aprovado: ${checks} verificacoes; mutacoes de teste revertidas.`)
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  for (const failure of failures) console.error(`- ${failure.label}: ${JSON.stringify(failure.details)}`)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally { await db.end().catch(() => undefined) }
