import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertHomologEnvironment, connectDb, loadHomologEnv, parseArgs } from '../rlx-golden/helpers.mjs'

loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'p24_validate_migration')
try {
  await db.query('BEGIN')
  const existing = await db.query("select to_regclass('public.rlx_posicao_logistica_execucoes') is not null applied")
  if (!existing.rows[0].applied) {
    await db.query(readFileSync(resolve('supabase/migrations/20260814164101_p2_4_posicao_logistica_rlx.sql'), 'utf8'))
  }
  await db.query(readFileSync(resolve('supabase/migrations/20260814170500_p2_4_precisao_valores_logisticos.sql'), 'utf8'))
  const gate = await db.query(`select
    to_regclass('public.rlx_posicao_logistica_execucoes') is not null as execucoes,
    to_regclass('public.rlx_posicao_logistica_resultados') is not null as resultados,
    to_regprocedure('public.rlx_persistir_posicao_logistica_execucao(jsonb)') is not null as rpc,
    (select bool_and(numeric_scale=4) from information_schema.columns
      where table_schema='public' and table_name=any(array['rlx_posicao_logistica_execucoes','rlx_posicao_logistica_resultados'])
        and column_name like 'valor_%') as escala_quatro`)
  if (!Object.values(gate.rows[0]).every(Boolean)) throw new Error('A migration P2.4 nao criou todos os objetos esperados.')
  console.log(JSON.stringify({ projeto: env.projectRef, migration: 'P2.4', transacional: true, ...gate.rows[0] }))
} finally {
  await db.query('ROLLBACK').catch(() => undefined)
  await db.end().catch(() => undefined)
}
