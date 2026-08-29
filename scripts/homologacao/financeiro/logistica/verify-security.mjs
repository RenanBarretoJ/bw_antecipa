import { randomUUID } from 'node:crypto'

import {
  assertHomologEnvironment,
  connectDb,
  loadHomologEnv,
  parseArgs,
} from '../../rlx-golden/helpers.mjs'
import { buildGoldenV2 } from '../../rlx-golden-v2/scenario-definitions.mjs'

loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'p24_verify_security')
const dataset = buildGoldenV2()
const failures = []
let checks = 0

function check(condition, label, details) {
  checks += 1
  if (!condition) failures.push({ label, details })
}

async function actor(userId, databaseRole = 'authenticated') {
  await db.query('RESET ROLE')
  await db.query(`SET LOCAL ROLE ${databaseRole}`)
  const claims = { sub: userId, role: databaseRole, aal: 'aal2', session_id: randomUUID() }
  await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)])
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [userId])
  await db.query(`SELECT set_config('request.jwt.claim.role',$1,true)`, [databaseRole])
}

async function mustDeny(label, operation) {
  await db.query('SAVEPOINT p24_denied')
  try {
    await operation()
    check(false, label, 'comando foi aceito')
  } catch (error) {
    check(error?.code === '42501', label, { code: error?.code, message: error?.message })
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT p24_denied')
    await db.query('RELEASE SAVEPOINT p24_denied')
  }
}

async function visible(table, fundId) {
  const allowed = new Set(['posicao_logistica_execucoes', 'posicao_logistica_resultados'])
  if (!allowed.has(table)) throw new Error('Tabela de seguranca P2.4 invalida.')
  const result = await db.query(`SELECT count(*)::integer total FROM public.${table} WHERE fundo_id=$1`, [fundId])
  return result.rows[0].total
}

