import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  assertHomologEnvironment,
  connectDb,
  loadHomologEnv,
  parseArgs,
} from '../../rlx-golden/helpers.mjs'

const TABLES = [
  'matching_execucoes',
  'titulo_nf_vinculos',
  'titulo_nf_vinculo_chaves',
  'matching_resultados',
  'matching_candidatos',
  'conciliacao_execucoes',
  'conciliacao_resultados',
]
const MAIN_FUND_ID = '61f02178-58af-bbfa-9a33-f97ac5b3dd96'
const OTHER_FUND_ID = 'e84fdd30-39ed-de86-292e-0d8d9d92d759'
const MATCH_METHODS = ['CHAVE_NFE', 'SEU_NUMERO', 'COMPOSTO', 'AMBIGUO', 'NAO_CONCILIADO']
const RECON_STATUSES = [
  'MANTIDO_CORRETO', 'ENTRADA_INCORPORADA', 'ENTRADA_NAO_INCORPORADA',
  'ENTRADA_SEM_AQUISICAO', 'SAIDA_REFLETIDA', 'SAIDA_NAO_REFLETIDA',
  'SAIDA_SEM_LIQUIDACAO', 'LIQUIDADO_AINDA_NO_ESTOQUE', 'DIVERGENCIA_VALOR',
  'NAO_CONCILIADO', 'BASE_INCOMPLETA', 'RETIFICACAO_ESTOQUE',
  'RETIFICACAO_AQUISICAO', 'LIQUIDACAO_REPETIDA_MESMO_DIA',
  'LIQUIDACAO_PARCIAL_SALDO', 'DIA_SEM_MOVIMENTO', 'ARQUIVO_DUPLICADO_HASH',
]

const args = parseArgs()
loadHomologEnv()
const env = assertHomologEnvironment(args)
const db = await connectDb(env, 'p23_verify_read_only')
const expectedMatching = JSON.parse(readFileSync(resolve(
  'scripts/homologacao/rlx-golden/fixtures/expected/expected-matching.json',
), 'utf8'))
const expectedReconciliation = JSON.parse(readFileSync(resolve(
  'scripts/homologacao/rlx-golden/fixtures/expected/expected-reconciliation.json',
), 'utf8'))
const failures = []
const warnings = []
let checks = 0

function check(condition, label, details) {
  checks += 1
  if (!condition) failures.push({ label, details })
}

function warn(label, details) {
  warnings.push({ label, details })
}

