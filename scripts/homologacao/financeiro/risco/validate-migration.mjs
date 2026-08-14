import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertHomologEnvironment, connectDb, loadHomologEnv, parseArgs } from '../../rlx-golden/helpers.mjs'

const migrationPath = resolve('supabase/migrations/20260814230000_p2_6_gate_risco_decisao_operacional.sql')
const migrationSql = readFileSync(migrationPath, 'utf8')
  .replace(/^\s*BEGIN\s*;/i, '')
  .replace(/\s*COMMIT\s*;\s*$/i, '')

loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'p26_validate_migration')

try {
  const applied = await db.query("select to_regclass('public.risco_execucoes') is not null applied")
  await db.query('BEGIN')
  if (!applied.rows[0].applied) await db.query(migrationSql)
  const gate = await db.query(`select
    to_regclass('public.risco_execucoes') is not null execucoes,
    to_regclass('public.risco_motivos') is not null motivos,
    to_regclass('public.risco_revisoes') is not null revisoes,
    to_regprocedure('public.persistir_risco_execucao(jsonb)') is not null persistencia,
    to_regprocedure('public.simular_memoria_financeira_operacao(uuid,numeric)') is not null simulacao,
    to_regprocedure('public.decidir_revisao_risco(uuid,text,text,uuid)') is not null revisao,
    to_regprocedure('public.aprovar_operacao_com_risco_atomica(uuid,numeric,uuid,text)') is not null aprovacao,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='politica_operacional_versoes' and column_name='gate_risco_ativo') politica`)
  if (!Object.values(gate.rows[0]).every(Boolean)) throw new Error('A migration P2.6 nao criou todos os objetos esperados.')
  console.log(JSON.stringify({ projeto: env.projectRef, migration: 'P2.6', ja_aplicada: applied.rows[0].applied, transacional: true, ...gate.rows[0] }))
} finally {
  await db.query('ROLLBACK').catch(() => undefined)
  await db.end().catch(() => undefined)
}
