import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertHomologEnvironment, connectDb, loadHomologEnv, parseArgs } from '../../rlx-golden/helpers.mjs'

loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'p25_validate_migration')
try {
  await db.query('BEGIN')
  await db.query(readFileSync(resolve('supabase/migrations/20260814213000_p2_5_exposicao_pl_overlay.sql'), 'utf8'))
  await db.query(readFileSync(resolve('supabase/migrations/20260814214500_p2_5_politica_exposicao_imutavel.sql'), 'utf8'))
  const gate = await db.query(`select
    to_regclass('public.exposicao_execucoes') is not null execucoes,
    to_regclass('public.exposicao_overlay_itens') is not null overlay,
    to_regprocedure('public.persistir_exposicao_execucao(jsonb)') is not null rpc,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='politica_operacional_versoes' and column_name='controle_exposicao_logistica_ativo') politica`)
  if (!Object.values(gate.rows[0]).every(Boolean)) throw new Error('A migration P2.5 nao criou todos os objetos esperados.')
  console.log(JSON.stringify({ projeto: env.projectRef, migration: 'P2.5', transacional: true, ...gate.rows[0] }))
} finally {
  await db.query('ROLLBACK').catch(() => undefined)
  await db.end().catch(() => undefined)
}
