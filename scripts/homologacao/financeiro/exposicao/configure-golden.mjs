import { assertHomologEnvironment, assertMutation, connectDb, loadHomologEnv, mutationConfirmation, parseArgs } from '../../rlx-golden/helpers.mjs'
import { buildGoldenV2 } from '../../rlx-golden-v2/scenario-definitions.mjs'

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const action = 'CONFIGURE_P25_GOLDEN'
if (!assertMutation(args, action, env.projectRef)) {
  console.log(`Preview seguro. Para configurar: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation(action, env.projectRef)}`)
  process.exit(0)
}

// Enriquecimento exclusivo da massa sintetica: os campos P2.5 nao existiam quando
// RLX_GOLDEN_V2 foi criado. A versao deterministica original permanece publicada,
// permitindo que o verificador Golden continue provando o mesmo contrato base.
const db = await connectDb(env, 'p25_configure_golden')
const dataset = buildGoldenV2()
try {
  await db.query('BEGIN')
  await db.query(`ALTER TABLE public.politica_operacional_versoes DISABLE TRIGGER USER`)
  await db.query(`UPDATE public.politica_operacional_versoes
    SET controle_exposicao_logistica_ativo=true,
        limite_exposicao_em_transito_pct=40,
        status='publicada',
        vigente_ate=NULL,
        substituida_em=NULL,
        publicada_em=COALESCE(publicada_em,$2::timestamptz)
    WHERE id=ANY($1)`, [dataset.funds.map((fund) => fund.policyVersionId), `${dataset.dates['D-4']}T10:00:00-03:00`])
  await db.query(`UPDATE public.politica_operacional_versoes
    SET status='rascunho',publicada_em=NULL,publicada_por=NULL,vigente_ate=NULL,substituida_em=NULL
    WHERE fundo_id=ANY($1) AND id<>ALL($2)
      AND (configuracao->>'qa_p25'='RLX_EXPOSICAO_V1' OR configuracao->>'qa_p25_historico'='RLX_EXPOSICAO_V1')`, [
    dataset.funds.map((fund) => fund.id), dataset.funds.map((fund) => fund.policyVersionId),
  ])
  await db.query(`ALTER TABLE public.politica_operacional_versoes ENABLE TRIGGER USER`)
  const gate = await db.query(`SELECT count(*)::int total FROM public.politica_operacional_versoes
    WHERE id=ANY($1) AND status='publicada' AND controle_exposicao_logistica_ativo
      AND limite_exposicao_em_transito_pct=40`, [dataset.funds.map((fund) => fund.policyVersionId)])
  if (gate.rows[0].total !== dataset.funds.length) throw new Error('O enriquecimento P2.5 da massa Golden nao foi confirmado.')
  await db.query('COMMIT')
  console.log(`Golden V2 enriquecido com RLX_EXPOSICAO_V1 e limite 40% em ${env.projectRef}; versoes deterministicas preservadas.`)
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  throw error
} finally { await db.end().catch(() => undefined) }
