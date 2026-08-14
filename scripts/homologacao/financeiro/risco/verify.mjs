import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertHomologEnvironment, connectDb, loadHomologEnv, parseArgs } from '../../rlx-golden/helpers.mjs'
import { buildGoldenV2 } from '../../rlx-golden-v2/scenario-definitions.mjs'

loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'p26_verify_read_only')
const dataset = buildGoldenV2()
const expected = JSON.parse(readFileSync(resolve('scripts/homologacao/rlx-golden-v2/fixtures/expected/expected-risk-gate.json'), 'utf8'))
const failures = []
let checks = 0
const check = (condition, label, details) => { checks += 1; if (!condition) failures.push({ label, details }) }

try {
  await db.query('BEGIN READ ONLY')
  const schema = await db.query(`select
    to_regclass('public.risco_execucoes') is not null execucoes,
    to_regclass('public.risco_motivos') is not null motivos,
    to_regclass('public.risco_revisoes') is not null revisoes,
    to_regprocedure('public.persistir_risco_execucao(jsonb)') is not null persistencia,
    to_regprocedure('public.aprovar_operacao_com_risco_atomica(uuid,numeric,uuid,text)') is not null aprovacao`)
  check(Object.values(schema.rows[0]).every(Boolean), 'schema P2.6 completo', schema.rows[0])
  const triggers = await db.query(`select tgname from pg_trigger where tgrelid=any($1::regclass[]) and not tgisinternal and tgname=any($2)`, [
    ['public.risco_execucoes','public.risco_motivos','public.risco_revisoes'],
    ['risco_execucoes_imutaveis','risco_motivos_imutaveis','risco_revisoes_protegidas'],
  ])
  check(triggers.rowCount === 3, 'historico e workflow protegidos', triggers.rows)
  const execution = await db.query(`select * from public.risco_execucoes where fundo_id=$1 and data_operacional=$2 and escopo='FUNDO' and origem='CENTRAL_RISCO' order by created_at desc limit 1`, [dataset.mainFund.id, dataset.baseDate])
  check(execution.rowCount === 1, 'execucao Golden P2.6 corrente existe', execution.rows)
  if (execution.rowCount) {
    const row = execution.rows[0]
    const reasons = await db.query('select codigo,severidade from public.risco_motivos where risco_execucao_id=$1 order by codigo', [row.id])
    check(row.regra_versao === 'GATE_RISCO_V1', 'versao canonica congelada', row.regra_versao)
    const expectedReasons = [expected.baseline.unmatched.expected_reason, expected.baseline.indeterminate.expected_reason]
    check(row.decisao === expected.baseline.expected_decision, 'decisao Golden expected x actual', { expected: expected.baseline.expected_decision, actual: row.decisao })
    check(expectedReasons.every((code) => reasons.rows.some((reason) => reason.codigo === code)), 'motivos cumulativos Golden preservados', reasons.rows)
  }
  const duplicates = await db.query(`select fundo_id,coalesce(operacao_id,'00000000-0000-0000-0000-000000000000'::uuid),regra_versao,assinatura_inputs,count(*)::int total
    from public.risco_execucoes group by 1,2,3,4 having count(*)>1`)
  check(duplicates.rowCount === 0, 'idempotencia por assinatura', duplicates.rows)
  check(expected.scenarios.map((scenario) => scenario.expected_decision).join(',') === 'APTO,APTO,APTO,APTO,BLOQUEADO', 'cenarios 25/37/39.8/40/42', expected.scenarios)
  await db.query('ROLLBACK')
  if (failures.length) throw new Error(`P2.6 falhou em ${failures.length} de ${checks} verificacoes.`)
  console.log(`P2.6 aprovado: ${checks} verificacoes read-only; expected-risk-gate preservado.`)
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  for (const failure of failures) console.error(`- ${failure.label}: ${JSON.stringify(failure.details)}`)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally { await db.end().catch(() => undefined) }
