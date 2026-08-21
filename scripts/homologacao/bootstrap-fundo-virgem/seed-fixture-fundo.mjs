import { createHash } from 'node:crypto'
import { assertHomologEnvironment, assertMutation, connectDb, loadHomologEnv, mutationConfirmation, parseArgs } from '../rlx-golden/helpers.mjs'

// Fixture de homologacao exclusiva do ticket BOOTSTRAP_FUNDO_VIRGEM: um fundo
// deliberadamente virgem (sem operacao incorporada, sem ESTOQUE/AQUISICOES/
// LIQUIDACOES jamais publicados) com uma politica minima (gate_risco_ativo,
// controle_exposicao_logistica_ativo) para permitir exercitar o gate de
// risco ponta a ponta antes e depois da primeira Carteira oficial. Nao cria
// nenhuma Carteira/PL -- isso e feito por seed-carteira-bootstrap.mjs.

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const action = 'SEED_FIXTURE_FUNDO_BOOTSTRAP'
if (!assertMutation(args, action, env.projectRef)) {
  console.log(`Preview seguro. Para criar: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation(action, env.projectRef)}`)
  process.exit(0)
}

const NOME_FUNDO = 'QA BOOTSTRAP FUNDO VIRGEM FIDC'
const db = await connectDb(env, 'bootstrap_fundo_virgem_seed_fixture')
try {
  await db.query('BEGIN')
  const existente = await db.query('select id from public.fundos where nome=$1', [NOME_FUNDO])
  if (existente.rows.length > 0) {
    console.log(JSON.stringify({ fundoId: existente.rows[0].id, existente: true }))
    await db.query('ROLLBACK')
    process.exit(0)
  }

  const fundo = await db.query(`insert into public.fundos (
      nome, cnpj, administradora_nome, administradora_cnpj, gestora_nome, gestora_cnpj, ativo
    ) values ($1, '84810000000201', 'QA ADMINISTRADORA BOOTSTRAP', '84810000000202', 'QA GESTORA BOOTSTRAP', '84810000000203', true)
    returning id`, [NOME_FUNDO])
  const fundoId = fundo.rows[0].id

  const politica = await db.query(`insert into public.politicas_operacionais (
      codigo, nome, descricao, status, created_by, fundo_id, padrao
    ) values (
      'QA_BOOTSTRAP_FUNDO_VIRGEM_NF', 'Politica QA Bootstrap Fundo Virgem',
      'Politica sintetica homolog-only para o ticket P0/P1 bootstrap fundo virgem + Carteira QA.',
      'ativa', (select id from public.profiles where role='gestor' order by id limit 1), $1, true
    ) returning id`, [fundoId])
  const politicaId = politica.rows[0].id

  const conteudoHash = createHash('sha256').update(JSON.stringify({ qa_dataset: 'BOOTSTRAP_FUNDO_VIRGEM', fundo_id: fundoId })).digest('hex')
  const versao = await db.query(`insert into public.politica_operacional_versoes (
      politica_operacional_id, fundo_id, versao, vigente_desde, aceite_sacado_obrigatorio, cessao_no_desembolso,
      cria_acompanhamento_entrega, configuracao, conteudo_hash, publicada_por, publicada_em, status,
      metodo_calculo_financeiro, controle_exposicao_logistica_ativo, limite_exposicao_em_transito_pct,
      gate_risco_ativo, limite_inclusivo, tratamento_pl_indisponivel, tratamento_indeterminada,
      tratamento_sem_match, tratamento_operacao_nao_incorporada, tratamento_liquidacao_parcial
    ) values (
      $1, $2, 1, now(), false, true, false, $3::jsonb, $4,
      (select id from public.profiles where role='gestor' order by id limit 1), now(), 'publicada',
      'DIAS_UTEIS_252', true, 40, true, true, 'BLOQUEAR', 'REVISAO_MANUAL', 'BLOQUEAR', 'BLOQUEAR', 'SINALIZAR'
    ) returning id`, [politicaId, fundoId, JSON.stringify({ qa_dataset: 'BOOTSTRAP_FUNDO_VIRGEM' }), conteudoHash])

  const check = await db.query(`select
    (select count(*) from public.operacoes o join public.cedente_fundos cf on cf.id=o.cedente_fundo_id where cf.fundo_id=$1) operacoes,
    (select count(*) from public.importacoes_financeiras i where i.fundo_id=$1) importacoes`, [fundoId])
  if (Number(check.rows[0].operacoes) !== 0 || Number(check.rows[0].importacoes) !== 0) {
    throw new Error('Fixture nao nasceu virgem -- abortando.')
  }

  await db.query('COMMIT')
  console.log(JSON.stringify({ fundoId, politicaId, politicaVersaoId: versao.rows[0].id, existente: false }))
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  throw error
} finally {
  await db.end().catch(() => undefined)
}
