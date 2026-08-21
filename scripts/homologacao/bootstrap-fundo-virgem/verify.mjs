import { assertHomologEnvironment, connectDb, loadHomologEnv, parseArgs } from '../rlx-golden/helpers.mjs'

// Verificacao read-only do fixture BOOTSTRAP_FUNDO_VIRGEM: confirma que o
// fundo QA nasceu virgem, que a Carteira QA (se ja publicada) e reconhecida
// como Carteira oficial de bootstrap, que o fundo QA sai definitivamente do
// bootstrap apos a operacao incorporada de teste (sem reentrada), e que o
// fundo real RLX FLUOROCHEMICAL -- que so tem uma declaracao_sem_movimento,
// nenhuma evidencia economica real -- e corretamente classificado como
// virgem (evidencia economica real, nao mera existencia de base publicada,
// e o que encerra o bootstrap).

loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'bootstrap_fundo_virgem_verify')
const failures = []
let checks = 0
const check = (condition, label, details) => { checks += 1; if (!condition) failures.push({ label, details }) }

try {
  await db.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false)")

  const fundo = await db.query("select id from public.fundos where nome='QA BOOTSTRAP FUNDO VIRGEM FIDC' limit 1")
  check(fundo.rows.length === 1, 'fixture do fundo QA existe', fundo.rows)
  if (fundo.rows.length === 1) {
    const fundoId = fundo.rows[0].id
    const bootstrap = await db.query('select public.resolver_bootstrap_financeiro($1) as r', [fundoId])
    const resolved = bootstrap.rows[0].r

    const incorporada = await db.query(`select o.id from public.operacoes o
      join public.cedente_fundos cf on cf.id = o.cedente_fundo_id
      where cf.fundo_id = $1 and o.status in ('em_andamento','inadimplente','liquidada') and o.cessao_efetivada_em is not null
      limit 1`, [fundoId])
    if (incorporada.rows.length > 0) {
      check(resolved.fundo_virgem === false, 'fundo QA saiu do bootstrap (definitivo, sem reentrada) apos a operacao incorporada de teste', resolved)
    } else {
      check(resolved.fundo_virgem === true, 'fundo QA continua virgem (nenhuma operacao incorporada, nenhuma evidencia economica real)', resolved)
    }

    const matching = await db.query("select status,bootstrap,total_registros from public.matching_execucoes where fundo_id=$1 order by created_at desc limit 1", [fundoId])
    if (matching.rows.length > 0) {
      check(matching.rows[0].status === 'CONCLUIDA' && matching.rows[0].bootstrap === true && Number(matching.rows[0].total_registros) === 0, 'matching de bootstrap concluiu com zero resultados', matching.rows[0])
    }
    const logistica = await db.query("select status,bootstrap,total_posicoes,estoque_importacao_id,matching_execucao_id from public.posicao_logistica_execucoes where fundo_id=$1 order by created_at desc limit 1", [fundoId])
    if (logistica.rows.length > 0) {
      check(logistica.rows[0].status === 'CONCLUIDA' && logistica.rows[0].bootstrap === true && Number(logistica.rows[0].total_posicoes) === 0
        && logistica.rows[0].estoque_importacao_id === null && logistica.rows[0].matching_execucao_id === null,
        'posicao logistica de bootstrap concluiu com zero posicoes e sem ancorar em Estoque/matching reais', logistica.rows[0])
    }
    if (resolved.fundo_virgem && resolved.carteira_oficial) {
      const exposicao = await db.query("select status,bootstrap,patrimonio_liquido_d2,classificacao_limite from public.exposicao_execucoes where fundo_id=$1 and status='CALCULADA' order by created_at desc limit 1", [fundoId])
      check(exposicao.rows.length > 0 && exposicao.rows[0].bootstrap === true && Number(exposicao.rows[0].patrimonio_liquido_d2) === Number(resolved.carteira_oficial.patrimonio_liquido),
        'exposicao CALCULADA de bootstrap usa o PL da primeira Carteira oficial', exposicao.rows[0])
    } else if (resolved.fundo_virgem && !resolved.carteira_oficial) {
      const exposicao = await db.query("select status from public.exposicao_execucoes where fundo_id=$1 order by created_at desc limit 1", [fundoId])
      check(exposicao.rows.length > 0 && exposicao.rows[0].status === 'PL_OFICIAL_INDISPONIVEL', 'sem Carteira oficial ainda -> PL_OFICIAL_INDISPONIVEL (nao AVALIACAO_RISCO_INDISPONIVEL)', exposicao.rows[0])
    } else {
      const exposicao = await db.query("select status,bootstrap from public.exposicao_execucoes where fundo_id=$1 and bootstrap=true order by created_at desc limit 1", [fundoId])
      check(exposicao.rows.length > 0 && exposicao.rows[0].status === 'CALCULADA', 'fundo nao-virgem preserva o historico CALCULADA de bootstrap anterior a incorporacao (execucao imutavel)', exposicao.rows[0])
    }
  }

  const real = await db.query("select id from public.fundos where nome ilike '%FLUOROCHEMICAL%' limit 1")
  if (real.rows.length === 1) {
    const bootstrapReal = await db.query('select public.resolver_bootstrap_financeiro($1) as r', [real.rows[0].id])
    check(bootstrapReal.rows[0].r.fundo_virgem === true, 'fundo real RLX FLUOROCHEMICAL (so declaracao_sem_movimento, nenhuma evidencia economica real) e corretamente classificado como virgem', bootstrapReal.rows[0].r)
  }

  if (failures.length) throw new Error(`BOOTSTRAP_FUNDO_VIRGEM falhou em ${failures.length} de ${checks} verificacoes.`)
  console.log(`BOOTSTRAP_FUNDO_VIRGEM aprovado: ${checks} verificacoes read-only.`)
} catch (error) {
  for (const failure of failures) console.error(`- ${failure.label}: ${JSON.stringify(failure.details)}`)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await db.end().catch(() => undefined)
}
