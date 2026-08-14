import {
  assertHomologEnvironment,
  connectDb,
  loadHomologEnv,
  parseArgs,
} from '../rlx-golden/helpers.mjs'

const TABLES = [
  'importacoes_financeiras',
  'importacao_arquivos',
  'importacao_linhas',
  'importacao_ciclos',
  'estoque_posicoes',
  'aquisicao_movimentos',
  'liquidacao_movimentos',
  'carteira_snapshots',
  'matching_execucoes',
  'matching_resultados',
  'matching_candidatos',
  'titulo_nf_vinculos',
  'titulo_nf_vinculo_chaves',
  'conciliacao_execucoes',
  'conciliacao_resultados',
  'posicao_logistica_execucoes',
  'posicao_logistica_resultados',
  'exposicao_execucoes',
  'exposicao_overlay_itens',
]

loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'p251_verify_homolog')

try {
  const counts = {}
  for (const table of TABLES) {
    const result = await db.query(`select count(*)::bigint as total from public.${table}`)
    counts[table] = Number(result.rows[0].total)
  }

  const residual = await db.query(`
    select object_type, schema_name, object_name
    from (
      select 'relation'::text object_type, n.nspname schema_name, c.relname object_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'private') and c.relname like 'rlx\\_%' escape '\\'
      union all
      select 'function', n.nspname, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname like 'rlx\\_%' escape '\\'
      union all
      select 'policy', schemaname, policyname
      from pg_policies
      where schemaname = 'public' and policyname like '%rlx%'
      union all
      select 'trigger', n.nspname, t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname = 'public' and t.tgname like '%rlx%'
    ) inventory
    order by object_type, schema_name, object_name
  `)

  const security = await db.query(`
    select
      count(*) filter (where c.relrowsecurity)::integer as rls_enabled_tables,
      count(*)::integer as total_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any($1::text[])
  `, [TABLES])
  const policies = await db.query(`
    select count(*)::integer as total
    from pg_policies
    where schemaname = 'public' and tablename = any($1::text[])
  `, [TABLES])
  const foreignKeys = await db.query(`
    select count(*)::integer as total
    from pg_constraint constraint_definition
    join pg_class relation on relation.oid = constraint_definition.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and constraint_definition.contype = 'f'
      and relation.relname = any($1::text[])
  `, [TABLES])
  const funds = await db.query(`
    select count(distinct fundo_id)::integer as total
    from (
      select fundo_id from public.importacoes_financeiras
      union all select fundo_id from public.matching_execucoes
      union all select fundo_id from public.conciliacao_execucoes
      union all select fundo_id from public.posicao_logistica_execucoes
      union all select fundo_id from public.exposicao_execucoes
    ) scoped
  `)

  if (residual.rowCount > 0) {
    throw new Error(`Ainda existem objetos estruturais rlx_: ${JSON.stringify(residual.rows)}`)
  }
  if (Number(security.rows[0].rls_enabled_tables) !== TABLES.length) {
    throw new Error('Nem todas as tabelas financeiras generalizadas permanecem com RLS habilitada.')
  }

  console.log(JSON.stringify({
    projectRef: env.projectRef,
    tables: TABLES.length,
    counts,
    residualStructuralObjects: residual.rows,
    security: {
      rlsEnabledTables: Number(security.rows[0].rls_enabled_tables),
      policies: Number(policies.rows[0].total),
      foreignKeys: Number(foreignKeys.rows[0].total),
    },
    representedFunds: Number(funds.rows[0].total),
  }, null, 2))
} finally {
  await db.end()
}
