import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertHomologEnvironment, connectDb, loadHomologEnv, parseArgs } from '../rlx-golden/helpers.mjs'
import { FIXTURES_ROOT, buildManifest } from './fixtures.mjs'
import { BUSINESS_DATES, PROVIDER, buildGoldenV2 } from './scenario-definitions.mjs'

const dataset = buildGoldenV2()
const expectedMatching = JSON.parse(readFileSync(resolve(FIXTURES_ROOT, 'expected/expected-matching.json'), 'utf8'))
const expectedRecon = JSON.parse(readFileSync(resolve(FIXTURES_ROOT, 'expected/expected-reconciliation.json'), 'utf8'))
const expectedLifecycle = JSON.parse(readFileSync(resolve(FIXTURES_ROOT, 'expected/expected-import-lifecycle.json'), 'utf8'))
const failures = []
let checks = 0
const check = (condition, label, details = null) => { checks += 1; if (!condition) failures.push({ label, details }) }
const normalize = (value) => value === null || value === undefined ? null : String(value)

loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'rlx_v2_verify')

async function latestExecutions(table) {
  const result = await db.query(`SELECT * FROM public.${table} WHERE fundo_id=$1 AND data_referencia=$2 ORDER BY created_at DESC LIMIT 2`, [dataset.mainFund.id, BUSINESS_DATES['D-1']])
  return result.rows
}

