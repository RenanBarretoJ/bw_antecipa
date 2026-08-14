import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertHomologEnvironment, assertMutation, connectDb, loadHomologEnv, mutationConfirmation, parseArgs } from '../../rlx-golden/helpers.mjs'

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const action = 'APPLY_P26'
if (!assertMutation(args, action, env.projectRef)) {
  console.log(`Preview seguro. Para aplicar: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation(action, env.projectRef)}`)
  process.exit(0)
}

const db = await connectDb(env, 'p26_apply_migration')
try {
  const existing = await db.query("select to_regclass('public.risco_execucoes') is not null applied")
  if (!existing.rows[0].applied) {
    await db.query(readFileSync(resolve('supabase/migrations/20260814230000_p2_6_gate_risco_decisao_operacional.sql'), 'utf8'))
  }
  const gate = await db.query(`select
    to_regclass('public.risco_execucoes') is not null tables_ok,
    to_regprocedure('public.aprovar_operacao_com_risco_atomica(uuid,numeric,uuid,text)') is not null approval_ok`)
  if (!Object.values(gate.rows[0]).every(Boolean)) throw new Error('A migration P2.6 terminou sem os objetos obrigatorios.')
  console.log(`Migration P2.6 aplicada e verificada em homologacao (${env.projectRef}).`)
} finally {
  await db.end().catch(() => undefined)
}
