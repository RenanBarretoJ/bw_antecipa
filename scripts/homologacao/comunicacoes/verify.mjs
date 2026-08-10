import {
  assertHomologEnvironment,
  connectDb,
  environmentSummary,
  loadHomologEnv,
  parseArgs,
} from '../central-logistica/helpers.mjs'

const EXPECTED_TABLES = [
  'comunicacao_configuracoes',
  'comunicacao_configuracao_versoes',
  'comunicacao_template_versoes',
  'comunicacao_execucoes',
  'comunicacoes',
  'comunicacao_itens',
  'comunicacao_item_estagios',
  'comunicacao_tentativas',
]

const args = parseArgs()
loadHomologEnv()
if (!args['expected-project-ref'] && process.env.COMUNICACOES_HOMOLOG_PROJECT_REF) {
  args['expected-project-ref'] = process.env.COMUNICACOES_HOMOLOG_PROJECT_REF
}
const env = assertHomologEnvironment(args)
const client = await connectDb(env, 'comunicacoes_verify')
const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

function number(value) {
  return Number(value || 0)
}

try {
  console.log('\nBW Antecipa - verificacao read-only do motor de comunicacoes')
  console.log(environmentSummary(env))
  await client.query('BEGIN READ ONLY')

  const relations = await client.query(`
    SELECT c.relname, c.relrowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
  `, [EXPECTED_TABLES])
  const byTable = new Map(relations.rows.map((row) => [row.relname, row]))
  for (const table of EXPECTED_TABLES) {
    check(byTable.has(table), `Tabela ausente: public.${table}.`)
    check(byTable.get(table)?.relrowsecurity === true, `RLS nao habilitada: public.${table}.`)
  }

  if (failures.some((item) => item.startsWith('Tabela ausente'))) {
    throw new Error(`Migration do P1 ainda nao esta integralmente aplicada:\n- ${failures.join('\n- ')}`)
  }

  const metrics = (await client.query(`
    SELECT
      (SELECT count(*) FROM public.comunicacao_configuracoes) AS configuracoes,
      (SELECT count(*) FROM public.comunicacao_configuracao_versoes) AS versoes,
      (SELECT count(*) FROM public.comunicacao_template_versoes) AS templates,
      (SELECT count(*) FROM public.comunicacao_execucoes) AS execucoes,
      (SELECT count(*) FROM public.comunicacoes) AS comunicacoes,
      (SELECT count(*) FROM public.comunicacao_itens) AS itens,
      (SELECT count(*) FROM public.comunicacao_item_estagios) AS estagios,
      (SELECT count(*) FROM public.comunicacao_tentativas) AS tentativas,
      (SELECT count(*) FROM (
        SELECT fundo_id, idempotency_key FROM public.comunicacoes
        GROUP BY fundo_id, idempotency_key HAVING count(*) > 1
      ) d) AS duplicidades_idempotencia,
      (SELECT count(*) FROM (
        SELECT message_id FROM public.comunicacoes
        GROUP BY message_id HAVING count(*) > 1
      ) d) AS duplicidades_message_id,
      (SELECT count(*) FROM (
        SELECT comunicacao_id, numero_tentativa FROM public.comunicacao_tentativas
        GROUP BY comunicacao_id, numero_tentativa HAVING count(*) > 1
      ) d) AS duplicidades_tentativas,
      (SELECT count(*) FROM public.comunicacao_tentativas WHERE numero_tentativa NOT BETWEEN 1 AND 3) AS tentativas_invalidas,
      (SELECT count(*) FROM public.comunicacao_itens i
        JOIN public.comunicacoes c ON c.id = i.comunicacao_id
        WHERE i.fundo_id <> c.fundo_id) AS itens_fundo_divergente,
      (SELECT count(*) FROM public.comunicacao_item_estagios e
        JOIN public.comunicacao_itens i ON i.id = e.comunicacao_item_id
        JOIN public.comunicacoes c ON c.id = e.comunicacao_id
        WHERE i.comunicacao_id <> e.comunicacao_id OR i.fundo_id <> c.fundo_id) AS estagios_divergentes,
      (SELECT count(*) FROM public.comunicacoes c
        JOIN public.comunicacao_configuracao_versoes v ON v.id = c.configuracao_versao_id
        JOIN public.comunicacao_configuracoes cfg ON cfg.id = v.configuracao_id
        WHERE c.fundo_id <> v.fundo_id OR c.fundo_id <> cfg.fundo_id) AS comunicacoes_fundo_divergente,
      (SELECT count(*) FROM public.comunicacao_template_versoes t
        JOIN public.comunicacao_configuracao_versoes v ON v.id = t.configuracao_versao_id
        WHERE t.fundo_id <> v.fundo_id) AS templates_fundo_divergente,
      (SELECT count(*) FROM (
        SELECT v.id FROM public.comunicacao_configuracao_versoes v
        LEFT JOIN public.comunicacao_template_versoes t ON t.configuracao_versao_id = v.id
        WHERE v.status = 'publicada'
        GROUP BY v.id HAVING count(t.id) <> 7
      ) d) AS publicadas_sem_sete_templates
  `)).rows[0]

  for (const key of [
    'duplicidades_idempotencia',
    'duplicidades_message_id',
    'duplicidades_tentativas',
    'tentativas_invalidas',
    'itens_fundo_divergente',
    'estagios_divergentes',
    'comunicacoes_fundo_divergente',
    'templates_fundo_divergente',
    'publicadas_sem_sete_templates',
  ]) check(number(metrics[key]) === 0, `Invariante violada (${key}): ${metrics[key]}.`)

  const policies = await client.query(`
    SELECT tablename, count(*)::integer AS quantidade
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = ANY($1::text[])
    GROUP BY tablename
  `, [EXPECTED_TABLES])
  const policiesByTable = new Map(policies.rows.map((row) => [row.tablename, row.quantidade]))
  for (const table of EXPECTED_TABLES) check(number(policiesByTable.get(table)) > 0, `Nenhuma policy encontrada em public.${table}.`)

  await client.query('ROLLBACK')
  console.log('\n=== COMUNICACOES ===')
  console.log(`Configuracoes: ${metrics.configuracoes} | versoes: ${metrics.versoes} | templates: ${metrics.templates}`)
  console.log(`Execucoes: ${metrics.execucoes} | comunicacoes: ${metrics.comunicacoes}`)
  console.log(`Itens: ${metrics.itens} | estagios: ${metrics.estagios} | tentativas: ${metrics.tentativas}`)
  if (failures.length) throw new Error(`Verify reprovado:\n- ${failures.join('\n- ')}`)
  console.log('VERIFY APROVADO: schema, RLS, isolamento, idempotencia e tentativas validados sem envio de e-mail.')
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  console.error(`\nFalha no verify: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