try {
  await db.query('BEGIN READ ONLY')
  check(JSON.stringify(BUSINESS_DATES) === JSON.stringify({ 'D-1': '2026-08-07', 'D-2': '2026-08-06', 'D-3': '2026-08-05', 'D-4': '2026-08-04' }), 'calendario ANBIMA congelado')
  check(buildManifest(dataset).counts.notes === 110, 'massa contem 110 NFs')

  const namespace = await db.query(`SELECT
    (SELECT count(*)::int FROM public.fundos WHERE id=ANY($1)) AS fundos,
    (SELECT count(*)::int FROM public.notas_fiscais WHERE id=ANY($2)) AS notas`, [dataset.funds.map((item) => item.id), dataset.notes.map((item) => item.id)])
  check(namespace.rows[0].fundos === 2, 'dois fundos V2 exclusivos persistidos', namespace.rows[0])
  check(namespace.rows[0].notas === 110, '110 NFs V2 persistidas', namespace.rows[0])

  const operational = await db.query(`SELECT
    (SELECT count(*)::int FROM public.politicas_operacionais WHERE id=ANY($1)) AS politicas,
    (SELECT count(*)::int FROM public.politica_operacional_versoes WHERE id=ANY($2) AND status::text='publicada') AS versoes_publicadas,
    (SELECT count(*)::int FROM public.documentos_repositorio WHERE id=ANY($3)) AS boletos,
    (SELECT count(*)::int FROM public.operacoes WHERE id=ANY($4) AND status::text='aprovada') AS operacoes_d0,
    (SELECT count(*)::int FROM public.operacao_calculo_nfs WHERE operacao_id=ANY($4)) AS memorias,
    (SELECT count(*)::int FROM public.nota_fiscal_entregas WHERE operacao_id=ANY($4)) AS entregas`, [
    dataset.funds.map((item) => item.policyId), dataset.funds.map((item) => item.policyVersionId),
    dataset.boletoDocuments.map((item) => item.id), dataset.operations.map((item) => item.id),
  ])
  check(operational.rows[0].politicas === 2, 'duas politicas V2 isoladas', operational.rows[0])
  check(operational.rows[0].versoes_publicadas === 2, 'duas versoes de politica publicadas', operational.rows[0])
  check(operational.rows[0].boletos === 110, '110 boletos/duplicatas digitais como lastro', operational.rows[0])
  check(operational.rows[0].operacoes_d0 === 10, '10 operacoes intraday D0 aprovadas', operational.rows[0])
  check(operational.rows[0].memorias === 10, '10 memorias financeiras canonicas', operational.rows[0])
  check(operational.rows[0].entregas === 10, '10 estados logisticos descritivos', operational.rows[0])
  const logistics = await db.query(`SELECT status_entrega::text,count(*)::int quantidade FROM public.nota_fiscal_entregas WHERE operacao_id=ANY($1) GROUP BY status_entrega`, [dataset.operations.map((item) => item.id)])
  const logisticsCounts = new Map(logistics.rows.map((item) => [item.status_entrega, item.quantidade]))
  check((logisticsCounts.get('entregue') || 0) > 0, 'logistica preserva ENTREGUE', logistics.rows)
  check((logisticsCounts.get('em_transito') || 0) > 0, 'logistica preserva EM_TRANSITO', logistics.rows)
  check((logisticsCounts.get('aguardando_validacao') || 0) > 0, 'logistica preserva INDETERMINADA descritiva', logistics.rows)

  const matchingExecs = await latestExecutions('rlx_matching_execucoes')
  const reconExecs = await latestExecutions('rlx_conciliacao_execucoes')
  check(matchingExecs.length === 2, 'duas execucoes historicas de matching A/B', matchingExecs.map((item) => item.id))
  check(reconExecs.length === 2, 'duas execucoes historicas de conciliacao A/B', reconExecs.map((item) => item.id))
  if (matchingExecs.length < 2 || reconExecs.length < 2) throw new Error('Execute as fases A e B antes da verificacao.')
  const [matchingB, matchingA] = matchingExecs
  const [reconB, reconA] = reconExecs
  check(matchingA.assinatura_execucao !== matchingB.assinatura_execucao, 'retificacao produz nova assinatura de matching')
  check(reconA.assinatura_execucao !== reconB.assinatura_execucao, 'retificacao produz nova assinatura de conciliacao')
  check(JSON.stringify(matchingA.input_import_ids) !== JSON.stringify(matchingB.input_import_ids), 'execucao A preserva inputs anteriores')

  const verifyMatchingPhase = async (execution, phase) => {
    const matchingRows = await db.query(`SELECT r.*,count(c.id)::int AS candidate_rows
    FROM public.rlx_matching_resultados r LEFT JOIN public.rlx_matching_candidatos c ON c.matching_resultado_id=r.id
    WHERE r.execucao_id=$1 GROUP BY r.id`, [execution.id])
    for (const expected of expectedMatching.cases.filter((item) => item.fund_id === dataset.mainFund.id)) {
      const actual = matchingRows.rows.filter((item) => item.origem_registro === expected.origin && normalize(item.identidade_externa) === expected.external_identity)
      check(actual.length === expected.expected_occurrences, `matching ${phase}/${expected.scenario_id}: ocorrencias`, { expected: expected.expected_occurrences, actual: actual.length })
      for (const row of actual) {
        check(row.status === expected.expected_status, `matching ${phase}/${expected.scenario_id}: status`, row.status)
        check(row.metodo === expected[`expected_method_phase_${phase.toLowerCase()}`], `matching ${phase}/${expected.scenario_id}: metodo`, row.metodo)
        check(normalize(row.nota_fiscal_id) === expected.expected_nf_id, `matching ${phase}/${expected.scenario_id}: NF`, row.nota_fiscal_id)
        check(Number(row.candidate_count) === expected.expected_candidate_count, `matching ${phase}/${expected.scenario_id}: candidatos`, row.candidate_count)
      }
    }
  }
  await verifyMatchingPhase(matchingA, 'A')
  await verifyMatchingPhase(matchingB, 'B')

  const stockCoverage = await db.query(`SELECT
    count(*)::int AS total,
    coalesce(sum(valor_referencia),0)::numeric AS valor_total,
    count(*) FILTER (WHERE status='MATCH_FORTE')::int AS matched,
    coalesce(sum(valor_referencia) FILTER (WHERE status='MATCH_FORTE'),0)::numeric AS valor_matched,
    count(*) FILTER (WHERE status='AMBIGUO')::int AS ambiguos,
    coalesce(sum(valor_referencia) FILTER (WHERE status='AMBIGUO'),0)::numeric AS valor_ambiguo,
    count(*) FILTER (WHERE status='NAO_CONCILIADO')::int AS nao_conciliados,
    coalesce(sum(valor_referencia) FILTER (WHERE status='NAO_CONCILIADO'),0)::numeric AS valor_nao_conciliado,
    count(*) FILTER (WHERE status='CONFLITO')::int AS conflitos,
    coalesce(sum(valor_referencia) FILTER (WHERE status='CONFLITO'),0)::numeric AS valor_conflito
    FROM public.rlx_matching_resultados WHERE execucao_id=$1 AND origem_registro='ESTOQUE'`, [matchingB.id])
  const actualCoverage = stockCoverage.rows[0]
  const expectedCoverage = expectedMatching.stock_d1_aggregates
  const decimalEqual = (left, right) => Math.abs(Number(left) - Number(right)) < 0.005
  check(actualCoverage.total === expectedCoverage.estoque_d1_count, 'cobertura estoque D-1: quantidade total', actualCoverage)
  check(decimalEqual(actualCoverage.valor_total, expectedCoverage.estoque_d1_valor_aquisicao), 'cobertura estoque D-1: valor total', actualCoverage)
  check(actualCoverage.matched === expectedCoverage.matched_count, 'cobertura estoque D-1: matched count', actualCoverage)
  check(decimalEqual(actualCoverage.valor_matched, expectedCoverage.matched_valor), 'cobertura estoque D-1: matched valor', actualCoverage)
  check(actualCoverage.ambiguos === expectedCoverage.ambiguo_count, 'cobertura estoque D-1: ambiguos', actualCoverage)
  check(actualCoverage.nao_conciliados === expectedCoverage.nao_conciliado_count, 'cobertura estoque D-1: nao conciliados', actualCoverage)
  check(actualCoverage.conflitos === expectedCoverage.conflito_count, 'cobertura estoque D-1: conflitos', actualCoverage)
  check(Number(((actualCoverage.matched / actualCoverage.total) * 100).toFixed(4)) === expectedCoverage.coverage_percent, 'cobertura estoque D-1: percentual por quantidade', actualCoverage)
  check(Number(((Number(actualCoverage.valor_matched) / Number(actualCoverage.valor_total)) * 100).toFixed(4)) === expectedCoverage.coverage_value_percent, 'cobertura estoque D-1: percentual por valor', actualCoverage)

  const reconRows = await db.query(`SELECT * FROM public.rlx_conciliacao_resultados WHERE execucao_id=$1`, [reconB.id])
  for (const expected of expectedRecon.cases) {
    const actual = reconRows.rows.find((item) => normalize(item.identidade_externa) === expected.external_identity)
    check(Boolean(actual), `conciliacao ${expected.scenario_id}: resultado existe`)
    if (!actual) continue
    check(actual.status === expected.expected_status, `conciliacao ${expected.scenario_id}: status`, actual.status)
    for (const [field, value] of Object.entries(expected.expected_values)) check(actual[field] === value, `conciliacao ${expected.scenario_id}: ${field}`, actual[field])
  }
  check(!reconRows.rows.some((item) => /^(RETIFICACAO_|DIA_SEM_|ARQUIVO_DUPLICADO)/.test(item.status)), 'status de importacao nao contamina titulo')

  const imports = await db.query(`SELECT id,fundo_id,tipo_base,data_referencia::text,status,completude,hash_conteudo,substitui_importacao_id,storage_bucket,storage_path
    FROM public.rlx_importacoes_financeiras WHERE fundo_id=ANY($1) AND provedor=$2 ORDER BY tipo_base,data_referencia,created_at`, [dataset.funds.map((item) => item.id), PROVIDER])
  const d1Stock = imports.rows.filter((item) => item.tipo_base === 'ESTOQUE' && item.data_referencia === BUSINESS_DATES['D-1'] && item.fundo_id !== dataset.adversarialFund.id)
  check(d1Stock.length >= 2 && d1Stock.some((item) => item.substitui_importacao_id), 'estoque D-1 possui retificacao encadeada')
  const d1Acq = imports.rows.filter((item) => item.tipo_base === 'AQUISICOES' && item.data_referencia === BUSINESS_DATES['D-1'])
  check(d1Acq.length >= 2 && d1Acq.some((item) => item.substitui_importacao_id), 'aquisicoes D-1 possui retificacao encadeada')
  for (const item of expectedLifecycle.complete_empty) {
    check(imports.rows.some((row) => row.tipo_base === item.type && row.data_referencia === item.date && row.completude === 'COMPLETO_VAZIO'), `base vazia explicita ${item.day}/${item.type}`)
  }
  check(new Set(imports.rows.map((item) => `${item.fundo_id}:${item.tipo_base}:${item.data_referencia}:${item.hash_conteudo}`)).size === imports.rows.length, 'hash duplicado nao cria segunda importacao')
  check(reconA.id !== reconB.id && matchingA.id !== matchingB.id, 'historico A permanece imutavel apos B')

  await db.query('ROLLBACK')
  if (failures.length) {
    console.error(`Golden V2 falhou: ${failures.length}/${checks} verificacoes.`)
    for (const failure of failures) console.error(`- ${failure.label}: ${JSON.stringify(failure.details)}`)
    process.exitCode = 1
  } else console.log(`Golden V2 aprovado: ${checks}/${checks} verificacoes e cobertura esperada 100%.`)
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  console.error(`Verify Golden V2 falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally { await db.end().catch(() => undefined) }
