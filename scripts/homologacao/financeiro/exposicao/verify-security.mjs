import { randomUUID } from 'node:crypto'
import { assertHomologEnvironment, connectDb, loadHomologEnv, parseArgs } from '../../rlx-golden/helpers.mjs'
import { buildGoldenV2 } from '../../rlx-golden-v2/scenario-definitions.mjs'

loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'p25_verify_security')
const dataset = buildGoldenV2()
const failures = []
let checks = 0
const check = (condition, label, details) => { checks += 1; if (!condition) failures.push({ label, details }) }

async function actor(userId, role = 'authenticated') {
  await db.query('RESET ROLE')
  await db.query(`SET LOCAL ROLE ${role}`)
  const claims = { sub: userId, role, aal: 'aal2', session_id: randomUUID() }
  await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)])
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [userId])
  await db.query(`SELECT set_config('request.jwt.claim.role',$1,true)`, [role])
}
async function visible(table, fundId) {
  if (!['exposicao_execucoes','exposicao_overlay_itens'].includes(table)) throw new Error('Tabela P2.5 invalida.')
  const result = await db.query(`SELECT count(*)::int total FROM public.${table} WHERE fundo_id=$1`, [fundId])
  return result.rows[0].total
}
async function deny(label, operation) {
  await db.query('SAVEPOINT denied')
  try { await operation(); check(false, label, 'aceito') }
  catch (error) { check(['42501','P0001','23502'].includes(error?.code), label, { code: error?.code, message: error?.message }) }
  finally { await db.query('ROLLBACK TO SAVEPOINT denied'); await db.query('RELEASE SAVEPOINT denied') }
}

try {
  await db.query('BEGIN')
  const schema = await db.query(`SELECT c.relname,c.relrowsecurity,
    has_table_privilege('authenticated',c.oid,'SELECT') auth_select,
    has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') auth_write,
    has_table_privilege('anon',c.oid,'SELECT') anon_select,
    (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname AND p.cmd='SELECT')::int policies
    FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1)`, [['exposicao_execucoes','exposicao_overlay_itens']])
  check(schema.rows.length === 2 && schema.rows.every((row) => row.relrowsecurity && row.auth_select && !row.auth_write && !row.anon_select && row.policies === 1), 'RLS/grants P2.5', schema.rows)
  const identities = await db.query(`SELECT
    (SELECT id FROM public.profiles WHERE status::text='ativo' AND role::text='gestor' ORDER BY id LIMIT 1) gestor,
    (SELECT p.id FROM public.profiles p JOIN public.usuario_papeis up ON up.usuario_id=p.id WHERE p.status::text='ativo' AND up.papel::text='super_admin' AND up.ativo ORDER BY p.id LIMIT 1) super_admin,
    (SELECT id FROM public.profiles WHERE status::text='ativo' AND role::text='cedente' ORDER BY id LIMIT 1) cedente,
    (SELECT id FROM public.profiles WHERE status::text='ativo' AND role::text='consultor' ORDER BY id LIMIT 1) consultor,
    (SELECT id FROM public.profiles WHERE status::text='ativo' AND role::text='sacado' ORDER BY id LIMIT 1) sacado`)
  const ids = identities.rows[0]
  check(Boolean(ids.gestor && ids.super_admin && ids.cedente && ids.sacado), 'perfis obrigatorios presentes', ids)
  if (failures.length) throw new Error('Massa de perfis incompleta.')
  for (const id of new Set([ids.gestor, ids.super_admin])) await db.query('DELETE FROM public.usuario_fundos WHERE usuario_id=$1 AND fundo_id=ANY($2)', [id, [dataset.mainFund.id,dataset.adversarialFund.id]])
  await db.query(`INSERT INTO public.usuario_fundos(id,usuario_id,fundo_id,perfil_no_fundo,status,principal) VALUES(gen_random_uuid(),$1,$2,'gestor','ativo',false)`, [ids.gestor,dataset.mainFund.id])
  await actor(ids.gestor)
  check(await visible('exposicao_execucoes', dataset.mainFund.id) > 0, 'Gestor A le fundo A')
  check(await visible('exposicao_execucoes', dataset.adversarialFund.id) === 0, 'Gestor A nao le fundo B')
  await db.query('RESET ROLE')
  await db.query('DELETE FROM public.usuario_fundos WHERE usuario_id=$1', [ids.gestor])
  await db.query(`INSERT INTO public.usuario_fundos(id,usuario_id,fundo_id,perfil_no_fundo,status,principal) VALUES(gen_random_uuid(),$1,$2,'gestor','ativo',false)`, [ids.gestor,dataset.adversarialFund.id])
  await actor(ids.gestor)
  check(await visible('exposicao_execucoes', dataset.mainFund.id) === 0, 'Gestor B nao cruza para fundo A')
  await actor(ids.super_admin)
  check(await visible('exposicao_execucoes', dataset.mainFund.id) === 0, 'Super Admin puro sem acesso operacional')
  await db.query('RESET ROLE')
  await db.query(`INSERT INTO public.usuario_fundos(id,usuario_id,fundo_id,perfil_no_fundo,status,principal) VALUES(gen_random_uuid(),$1,$2,'gestor','ativo',false)`, [ids.super_admin,dataset.mainFund.id])
  await actor(ids.super_admin)
  check(await visible('exposicao_execucoes', dataset.mainFund.id) > 0, 'Hibrido com vinculo le fundo A')
  check(await visible('exposicao_execucoes', dataset.adversarialFund.id) === 0, 'Hibrido nao cruza fundo')
  for (const [label,id] of [['Cedente',ids.cedente],['Consultor',ids.consultor || '00000000-0000-0000-0000-000000000099'],['Sacado',ids.sacado]]) {
    await actor(id); check(await visible('exposicao_execucoes', dataset.mainFund.id) === 0, `${label} sem visao global`)
  }
  await actor('00000000-0000-0000-0000-000000000000','anon')
  await deny('Anon sem SELECT', () => db.query('SELECT count(*) FROM public.exposicao_execucoes'))
  await db.query('RESET ROLE')
  await db.query('DELETE FROM public.usuario_fundos WHERE usuario_id=$1', [ids.gestor])
  await db.query(`INSERT INTO public.usuario_fundos(id,usuario_id,fundo_id,perfil_no_fundo,status,principal) VALUES(gen_random_uuid(),$1,$2,'gestor','ativo',false)`, [ids.gestor,dataset.mainFund.id])
  await actor(ids.gestor)
  await deny('Gestor nao insere execucao', () => db.query('INSERT INTO public.exposicao_execucoes DEFAULT VALUES'))
  await deny('Gestor nao altera historico', () => db.query(`UPDATE public.exposicao_execucoes SET status='NAO_APLICAVEL' WHERE fundo_id=$1`, [dataset.mainFund.id]))
  await deny('Gestor nao exclui historico', () => db.query(`DELETE FROM public.exposicao_execucoes WHERE fundo_id=$1`, [dataset.mainFund.id]))
  await deny('Gestor nao executa RPC interna', () => db.query(`SELECT public.persistir_exposicao_execucao('{}'::jsonb)`))
  await db.query('ROLLBACK')
  if (failures.length) throw new Error(`P2.5 security falhou em ${failures.length} de ${checks} verificacoes.`)
  console.log(`P2.5 security aprovado: ${checks} verificacoes; mutacoes revertidas.`)
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  for (const failure of failures) console.error(`- ${failure.label}: ${JSON.stringify(failure.details)}`)
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1
} finally { await db.end().catch(() => undefined) }