try {
  console.log('\nBW Antecipa - verificacao READ-ONLY P2.3 Matching/Conciliacao')
  console.log(`Projeto homolog: ${env.projectRef}`)
  await db.query('BEGIN READ ONLY')

  const schema = await db.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name=ANY($1)
  `, [TABLES])
  check(schema.rowCount === TABLES.length, 'sete tabelas P2.3 existem', schema.rows)

  const rls = await db.query(`
    SELECT relname,relrowsecurity FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relname=ANY($1) AND relkind='r'
  `, [TABLES])
  check(rls.rows.length === TABLES.length && rls.rows.every((row) => row.relrowsecurity), 'RLS habilitada nas sete tabelas', rls.rows)

  const policies = await db.query(`
    SELECT tablename,policyname,cmd,roles,qual,with_check
    FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1)
  `, [TABLES])
  check(policies.rows.length === TABLES.length, 'cada tabela possui policy operacional explicita', policies.rows)
  check(policies.rows.every((row) => row.cmd === 'SELECT'), 'usuarios comuns nao possuem policy de escrita', policies.rows)
  check(policies.rows.every((row) => String(row.qual).includes('financeiro_gestor_tem_acesso_fundo')), 'leitura exige vinculo gestor ao fundo', policies.rows)

  const grants = await db.query(`
    SELECT table_name,grantee,privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name=ANY($1)
      AND grantee IN ('anon','authenticated')
  `, [TABLES])
  check(!grants.rows.some((row) => row.privilege_type !== 'SELECT'), 'anon/authenticated nao receberam escrita direta', grants.rows)
  check(!grants.rows.some((row) => row.grantee === 'anon'), 'anon nao recebeu acesso as tabelas P2.3', grants.rows)

  const rpcGrants = await db.query(`
    SELECT routine_name,grantee,privilege_type
    FROM information_schema.role_routine_grants
    WHERE specific_schema='public'
      AND routine_name IN ('persistir_matching_execucao','persistir_conciliacao_execucao')
  `)
  check(!rpcGrants.rows.some((row) => ['PUBLIC', 'anon', 'authenticated'].includes(row.grantee)), 'persistencia automatica nao foi concedida a cliente', rpcGrants.rows)
  check(rpcGrants.rows.filter((row) => row.grantee !== 'postgres').every((row) => row.grantee === 'service_role'), 'service_role e o unico papel de aplicacao com persistencia automatica', rpcGrants.rows)

  const triggers = await db.query(`
    SELECT event_object_table,trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema='public' AND event_object_table=ANY($1)
  `, [TABLES])
  check(triggers.rows.length >= 6, 'historico e vinculos possuem triggers de imutabilidade/revogacao', triggers.rows)

  const forbidden = await db.query(`
    SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name IN ('estoque_posicoes','aquisicao_movimentos','liquidacao_movimentos')
      AND column_name IN ('nota_fiscal_id','matching_status','conciliacao_status','vinculo_id')
  `)
  check(forbidden.rowCount === 0, 'P2.3 nao alterou o canonico P2.2', forbidden.rows)

  const indexes = await db.query(`
    SELECT tablename,indexname,indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename=ANY($1)
  `, [TABLES])
  const indexText = indexes.rows.map((row) => row.indexdef).join('\n')
  check(indexText.includes('fundo_id') && indexText.includes('nota_fiscal_id'), 'indices cobrem fundo e NF', indexes.rows)
  check(indexText.includes('provedor') && indexText.includes('valor_normalizado'), 'crosswalk indexa provedor e chave no fundo', indexes.rows)

  check(expectedMatching.schema === 'rlx_expected_matching_v1', 'expected matching possui schema conhecido')
  check(expectedReconciliation.schema === 'rlx_expected_reconciliation_v1', 'expected reconciliation possui schema conhecido')
  check(expectedMatching.bigIntegerContract?.type === 'string' && expectedMatching.bigIntegerContract.sample === '900719925474099312345', 'BIGINT externo permanece textual')
  check(MATCH_METHODS.every((method) => expectedMatching.cases.some((item) => item.expectedMethod === method)), 'golden declara todos os metodos canonicos')
  check(expectedReconciliation.cases.every((item) => RECON_STATUSES.includes(item.expected)), 'motor declara todos os statuses exigidos pelo golden')

  const crossFund = await db.query(`
    SELECT fundo_id,id_recebivel,pg_typeof(id_recebivel)::text AS type
    FROM public.estoque_atual
    WHERE fundo_id=ANY($1) AND id_recebivel=$2
  `, [[MAIN_FUND_ID, OTHER_FUND_ID], expectedMatching.crossFundCollision.idRecebivel])
  check(new Set(crossFund.rows.map((row) => row.fundo_id)).size === 2, 'colisao cross-fund existe em dois escopos independentes', crossFund.rows)
  check(crossFund.rows.every((row) => row.type === 'text' && row.id_recebivel === '900719925474099312345'), 'colisao preserva BIGINT como text', crossFund.rows)

  const inputs = await db.query(`
    SELECT tipo_base,data_referencia::text,completude,status,id,substitui_importacao_id
    FROM public.importacoes_financeiras
    WHERE fundo_id=$1 AND data_referencia IN ('2026-08-08','2026-08-09')
      AND tipo_base IN ('ESTOQUE','AQUISICOES','LIQUIDACOES')
    ORDER BY data_referencia,tipo_base,publicada_em
  `, [MAIN_FUND_ID])
  const published = inputs.rows.filter((row) => row.status === 'PUBLICADA')
  check(published.some((row) => row.tipo_base === 'ESTOQUE' && row.data_referencia === '2026-08-08'), 'Estoque D-2 publicado existe')
  check(published.some((row) => row.tipo_base === 'ESTOQUE' && row.data_referencia === '2026-08-09'), 'Estoque D-1 publicado existe')
  check(published.some((row) => row.tipo_base === 'AQUISICOES' && row.data_referencia === '2026-08-09' && row.completude === 'COMPLETO_VAZIO'), 'Aquisicoes D-1 completo vazio e input explicito')
  check(published.some((row) => row.tipo_base === 'LIQUIDACOES' && row.data_referencia === '2026-08-09'), 'Liquidacoes D-1 publicada existe')
  check(published.some((row) => row.substitui_importacao_id), 'retificacao vigente preserva referencia historica', published)

  const executionCounts = await db.query(`
    SELECT
      (SELECT count(*)::integer FROM public.matching_execucoes) AS matching,
      (SELECT count(*)::integer FROM public.conciliacao_execucoes) AS conciliacao,
      (SELECT count(*)::integer FROM public.titulo_nf_vinculos WHERE origem='MANUAL') AS manuais
  `)
  const execution = executionCounts.rows[0]
  if (execution.matching > 0) {
    const history = await db.query(`
      SELECT e.id,e.input_import_ids,e.assinatura_execucao,e.status,e.total_registros,
        count(r.id)::integer AS results,
        count(r.id) FILTER (WHERE r.status='MATCH_FORTE')::integer AS matched
      FROM public.matching_execucoes e
      LEFT JOIN public.matching_resultados r ON r.execucao_id=e.id
      GROUP BY e.id
    `)
    check(history.rows.every((row) => row.input_import_ids.length > 0 && row.assinatura_execucao && row.status !== 'PROCESSANDO'), 'matching executado preserva inputs, assinatura e finalizacao', history.rows)
    check(history.rows.every((row) => row.results === row.total_registros && row.matched <= row.results), 'totais e cobertura por quantidade fecham', history.rows)
  } else {
    warn('nenhuma execucao P2.3 persistida; verificacao de resultados historicos depende do smoke Gestor', execution)
  }
  if (execution.conciliacao > 0) {
    const history = await db.query(`
      SELECT id,status,estoque_d2_importacao_id,estoque_d1_importacao_id,
        aquisicoes_d1_importacao_id,liquidacoes_d1_importacao_id,assinatura_execucao
      FROM public.conciliacao_execucoes
    `)
    check(history.rows.every((row) => row.assinatura_execucao && (row.status === 'BASE_INCOMPLETA' || (
      row.estoque_d2_importacao_id && row.estoque_d1_importacao_id && row.aquisicoes_d1_importacao_id && row.liquidacoes_d1_importacao_id
    ))), 'conciliacao historica referencia quatro inputs ou explicita BASE_INCOMPLETA', history.rows)
  }

  const nonKeyCases = expectedMatching.cases.filter((item) => item.expectedMethod !== 'CHAVE_NFE' && item.expectedNfId)
  const contradictory = await db.query(`
    SELECT e.fundo_id,e.id_recebivel,e.chave_nfe,nf.id AS nota_id
    FROM public.estoque_atual e
    JOIN public.notas_fiscais nf ON nf.fundo_id=e.fundo_id AND nf.chave_acesso=e.chave_nfe
    WHERE e.id_recebivel=ANY($1) AND e.fundo_id=ANY($2)
  `, [nonKeyCases.map((item) => item.externalTitleId), [MAIN_FUND_ID, OTHER_FUND_ID]])
  if (contradictory.rowCount > 0) {
    warn('golden P2.1 atribui metodo inferior apesar de a base publicada conter CHAVE_NFE unica; o motor preserva precedencia por evidencia', {
      total: contradictory.rowCount,
      amostra: contradictory.rows.slice(0, 3),
    })
  }

  const expectedEntrances = expectedReconciliation.cases
    .filter((item) => ['ENTRADA_INCORPORADA', 'ENTRADA_NAO_INCORPORADA'].includes(item.expected))
    .map((item) => item.externalTitleId)
  const d1Acquisitions = await db.query(`
    SELECT id_recebivel FROM public.aquisicoes_atuais
    WHERE fundo_id=$1 AND data_referencia='2026-08-09' AND id_recebivel=ANY($2)
  `, [MAIN_FUND_ID, expectedEntrances])
  if (d1Acquisitions.rowCount !== expectedEntrances.length) {
    warn('golden de reconciliacao espera entradas em 2026-08-09, mas a aquisicao publicada D-1 e COMPLETO_VAZIO', {
      expectedEntrances,
      encontrados: d1Acquisitions.rows,
    })
  }

  await db.query('ROLLBACK')
  if (warnings.length) {
    console.warn(`\nP2.3 verify registrou ${warnings.length} ressalva(s) de contrato/dados:`)
    for (const item of warnings) console.warn(`- ${item.label}: ${JSON.stringify(item.details)}`)
  }
  if (failures.length) {
    console.error(`\nP2.3 verify falhou em ${failures.length} verificacao(oes):`)
    for (const item of failures) console.error(`- ${item.label}: ${JSON.stringify(item.details)}`)
    process.exitCode = 1
  } else {
    console.log(`\nP2.3 verify aprovado: ${checks} verificacoes somente leitura; ${warnings.length} ressalva(s) documentada(s).`)
  }
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  console.error(`P2.3 verify falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await db.end().catch(() => undefined)
}
