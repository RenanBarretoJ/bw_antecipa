import { createHash } from 'node:crypto'

import {
  assertHomologEnvironment,
  connectDb,
  createAdminClient,
  loadHomologEnv,
  parseArgs,
} from '../rlx-golden/helpers.mjs'

const MAIN_FUND_ID = '61f02178-58af-bbfa-9a33-f97ac5b3dd96'
const ADVERSARIAL_FUND_ID = 'e84fdd30-39ed-de86-292e-0d8d9d92d759'
const DATES = ['2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']
const EXPECTED_PL = new Map([
  ['2026-08-06', '48000000.0000'],
  ['2026-08-07', '49200000.0000'],
  ['2026-08-08', '50000000.0000'],
  ['2026-08-09', '50700000.0000'],
])

const args = parseArgs()
loadHomologEnv()
const env = assertHomologEnvironment(args)
const db = await connectDb(env, 'p22_verify_read_only')
const storage = createAdminClient(env)
const failures = []
const checks = []

function check(condition, label, details = undefined) {
  checks.push(label)
  if (!condition) failures.push({ label, details })
}

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

try {
  console.log('\nBW Antecipa - verificacao READ-ONLY P2.2 RLX')
  console.log(`Projeto homolog: ${env.projectRef}`)
  await db.query('BEGIN READ ONLY')

  const schema = await db.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name = ANY($1)
  `, [[
    'rlx_importacoes_financeiras', 'rlx_importacao_arquivos', 'rlx_importacao_linhas',
    'rlx_estoque_posicoes', 'rlx_aquisicao_movimentos', 'rlx_liquidacao_movimentos',
    'rlx_carteira_snapshots', 'rlx_importacao_ciclos',
  ]])
  check(schema.rowCount === 8, 'oito tabelas P2.2 existem', schema.rows)

  const rls = await db.query(`
    SELECT relname, relrowsecurity FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relname LIKE 'rlx_%'
      AND relkind='r'
  `)
  check(rls.rows.length >= 8 && rls.rows.every((row) => row.relrowsecurity), 'RLS habilitada em todas as tabelas P2.2', rls.rows)
  const policies = await db.query(`
    SELECT tablename,policyname,cmd,roles,qual,with_check
    FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'rlx_%'
  `)
  check(!policies.rows.some((row) => row.cmd !== 'SELECT'), 'nao ha policy de escrita direta para usuarios comuns', policies.rows)
  check(!policies.rows.some((row) => row.qual === 'true' || row.with_check === 'true'), 'nao ha policy RLX USING/WITH CHECK true', policies.rows)

  const forbiddenColumns = await db.query(`
    SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name = ANY($1)
      AND column_name = ANY($2)
  `, [[
    'rlx_estoque_posicoes', 'rlx_aquisicao_movimentos', 'rlx_liquidacao_movimentos', 'rlx_carteira_snapshots',
  ], ['nota_fiscal_id', 'matching_status', 'status_logistico', 'conciliacao_status', 'encerra_exposicao']])
  check(forbiddenColumns.rowCount === 0, 'matching, conciliacao, logistica e exposicao nao foram acoplados ao canonico', forbiddenColumns.rows)

  const numericTypes = await db.query(`
    SELECT table_name,column_name,data_type,numeric_precision,numeric_scale
    FROM information_schema.columns
    WHERE table_schema='public' AND (
      (table_name LIKE 'rlx_%' AND column_name LIKE 'valor_%') OR
      (table_name='rlx_carteira_snapshots' AND column_name='patrimonio_liquido')
    )
  `)
  check(numericTypes.rows.every((row) => row.data_type === 'numeric' && Number(row.numeric_scale) === 4), 'valores canonicos usam numeric com escala 4', numericTypes.rows)

  const imports = await db.query(`
    SELECT i.*,
      (SELECT count(*)::integer FROM public.rlx_importacao_linhas l WHERE l.importacao_id=i.id) AS staging_rows,
      (SELECT count(*)::integer FROM public.rlx_importacao_arquivos a WHERE a.importacao_id=i.id) AS raw_rows
    FROM public.rlx_importacoes_financeiras i
    WHERE i.provedor='rlx_golden' AND i.origem='GOLDEN_DATASET'
      AND i.fundo_id=ANY($1) AND i.data_referencia=ANY($2::date[])
    ORDER BY i.data_referencia,i.tipo_base,i.recebida_em
  `, [[MAIN_FUND_ID, ADVERSARIAL_FUND_ID], DATES])
  check(imports.rows.length >= 19, 'timeline D-4..D-1, retificacoes e cross-fund foram ingeridos', imports.rows.length)
  check(imports.rows.every((row) => /^[0-9a-f]{64}$/.test(row.hash_conteudo)), 'todas as importacoes possuem SHA-256')
  check(imports.rows.every((row) => row.declaracao_sem_movimento || Number(row.raw_rows) === 1), 'cada arquivo possui registro raw imutavel')
  check(imports.rows.every((row) => Number(row.staging_rows) === Number(row.linhas_total)), 'staging preserva todas as linhas lidas')
  check(imports.rows.every((row) => row.layout_nome && row.versao_layout && row.encoding_detectado), 'layout e encoding possuem linhagem')

  const current = imports.rows.filter((row) => row.status === 'PUBLICADA')
  const currentKeys = new Set(current.map((row) => `${row.fundo_id}:${row.tipo_base}:${dateKey(row.data_referencia)}`))
  check(currentKeys.size === current.length, 'existe no maximo uma publicacao vigente por fundo, base e data')
  check(DATES.every((date) => ['CARTEIRA', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'].every((type) => currentKeys.has(`${MAIN_FUND_ID}:${type}:${date}`))), 'as quatro familias estao publicadas em D-4..D-1')

  const empty = current.filter((row) => row.completude === 'COMPLETO_VAZIO')
  check(empty.some((row) => row.tipo_base === 'LIQUIDACOES' && dateKey(row.data_referencia) === '2026-08-08'), 'D-2 Liquidacoes esta COMPLETO_VAZIO')
  check(empty.some((row) => row.tipo_base === 'AQUISICOES' && dateKey(row.data_referencia) === '2026-08-09'), 'D-1 Aquisicoes esta COMPLETO_VAZIO')
  check(!empty.some((row) => ['CARTEIRA', 'ESTOQUE'].includes(row.tipo_base)), 'Carteira e Estoque nunca aceitam COMPLETO_VAZIO')

  const rectifications = imports.rows.filter((row) => row.status === 'RETIFICADA')
  const replacements = current.filter((row) => row.substitui_importacao_id)
  check(rectifications.length >= 2 && replacements.length >= 2, 'V1 retificada e V2 vigente permanecem historicas')
  check(replacements.every((row) => rectifications.some((old) => old.id === row.substitui_importacao_id)), 'linhagem da retificacao referencia a V1')

  const portfolio = await db.query(`
    SELECT data_referencia::text,patrimonio_liquido::text
    FROM public.rlx_carteira_atual
    WHERE fundo_id=$1 AND data_referencia=ANY($2::date[])
    ORDER BY data_referencia
  `, [MAIN_FUND_ID, DATES])
  check(portfolio.rows.length === 4 && portfolio.rows.every((row) => row.patrimonio_liquido === EXPECTED_PL.get(row.data_referencia)), 'PL D-4..D-1 preserva os valores exatos', portfolio.rows)

  const stock = await db.query(`
    SELECT fundo_id,count(*)::integer AS total,
      count(DISTINCT external_title_key)::integer AS chaves,
      bool_and(payload_origem <> '{}'::jsonb) AS payload_ok
    FROM public.rlx_estoque_atual
    WHERE data_referencia='2026-08-09' AND fundo_id=ANY($1)
    GROUP BY fundo_id
  `, [[MAIN_FUND_ID, ADVERSARIAL_FUND_ID]])
  const mainStock = stock.rows.find((row) => row.fundo_id === MAIN_FUND_ID)
  const adversarialStock = stock.rows.find((row) => row.fundo_id === ADVERSARIAL_FUND_ID)
  check(mainStock?.total === 89 && mainStock?.chaves === 89 && mainStock?.payload_ok, 'retificacao D-1 deixou 89 posicoes vigentes com linhagem', mainStock)
  check(adversarialStock?.total === 12 && adversarialStock?.chaves === 12, 'cross-fund publicou 12 posicoes sem colisao', adversarialStock)

  const largeId = await db.query(`
    SELECT fundo_id,id_recebivel,pg_typeof(id_recebivel)::text AS tipo
    FROM public.rlx_estoque_atual WHERE id_recebivel='900719925474099312345'
  `)
  check(largeId.rows.length >= 1 && largeId.rows.every((row) => row.tipo === 'text' && row.id_recebivel === '900719925474099312345'), 'BIGINT externo foi preservado byte a byte como text', largeId.rows)

  const acquisitions = await db.query(`
    SELECT count(*)::integer AS total,count(DISTINCT fingerprint_linha)::integer AS fingerprints,
      bool_and(payload_origem <> '{}'::jsonb) AS payload_ok
    FROM public.rlx_aquisicoes_atuais WHERE fundo_id=$1 AND data_referencia IN ('2026-08-07','2026-08-08')
  `, [MAIN_FUND_ID])
  check(acquisitions.rows[0].total === 30 && acquisitions.rows[0].fingerprints === 30 && acquisitions.rows[0].payload_ok, '30 aquisicoes vigentes preservam fingerprint e payload', acquisitions.rows[0])

  const liquidations = await db.query(`
    SELECT count(*)::integer AS total,count(DISTINCT fingerprint_linha)::integer AS fingerprints,
      bool_and(payload_origem <> '{}'::jsonb) AS payload_ok
    FROM public.rlx_liquidacoes_atuais WHERE fundo_id=$1 AND data_referencia IN ('2026-08-07','2026-08-09')
  `, [MAIN_FUND_ID])
  check(liquidations.rows[0].total === 24 && liquidations.rows[0].fingerprints === 24 && liquidations.rows[0].payload_ok, '24 liquidacoes coexistem com fingerprints distintos', liquidations.rows[0])

  const bucket = await db.query(`SELECT id,public FROM storage.buckets WHERE id='financeiro-importacoes'`)
  check(bucket.rows.length === 1 && bucket.rows[0].public === false, 'bucket financeiro-importacoes existe e e privado', bucket.rows)
  await db.query('ROLLBACK')

  for (const item of imports.rows.filter((row) => row.storage_path)) {
    const { data, error } = await storage.storage.from('financeiro-importacoes').download(item.storage_path)
    if (error || !data) {
      check(false, `raw file acessivel para auditoria: ${item.id}`, error?.message)
      continue
    }
    const hash = createHash('sha256').update(Buffer.from(await data.arrayBuffer())).digest('hex')
    check(hash === item.hash_conteudo, `hash do raw file confere: ${item.id}`, { esperado: item.hash_conteudo, atual: hash })
  }

  if (failures.length) {
    console.error(`\nP2.2 verify falhou em ${failures.length} verificacao(oes):`)
    for (const failure of failures) console.error(`- ${failure.label}${failure.details === undefined ? '' : `: ${JSON.stringify(failure.details)}`}`)
    process.exitCode = 1
  } else {
    console.log(`\nP2.2 verify aprovado: ${checks.length} verificacoes somente leitura.`)
  }
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  console.error(`P2.2 verify falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await db.end().catch(() => undefined)
}
