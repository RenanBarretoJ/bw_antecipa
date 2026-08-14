import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertHomologEnvironment,
  assertMutation,
  connectDb,
  loadHomologEnv,
  mutationConfirmation,
  parseArgs,
} from '../rlx-golden/helpers.mjs'

const ACTION = 'APPLY_P251_GENERALIZACAO'
const MIGRATION = '20260814220000_p2_5_1_generalizacao_dominio_financeiro.sql'

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)

if (!assertMutation(args, ACTION, env.projectRef)) {
  console.log('Preview seguro da generalizacao estrutural financeira.')
  console.log(`Projeto: ${env.projectRef}`)
  console.log(`Para aplicar: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation(ACTION, env.projectRef)}`)
  process.exit(0)
}

const db = await connectDb(env, 'p251_apply_homolog')
try {
  const before = await db.query(`select
    (select count(*)::bigint from public.rlx_importacoes_financeiras) importacoes,
    (select count(*)::bigint from public.rlx_matching_resultados) matching,
    (select count(*)::bigint from public.rlx_conciliacao_resultados) conciliacao,
    (select count(*)::bigint from public.rlx_posicao_logistica_resultados) logistica,
    (select count(*)::bigint from public.rlx_exposicao_execucoes) exposicao`)

  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations', MIGRATION), 'utf8')
  await db.query(sql)

  const after = await db.query(`select
    (select count(*)::bigint from public.importacoes_financeiras) importacoes,
    (select count(*)::bigint from public.matching_resultados) matching,
    (select count(*)::bigint from public.conciliacao_resultados) conciliacao,
    (select count(*)::bigint from public.posicao_logistica_resultados) logistica,
    (select count(*)::bigint from public.exposicao_execucoes) exposicao,
    to_regclass('public.rlx_importacoes_financeiras') old_relation,
    to_regprocedure('public.persistir_exposicao_execucao(jsonb)')::text exposure_rpc`)

  console.log(JSON.stringify({ projectRef: env.projectRef, before: before.rows[0], after: after.rows[0] }, null, 2))
} finally {
  await db.end()
}
