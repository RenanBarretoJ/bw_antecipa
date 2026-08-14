import { assertHomologEnvironment, assertMutation, connectDb, loadHomologEnv, mutationConfirmation, parseArgs } from '../../rlx-golden/helpers.mjs'
import { buildGoldenV2 } from '../../rlx-golden-v2/scenario-definitions.mjs'

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const action = 'CONFIGURE_P26_GOLDEN'
if (!assertMutation(args, action, env.projectRef)) {
  console.log(`Preview seguro. Para configurar: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation(action, env.projectRef)}`)
  process.exit(0)
}

// Enriquecimento exclusivo da massa sintetica preexistente. Em uma instalacao
// limpa, seed.mjs ja cria esses mesmos campos antes de publicar a versao.
const db = await connectDb(env, 'p26_configure_golden')
const dataset = buildGoldenV2()
try {
  await db.query('BEGIN')
  await db.query('ALTER TABLE public.politica_operacional_versoes DISABLE TRIGGER USER')
  await db.query(`update public.politica_operacional_versoes set
      controle_exposicao_logistica_ativo=true,
      limite_exposicao_em_transito_pct=40,
      gate_risco_ativo=true,
      limite_inclusivo=true,
      tratamento_pl_indisponivel='BLOQUEAR',
      tratamento_indeterminada='REVISAO_MANUAL',
      tratamento_sem_match='BLOQUEAR',
      tratamento_operacao_nao_incorporada='BLOQUEAR',
      tratamento_liquidacao_parcial='SINALIZAR'
    where id=any($1)`, [dataset.funds.map((fund) => fund.policyVersionId)])
  await db.query('ALTER TABLE public.politica_operacional_versoes ENABLE TRIGGER USER')
  const gate = await db.query(`select count(*)::int total from public.politica_operacional_versoes
    where id=any($1) and gate_risco_ativo and controle_exposicao_logistica_ativo
      and limite_inclusivo and limite_exposicao_em_transito_pct=40`, [dataset.funds.map((fund) => fund.policyVersionId)])
  if (gate.rows[0].total !== dataset.funds.length) throw new Error('O enriquecimento P2.6 da massa Golden nao foi confirmado.')
  await db.query('COMMIT')
  console.log(`Golden V2 enriquecido com GATE_RISCO_V1 em ${env.projectRef}; versoes deterministicas preservadas.`)
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  throw error
} finally { await db.end().catch(() => undefined) }
