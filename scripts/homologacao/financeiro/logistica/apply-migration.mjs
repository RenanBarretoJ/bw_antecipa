import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertHomologEnvironment, assertMutation, connectDb, loadHomologEnv, mutationConfirmation, parseArgs } from '../../rlx-golden/helpers.mjs'

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const action = 'APPLY_P24'
if (!assertMutation(args, action, env.projectRef)) {
  console.log(`Preview seguro. Para aplicar: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation(action, env.projectRef)}`)
  process.exit(0)
}
const db = await connectDb(env, 'p24_apply_migration')
try {
  const existing = await db.query("select to_regclass('public.posicao_logistica_execucoes') is not null as applied")
  if (!existing.rows[0].applied) {
    await db.query(readFileSync(resolve('supabase/migrations/20260814164101_p2_4_posicao_logistica_rlx.sql'), 'utf8'))
  }
  const precision = await db.query(`select bool_and(numeric_scale=4) ok from information_schema.columns
    where table_schema='public' and table_name=any(array['posicao_logistica_execucoes','posicao_logistica_resultados'])
      and column_name like 'valor_%'`)
  if (!precision.rows[0].ok) {
    await db.query(readFileSync(resolve('supabase/migrations/20260814170500_p2_4_precisao_valores_logisticos.sql'), 'utf8'))
  }
  const gate = await db.query(`select
    to_regprocedure('public.persistir_posicao_logistica_execucao(jsonb)') is not null
    and (select bool_and(numeric_scale=4) from information_schema.columns
      where table_schema='public' and table_name=any(array['posicao_logistica_execucoes','posicao_logistica_resultados'])
        and column_name like 'valor_%') as ok`)
  if (!gate.rows[0].ok) throw new Error('A migration terminou sem criar a RPC P2.4.')
  console.log(`Migration P2.4 aplicada e verificada em homologacao (${env.projectRef}).`)
} finally {
  await db.end().catch(() => undefined)
}
