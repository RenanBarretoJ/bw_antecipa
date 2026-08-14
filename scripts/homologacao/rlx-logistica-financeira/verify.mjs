import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertHomologEnvironment, connectDb, loadHomologEnv, parseArgs } from '../rlx-golden/helpers.mjs'
import { buildGoldenV2 } from '../rlx-golden-v2/scenario-definitions.mjs'

loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'p24_verify_read_only')
const dataset = buildGoldenV2()
const expected = JSON.parse(readFileSync(resolve('scripts/homologacao/rlx-golden-v2/fixtures/expected/expected-logistics.json'), 'utf8'))
const failures = []
let checks = 0
const check = (condition, label, details) => { checks += 1; if (!condition) failures.push({ label, details }) }

try {
  await db.query('BEGIN READ ONLY')
  const schema = await db.query(`select
    to_regclass('public.rlx_posicao_logistica_execucoes') is not null as execucoes,
    to_regclass('public.rlx_posicao_logistica_resultados') is not null as resultados,
    to_regprocedure('public.rlx_persistir_posicao_logistica_execucao(jsonb)') is not null as rpc,
    (select numeric_scale = 4 from information_schema.columns
      where table_schema='public' and table_name='rlx_posicao_logistica_execucoes'
        and column_name='valor_total_aquisicao') as escala_execucao,
    (select numeric_scale = 4 from information_schema.columns
      where table_schema='public' and table_name='rlx_posicao_logistica_resultados'
        and column_name='valor_aquisicao') as escala_resultado`)
  check(Object.values(schema.rows[0]).every(Boolean), 'schema P2.4 completo', schema.rows[0])
  const immutableTriggers = await db.query(`select tgname from pg_trigger
    where tgrelid=any($1::regclass[]) and not tgisinternal
      and tgname=any($2)`, [
    ['public.rlx_posicao_logistica_execucoes', 'public.rlx_posicao_logistica_resultados'],
    ['rlx_posicao_logistica_execucoes_imutaveis', 'rlx_posicao_logistica_resultados_imutaveis'],
  ])
  check(immutableTriggers.rowCount === 2, 'triggers de imutabilidade presentes', immutableTriggers.rows)
  const security = await db.query(`select c.relname,c.relrowsecurity,
    (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname and p.cmd='SELECT')::int policies
    from pg_class c where c.relnamespace='public'::regnamespace and c.relname=any($1)`, [['rlx_posicao_logistica_execucoes', 'rlx_posicao_logistica_resultados']])
  check(security.rows.length === 2 && security.rows.every((row) => row.relrowsecurity && row.policies === 1), 'RLS e policies de leitura', security.rows)
  const execution = await db.query(`select * from public.rlx_posicao_logistica_execucoes
    where fundo_id=$1 and data_referencia=$2 order by created_at desc limit 1`, [dataset.mainFund.id, dataset.dates['D-1']])
  check(execution.rowCount === 1, 'execucao corrente P2.4 existe', execution.rows)
  if (execution.rowCount) {
    const row = execution.rows[0]
    const sources = await db.query(`select
      i.id is not null and i.fundo_id=$1 and i.data_referencia=$2 and i.tipo_base='ESTOQUE' and i.status='PUBLICADA' as estoque_valido,
      m.id is not null and m.fundo_id=$1 and m.data_referencia=$2 and m.status='CONCLUIDA'
        and i.id=any(m.input_import_ids) as matching_valido
      from public.rlx_posicao_logistica_execucoes e
      left join public.rlx_importacoes_financeiras i on i.id=e.estoque_importacao_id
      left join public.rlx_matching_execucoes m on m.id=e.matching_execucao_id
      where e.id=$3`, [dataset.mainFund.id, dataset.dates['D-1'], row.id])
    check(sources.rowCount === 1 && Object.values(sources.rows[0]).every(Boolean), 'fontes exatas publicadas e concluidas', sources.rows)
    const totals = await db.query(`select count(*)::int total,
      count(*) filter(where status_vinculo='MATCHED_FINANCEIRO_NF')::int matched,
      count(*) filter(where status_vinculo='SEM_MATCH_FINANCEIRO_NF')::int sem_match,
      sum(valor_aquisicao) valor_total,
      count(*) filter(where valor_aquisicao is null)::int valor_ausente
      from public.rlx_posicao_logistica_resultados where execucao_id=$1`, [row.id])
    check(totals.rows[0].total === row.total_posicoes, 'quantidades fecham com snapshot', { execution: row, actual: totals.rows[0] })
    check(totals.rows[0].matched + totals.rows[0].sem_match === totals.rows[0].total, 'matched e sem match fecham total', totals.rows[0])
    check(String(totals.rows[0].valor_total) === String(row.valor_total_aquisicao), 'valor de aquisicao fecha sem coalescer nulos', totals.rows[0])
    const lineage = await db.query(`select count(*)::int invalidos from public.rlx_posicao_logistica_resultados r
      join public.rlx_matching_resultados m on m.id=r.matching_resultado_id
      left join public.notas_fiscais nf on nf.id=r.nota_fiscal_id
      where r.execucao_id=$1 and (m.execucao_id<>$2 or m.fundo_id<>r.fundo_id or m.status<>r.matching_status
        or m.metodo<>r.matching_metodo or (nf.id is not null and nf.fundo_id<>r.fundo_id))`, [row.id, row.matching_execucao_id])
    check(lineage.rows[0].invalidos === 0, 'linhagem P2.3/NF e cross-fund coerentes', lineage.rows[0])
  }
  const actual = await db.query(`select nf.id::text nota_fiscal_id,
    case when exists(select 1 from public.nota_fiscal_entregas e join public.canhotos c on c.nota_fiscal_entrega_id=e.id where e.nota_fiscal_id=nf.id and c.documento_versao_aprovada_id is not null)
      then 'ENTREGUE'
      when exists(select 1 from public.cte_notas_fiscais cn join public.ctes c on c.id=cn.cte_id where cn.nota_fiscal_id=nf.id and c.fundo_id=nf.fundo_id and c.documento_versao_aprovada_id is not null)
      then 'EM_TRANSITO' else 'INDETERMINADA' end status
    from public.notas_fiscais nf where nf.id=any($1)`, [expected.cases.map((item) => item.nota_fiscal_id)])
  const actualByNote = new Map(actual.rows.map((row) => [row.nota_fiscal_id, row.status]))
  check(expected.cases.every((item) => actualByNote.get(item.nota_fiscal_id) === item.expected_descriptive_status), 'expected-logistics x evidencia canonica = 100%', { expected: expected.cases, actual: actual.rows })
  const intradayColumns = await db.query(`select column_name from information_schema.columns
    where table_schema='public' and table_name='rlx_posicao_logistica_resultados'
      and column_name in ('operacao_id','operacao_nf_id','overlay_intraday_id')`)
  check(intradayColumns.rowCount === 0, 'operacoes D0 permanecem fora do modelo P2.4', intradayColumns.rows)
  const history = await db.query(`select fundo_id,assinatura_execucao,count(*)::int total from public.rlx_posicao_logistica_execucoes group by fundo_id,assinatura_execucao having count(*)>1`)
  check(history.rowCount === 0, 'assinatura garante idempotencia', history.rows)
  const forbidden = await db.query(`select table_name,column_name from information_schema.columns where table_schema='public'
    and table_name=any($1) and column_name in ('status_logistico','logistics_status')`, [['rlx_estoque_posicoes','rlx_aquisicao_movimentos','rlx_liquidacao_movimentos']])
  check(forbidden.rowCount === 0, 'P2.2 permanece imutavel', forbidden.rows)
  await db.query('ROLLBACK')
  if (failures.length) {
    for (const failure of failures) console.error(`- ${failure.label}: ${JSON.stringify(failure.details)}`)
    throw new Error(`P2.4 falhou em ${failures.length} de ${checks} verificacoes.`)
  }
  console.log(`P2.4 aprovado: ${checks} verificacoes read-only; expected-logistics 100%.`)
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally { await db.end().catch(() => undefined) }
