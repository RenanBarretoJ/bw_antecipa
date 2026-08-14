import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Decimal from 'decimal.js'
import { assertHomologEnvironment, connectDb, loadHomologEnv, parseArgs } from '../../rlx-golden/helpers.mjs'
import { buildGoldenV2 } from '../../rlx-golden-v2/scenario-definitions.mjs'

loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'p25_verify_read_only')
const dataset = buildGoldenV2()
const expected = JSON.parse(readFileSync(resolve('scripts/homologacao/rlx-golden-v2/fixtures/expected/expected-exposure.json'), 'utf8'))
const failures = []
let checks = 0
const check = (condition, label, details) => { checks += 1; if (!condition) failures.push({ label, details }) }
const classification = (value, limit = '40') => new Decimal(value).lt(limit) ? 'ABAIXO_LIMITE' : new Decimal(value).gt(limit) ? 'ACIMA_LIMITE' : 'NO_LIMITE'

try {
  await db.query('BEGIN READ ONLY')
  const schema = await db.query(`SELECT
    to_regclass('public.exposicao_execucoes') IS NOT NULL execucoes,
    to_regclass('public.exposicao_overlay_itens') IS NOT NULL overlay,
    to_regprocedure('public.persistir_exposicao_execucao(jsonb)') IS NOT NULL rpc,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='politica_operacional_versoes' AND column_name='controle_exposicao_logistica_ativo') politica,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='exposicao_execucoes' AND column_name='percentual_exposicao' AND numeric_scale=12) percentual_decimal`)
  check(Object.values(schema.rows[0]).every(Boolean), 'schema P2.5 completo', schema.rows[0])
  const triggers = await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid=ANY($1::regclass[]) AND NOT tgisinternal AND tgname=ANY($2)`, [
    ['public.exposicao_execucoes','public.exposicao_overlay_itens'],
    ['exposicao_execucoes_imutaveis','exposicao_overlay_imutavel'],
  ])
  check(triggers.rowCount === 2, 'historico P2.5 imutavel', triggers.rows)
  const policies = await db.query(`SELECT id,controle_exposicao_logistica_ativo,limite_exposicao_em_transito_pct FROM public.politica_operacional_versoes
    WHERE fundo_id=$1 AND status='publicada' ORDER BY versao DESC LIMIT 1`, [dataset.mainFund.id])
  check(policies.rowCount === 1 && policies.rows[0].controle_exposicao_logistica_ativo && new Decimal(policies.rows[0].limite_exposicao_em_transito_pct).eq(40), 'politica Golden versionada em 40%', policies.rows)
  const execution = await db.query(`SELECT * FROM public.exposicao_execucoes WHERE fundo_id=$1 AND data_operacional=$2 ORDER BY created_at DESC LIMIT 1`, [dataset.mainFund.id, dataset.baseDate])
  check(execution.rowCount === 1, 'execucao P2.5 corrente existe', execution.rows)
  if (execution.rowCount) {
    const row = execution.rows[0]
    check(row.regra_versao === 'RLX_EXPOSICAO_V1', 'rule version congelada', row.regra_versao)
    check(String(row.data_referencia_estoque) === `${dataset.dates['D-1']} 00:00:00+00` || new Date(row.data_referencia_estoque).toISOString().slice(0,10) === dataset.dates['D-1'], 'Estoque usa D-1 ANBIMA', row.data_referencia_estoque)
    check(new Date(row.data_referencia_pl).toISOString().slice(0,10) === dataset.dates['D-2'], 'PL usa D-2 ANBIMA', row.data_referencia_pl)
    if (row.status === 'CALCULADA') {
      const lineage = await db.query(`SELECT
        p.id IS NOT NULL AND p.fundo_id=e.fundo_id AND p.data_referencia=e.data_referencia_estoque AND p.status='CONCLUIDA' posicao_ok,
        c.id IS NOT NULL AND c.fundo_id=e.fundo_id AND c.data_referencia=e.data_referencia_pl AND c.vigente carteira_ok,
        i.id IS NOT NULL AND i.status='PUBLICADA' AND i.tipo_base='CARTEIRA' AND i.completude='COMPLETO_COM_DADOS' importacao_ok
        FROM public.exposicao_execucoes e
        LEFT JOIN public.posicao_logistica_execucoes p ON p.id=e.posicao_logistica_execucao_id
        LEFT JOIN public.carteira_snapshots c ON c.id=e.carteira_snapshot_id
        LEFT JOIN public.importacoes_financeiras i ON i.id=e.carteira_importacao_id
        WHERE e.id=$1`, [row.id])
      check(Object.values(lineage.rows[0]).every(Boolean), 'linhagem P2.4 e PL D-2 exata', lineage.rows[0])
      const expectedExposure = new Decimal(row.valor_em_transito_estoque || 0).plus(row.overlay_em_transito || 0)
      check(expectedExposure.eq(row.exposicao_em_transito_total), 'numerador = estoque em transito + overlay em transito', row)
      const expectedPercent = expectedExposure.div(row.patrimonio_liquido_d2).times(100)
      check(expectedPercent.eq(row.percentual_exposicao), 'percentual Decimal fecha com PL D-2', { expected: expectedPercent.toString(), actual: row.percentual_exposicao })
      check(classification(row.percentual_exposicao, row.limite_referencia_pct) === row.classificacao_limite, 'classificacao matematica exata', row.classificacao_limite)
      const overlay = await db.query(`SELECT * FROM public.exposicao_overlay_itens WHERE execucao_id=$1`, [row.id])
      check(new Set(overlay.rows.map((item) => `${item.operacao_id}:${item.nota_fiscal_id}`)).size === overlay.rowCount, 'overlay sem duplicidade', overlay.rows)
      check(overlay.rows.every((item) => item.incluido_no_numerador === (item.motivo === 'INCLUIDA_EM_TRANSITO')), 'inclusao do overlay coerente', overlay.rows)
    }
  }
  const scenarios = expected.scenarios_percent.map((value) => ({ value, actual: classification(String(value)) }))
  const expectedClasses = ['ABAIXO_LIMITE','ABAIXO_LIMITE','ABAIXO_LIMITE','NO_LIMITE','ACIMA_LIMITE']
  check(scenarios.every((item, index) => item.actual === expectedClasses[index]), 'expected-exposure 25/37/39.8/40/42', scenarios)
  check(['39.999999999','40.000000000','40.000000001'].map((value) => classification(value)).join(',') === 'ABAIXO_LIMITE,NO_LIMITE,ACIMA_LIMITE', 'precisao sem float', null)
  const operations = await db.query(`SELECT o.id,o.status,o.cessao_efetivada_em,
    EXISTS(SELECT 1 FROM public.operacoes_nfs onf JOIN public.posicao_logistica_resultados r ON r.nota_fiscal_id=onf.nota_fiscal_id WHERE onf.operacao_id=o.id AND r.fundo_id=$2 AND r.execucao_id=$3) incorporada
    FROM public.operacoes o WHERE o.id=ANY($1)`, [dataset.operations.map((item) => item.id), dataset.mainFund.id, execution.rows[0]?.posicao_logistica_execucao_id])
  check(operations.rowCount === 10, '10 operacoes Golden D0 identificadas', operations.rows)
  check(operations.rows.filter((row) => row.incorporada).length === 1, 'cenario Golden controlado identifica incorporacao e ativa deduplicacao', operations.rows)
  check(operations.rows.every((row) => row.status === 'aprovada' && row.cessao_efetivada_em == null), 'Golden base aguarda marco economico; overlay somente apos cessao', operations.rows)
  const duplicateSignatures = await db.query(`SELECT fundo_id,assinatura_execucao,count(*)::int total FROM public.exposicao_execucoes GROUP BY fundo_id,assinatura_execucao HAVING count(*)>1`)
  check(duplicateSignatures.rowCount === 0, 'idempotencia por assinatura', duplicateSignatures.rows)
  await db.query('ROLLBACK')
  if (failures.length) throw new Error(`P2.5 falhou em ${failures.length} de ${checks} verificacoes.`)
  console.log(`P2.5 aprovado: ${checks} verificacoes read-only; expected-exposure preservado.`)
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  for (const failure of failures) console.error(`- ${failure.label}: ${JSON.stringify(failure.details)}`)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally { await db.end().catch(() => undefined) }
