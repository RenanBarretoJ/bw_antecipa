import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertHomologEnvironment, assertMutation, connectDb, loadHomologEnv, mutationConfirmation, parseArgs } from '../rlx-golden/helpers.mjs'

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const action = 'APPLY_BOOTSTRAP_FUNDO_VIRGEM'
if (!assertMutation(args, action, env.projectRef)) {
  console.log(`Preview seguro. Para aplicar: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation(action, env.projectRef)}`)
  process.exit(0)
}

// Todos os 4 arquivos sao seguros de reexecutar incondicionalmente: toda
// CREATE OR REPLACE FUNCTION e idempotente por natureza, todo ADD COLUMN usa
// IF NOT EXISTS, e toda ADD CONSTRAINT e precedida de DROP CONSTRAINT IF
// EXISTS. Reexecutar sempre (em vez de pular com base num marcador fraco,
// como uma funcao existir) e deliberado -- um marcador fraco ja mascarou uma
// reversao parcial real: um sync automatico de migrations disparado por
// push (supabase_migrations.schema_migrations) reaplicou 20260820180000 e
// falhou ao tentar 20260821000000 (a ADD CONSTRAINT sem DROP IF EXISTS,
// corrigida aqui), revertendo silenciosamente persistir_matching_execucao
// para a versao sem bootstrap enquanto o restante do schema permanecia
// intacto. Reexecutar tudo aqui corrige e nunca mais depende do marcador.
const db = await connectDb(env, 'bootstrap_fundo_virgem_apply')
try {
  await db.query(readFileSync(resolve('supabase/migrations/20260821000000_bootstrap_fundo_virgem_carteira_qa.sql'), 'utf8'))
  await db.query(readFileSync(resolve('supabase/migrations/20260821010000_bootstrap_risco_motivos_pl_oficial_indisponivel.sql'), 'utf8'))
  await db.query(readFileSync(resolve('supabase/migrations/20260821020000_bootstrap_exposicao_flag_persistido.sql'), 'utf8'))
  await db.query(readFileSync(resolve('supabase/migrations/20260821030000_bootstrap_fundo_virgem_evidencia_economica.sql'), 'utf8'))
  const check = await db.query(`select
    to_regprocedure('private.financeiro_fundo_virgem(uuid)') is not null helper_ok,
    to_regprocedure('public.resolver_bootstrap_financeiro(uuid)') is not null resolver_ok,
    (select count(*) from information_schema.columns where table_schema='public' and table_name='matching_execucoes' and column_name='bootstrap') matching_col,
    (select count(*) from information_schema.columns where table_schema='public' and table_name='conciliacao_execucoes' and column_name='bootstrap') conciliacao_col,
    (select count(*) from information_schema.columns where table_schema='public' and table_name='posicao_logistica_execucoes' and column_name='bootstrap') logistica_col,
    (select count(*) from information_schema.columns where table_schema='public' and table_name='exposicao_execucoes' and column_name='bootstrap') exposicao_col,
    (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.risco_motivos'::regclass and conname='risco_motivos_codigo_check') motivos_check,
    (select prosrc from pg_proc where proname='financeiro_fundo_virgem') predicado_src,
    (select prosrc from pg_proc where proname='persistir_matching_execucao') matching_rpc_src`)
  const row = check.rows[0]
  const ok = row.helper_ok && row.resolver_ok && Number(row.matching_col) === 1 && Number(row.conciliacao_col) === 1
    && Number(row.logistica_col) === 1 && Number(row.exposicao_col) === 1 && row.motivos_check?.includes('PL_OFICIAL_INDISPONIVEL')
    && row.predicado_src?.includes('estoque_posicoes') && !row.predicado_src?.includes('importacoes_financeiras')
    && row.matching_rpc_src?.includes('v_bootstrap')
  if (!ok) throw new Error(`Migration terminou sem os objetos esperados: ${JSON.stringify(row)}`)
  console.log(`Migration BOOTSTRAP_FUNDO_VIRGEM aplicada e verificada em homologacao (${env.projectRef}).`)
} finally {
  await db.end().catch(() => undefined)
}
