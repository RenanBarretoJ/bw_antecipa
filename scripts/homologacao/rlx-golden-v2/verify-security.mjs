import { randomUUID } from 'node:crypto'
import { assertHomologEnvironment, connectDb, loadHomologEnv, parseArgs } from '../rlx-golden/helpers.mjs'
import { buildGoldenV2 } from './scenario-definitions.mjs'

const dataset = buildGoldenV2()
const tables = ['matching_execucoes','titulo_nf_vinculos','titulo_nf_vinculo_chaves','matching_resultados','matching_candidatos','conciliacao_execucoes','conciliacao_resultados']
const failures = []
let checks = 0
const check = (condition, label, details = null) => { checks += 1; if (!condition) failures.push({ label, details }) }
loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'rlx_v2_security')

try {
  await db.query('BEGIN')
  const rls = await db.query(`SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1)`, [tables])
  check(rls.rows.length === tables.length && rls.rows.every((item) => item.relrowsecurity), 'RLS ativa nas sete tabelas P2.3', rls.rows)
  const policies = await db.query(`SELECT tablename,cmd,qual FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1)`, [tables])
  check(tables.every((table) => policies.rows.some((item) => item.tablename === table && item.cmd === 'SELECT')), 'cada tabela possui policy SELECT')
  check(policies.rows.every((item) => !item.qual || String(item.qual).includes('financeiro_gestor_tem_acesso_fundo')), 'policies permanecem escopadas por fundo', policies.rows)

  const crossFund = await db.query(`SELECT fundo_id,count(*)::int AS total FROM public.matching_resultados WHERE fundo_id=ANY($1) GROUP BY fundo_id`, [dataset.funds.map((item) => item.id)])
  check(crossFund.rows.length === 2, 'caso cross-fund foi processado separadamente', crossFund.rows)
  const user = await db.query(`SELECT user_id FROM public.cedentes WHERE id=$1`, [dataset.cedents[0].id])
  await db.query('SET LOCAL ROLE authenticated')
  await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: user.rows[0].user_id, role: 'authenticated', aal: 'aal2', session_id: randomUUID() })])
  const denied = await db.query(`SELECT count(*)::int AS total FROM public.matching_resultados WHERE fundo_id=ANY($1)`, [dataset.funds.map((item) => item.id)])
  check(denied.rows[0].total === 0, 'cedente nao acessa conciliacao global')
  await db.query('RESET ROLE')
  await db.query('ROLLBACK')
  if (failures.length) {
    console.error(`Security Golden V2 falhou: ${failures.length}/${checks}.`)
    for (const item of failures) console.error(`- ${item.label}: ${JSON.stringify(item.details)}`)
    process.exitCode = 1
  } else console.log(`Security Golden V2 aprovado: ${checks}/${checks} verificacoes transacionais.`)
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  console.error(`Security Golden V2 falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally { await db.end().catch(() => undefined) }