try {
  console.log('\nBW Antecipa - verificacao transacional RLS P2.4')
  console.log(`Projeto homolog: ${env.projectRef}`)
  await db.query('BEGIN')

  const schema = await db.query(`
    SELECT c.relname,c.relrowsecurity,
      has_table_privilege('authenticated',c.oid,'SELECT') AS auth_select,
      has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') AS auth_write,
      has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
      (SELECT count(*) FROM pg_policies p
        WHERE p.schemaname='public' AND p.tablename=c.relname AND p.cmd='SELECT')::integer AS select_policies
    FROM pg_class c
    WHERE c.relnamespace='public'::regnamespace
      AND c.relname=ANY($1)
    ORDER BY c.relname
  `, [['posicao_logistica_execucoes', 'posicao_logistica_resultados']])
  check(schema.rows.length === 2, 'duas tabelas P2.4 auditadas', schema.rows)
  check(schema.rows.every((row) => row.relrowsecurity && row.auth_select && !row.auth_write && !row.anon_select && row.select_policies === 1), 'RLS/grants P2.4 minimamente privilegiados', schema.rows)

  const executions = await db.query(`
    SELECT fundo_id,count(*)::integer total
    FROM public.posicao_logistica_execucoes
    WHERE fundo_id=ANY($1)
    GROUP BY fundo_id
  `, [[dataset.mainFund.id, dataset.adversarialFund.id]])
  const executionByFund = new Map(executions.rows.map((row) => [row.fundo_id, row.total]))
  check((executionByFund.get(dataset.mainFund.id) || 0) > 0, 'snapshot P2.4 existe no fundo principal', executions.rows)
  check((executionByFund.get(dataset.adversarialFund.id) || 0) > 0, 'snapshot P2.4 existe no fundo adversarial', executions.rows)

  const identities = await db.query(`
    SELECT
      (SELECT p.id FROM public.profiles p WHERE p.status::text='ativo' AND p.role::text='gestor'
        AND NOT EXISTS (SELECT 1 FROM public.usuario_papeis up WHERE up.usuario_id=p.id AND up.papel::text='super_admin' AND up.ativo)
        ORDER BY p.id LIMIT 1) gestor,
      (SELECT p.id FROM public.profiles p JOIN public.usuario_papeis up ON up.usuario_id=p.id
        WHERE p.status::text='ativo' AND p.role::text='super_admin'
          AND up.papel::text='super_admin' AND up.ativo ORDER BY p.id LIMIT 1) super_admin_puro,
      (SELECT p.id FROM public.profiles p JOIN public.usuario_papeis up ON up.usuario_id=p.id
        WHERE p.status::text='ativo' AND p.role::text='gestor'
          AND up.papel::text='super_admin' AND up.ativo ORDER BY p.id LIMIT 1) super_admin_gestor,
      (SELECT id FROM public.profiles WHERE status::text='ativo' AND role::text='cedente' ORDER BY id LIMIT 1) cedente,
      (SELECT id FROM public.profiles WHERE status::text='ativo' AND role::text='sacado' ORDER BY id LIMIT 1) sacado,
      (SELECT id FROM public.profiles WHERE status::text='ativo' AND role::text='consultor' ORDER BY id LIMIT 1) consultor
  `)
  const ids = identities.rows[0]
  check(Boolean(ids.gestor), 'massa possui Gestor')
  check(Boolean(ids.super_admin_puro), 'massa possui Super Admin puro')
  check(Boolean(ids.super_admin_gestor), 'massa possui Super Admin com papel operacional gestor')
  check(Boolean(ids.cedente), 'massa possui Cedente')
  check(Boolean(ids.sacado), 'massa possui Sacado')
  if (failures.length) throw new Error('Perfis ou snapshots obrigatorios da homologacao nao foram encontrados.')

  for (const userId of new Set([ids.gestor, ids.super_admin_puro, ids.super_admin_gestor])) {
    await db.query('DELETE FROM public.usuario_fundos WHERE usuario_id=$1 AND fundo_id=ANY($2)', [userId, [dataset.mainFund.id, dataset.adversarialFund.id]])
  }
  await db.query(`INSERT INTO public.usuario_fundos
    (id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
    VALUES (gen_random_uuid(),$1,$2,'gestor','ativo',false)`, [ids.gestor, dataset.mainFund.id])

  await actor(ids.gestor)
  check(await visible('posicao_logistica_execucoes', dataset.mainFund.id) > 0, 'Gestor principal le execucoes do fundo autorizado')
  check(await visible('posicao_logistica_resultados', dataset.mainFund.id) > 0, 'Gestor principal le resultados do fundo autorizado')
  check(await visible('posicao_logistica_execucoes', dataset.adversarialFund.id) === 0, 'Gestor principal nao le outro fundo')

  await db.query('RESET ROLE')
  await db.query('DELETE FROM public.usuario_fundos WHERE usuario_id=$1 AND fundo_id=$2', [ids.gestor, dataset.mainFund.id])
  await db.query(`INSERT INTO public.usuario_fundos
    (id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
    VALUES (gen_random_uuid(),$1,$2,'gestor','ativo',false)`, [ids.gestor, dataset.adversarialFund.id])
  await actor(ids.gestor)
  check(await visible('posicao_logistica_resultados', dataset.adversarialFund.id) > 0, 'Gestor do outro fundo le somente sua posicao')
  check(await visible('posicao_logistica_resultados', dataset.mainFund.id) === 0, 'Gestor do outro fundo nao cruza para o principal')

  await actor(ids.super_admin_puro)
  check(await visible('posicao_logistica_execucoes', dataset.mainFund.id) === 0, 'Super Admin puro nao recebe acesso operacional')
  await db.query('RESET ROLE')
  await db.query(`INSERT INTO public.usuario_fundos
    (id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
    VALUES (gen_random_uuid(),$1,$2,'gestor','ativo',false)`, [ids.super_admin_gestor, dataset.mainFund.id])
  await actor(ids.super_admin_gestor)
  check(await visible('posicao_logistica_resultados', dataset.mainFund.id) > 0, 'Perfil hibrido le fundo com vinculo gestor ativo')
  check(await visible('posicao_logistica_resultados', dataset.adversarialFund.id) === 0, 'Perfil hibrido nao amplia acesso para outro fundo')

  for (const [label, userId] of [
    ['Cedente', ids.cedente],
    ['Consultor', ids.consultor || '00000000-0000-0000-0000-000000000099'],
    ['Sacado', ids.sacado],
  ]) {
    await actor(userId)
    check(await visible('posicao_logistica_execucoes', dataset.mainFund.id) === 0, `${label} nao acessa execucoes P2.4`)
    check(await visible('posicao_logistica_resultados', dataset.mainFund.id) === 0, `${label} nao acessa resultados P2.4`)
  }

  await actor('00000000-0000-0000-0000-000000000000', 'anon')
  await mustDeny('Anon nao le snapshots P2.4', () => db.query('SELECT count(*) FROM public.posicao_logistica_execucoes'))

  await db.query('RESET ROLE')
  await db.query('DELETE FROM public.usuario_fundos WHERE usuario_id=$1 AND fundo_id=ANY($2)', [ids.gestor, [dataset.mainFund.id, dataset.adversarialFund.id]])
  await db.query(`INSERT INTO public.usuario_fundos
    (id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
    VALUES (gen_random_uuid(),$1,$2,'gestor','ativo',false)`, [ids.gestor, dataset.mainFund.id])
  await actor(ids.gestor)
  await mustDeny('Gestor nao insere execucao diretamente', () => db.query('INSERT INTO public.posicao_logistica_execucoes DEFAULT VALUES'))
  await mustDeny('Gestor nao insere resultado diretamente', () => db.query('INSERT INTO public.posicao_logistica_resultados DEFAULT VALUES'))
  await mustDeny('Gestor nao executa RPC interna P2.4', () => db.query(`SELECT public.persistir_posicao_logistica_execucao('{}'::jsonb)`))

  await db.query('ROLLBACK')
  if (failures.length) {
    for (const failure of failures) console.error(`- ${failure.label}: ${JSON.stringify(failure.details)}`)
    throw new Error(`P2.4 security verify falhou em ${failures.length} de ${checks} verificacoes.`)
  }
  console.log(`P2.4 security verify aprovado: ${checks} verificacoes; mutacoes revertidas.`)
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  console.error(error instanceof Error ? error.message : String(error))
  if (failures.length) for (const failure of failures) console.error(`- ${failure.label}: ${JSON.stringify(failure.details)}`)
  process.exitCode = 1
} finally {
  await db.end().catch(() => undefined)
}
