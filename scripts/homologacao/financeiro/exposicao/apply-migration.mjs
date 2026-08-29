import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertHomologEnvironment, assertMutation, connectDb, loadHomologEnv, mutationConfirmation, parseArgs } from '../../rlx-golden/helpers.mjs'

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const action = 'APPLY_P25'
if (!assertMutation(args, action, env.projectRef)) {
  console.log(`Preview seguro. Para aplicar: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation(action, env.projectRef)}`)
  process.exit(0)
}
const db = await connectDb(env, 'p25_apply_migration')
try {
  const existing = await db.query("select to_regclass('public.exposicao_execucoes') is not null applied")
  if (!existing.rows[0].applied) await db.query(readFileSync(resolve('supabase/migrations/20260814213000_p2_5_exposicao_pl_overlay.sql'), 'utf8'))
  await db.query(readFileSync(resolve('supabase/migrations/20260814214500_p2_5_politica_exposicao_imutavel.sql'), 'utf8'))
  const gate = await db.query("select to_regprocedure('public.persistir_exposicao_execucao(jsonb)') is not null ok")
  if (!gate.rows[0].ok) throw new Error('A migration terminou sem criar a RPC P2.5.')
  console.log(`Migration P2.5 aplicada e verificada em homologacao (${env.projectRef}).`)
} finally { await db.end().catch(() => undefined) }
