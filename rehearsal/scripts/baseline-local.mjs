import path from 'node:path'
import {
  REPORT_DIR,
  ensureRuntimeDirectories,
  formatError,
  localPgConfig,
  sha256,
  stableJson,
  withPgClient,
  writeJson,
} from './lib.mjs'

const EXPECTED = Object.freeze({
  cedentes: 12,
  operacoes: 46,
  notas_fiscais: 910,
  documentos: 123,
  storage_objects: 1644,
  operacoes_fromtis_legado: 26,
})

async function tableExists(client, schema, table) {
  const result = await client.query('select to_regclass($1) is not null as exists', [`${schema}.${table}`])
  return result.rows[0].exists
}

async function columns(client, schema, table) {
  const result = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema = $1 and table_name = $2
    order by ordinal_position
  `, [schema, table])
  return result.rows.map((row) => row.column_name)
}

async function count(client, schema, table) {
  if (!(await tableExists(client, schema, table))) return null
  const result = await client.query(`select count(*)::integer as count from ${schema}.${table}`)
  return result.rows[0].count
}

async function groupedStatus(client, table) {
  if (!(await tableExists(client, 'public', table))) return []
  const tableColumns = await columns(client, 'public', table)
  if (!tableColumns.includes('status')) return []
  const result = await client.query(`
    select coalesce(status::text, '<null>') as status, count(*)::integer as count
    from public.${table}
    group by status::text
    order by status::text
  `)
  return result.rows
}

async function ids(client, table) {
  if (!(await tableExists(client, 'public', table))) return []
  const result = await client.query(`select id::text from public.${table} order by id::text`)
  return result.rows.map((row) => row.id)
}

async function orderedHash(client, query) {
  const result = await client.query(query)
  return sha256(result.rows.map((row) => row.value).join('\n'))
}

async function samplesByStatus(client, table) {
  if (!(await tableExists(client, 'public', table))) return []
  const tableColumns = await columns(client, 'public', table)
  if (!tableColumns.includes('status')) return []
  const result = await client.query(`
    select status::text as status, (array_agg(id::text order by id::text))[1:3] as sample_ids
    from public.${table}
    group by status::text
    order by status::text
  `)
  return result.rows
}

async function countLegacyFromtis(client) {
  if (!(await tableExists(client, 'public', 'operacoes'))) return null
  const operationColumns = await columns(client, 'public', 'operacoes')
  const fromtisColumns = operationColumns.filter((column) => /fromtis/iu.test(column))
  const candidates = fromtisColumns.length > 0
    ? fromtisColumns
    : operationColumns.filter((column) => /remessa|retorno/iu.test(column))
  if (candidates.length === 0) return 0
  const predicate = candidates.map((column) => `${column} is not null`).join(' or ')
  const result = await client.query(`select count(*)::integer as count from public.operacoes where ${predicate}`)
  return result.rows[0].count
}

async function main() {
  ensureRuntimeDirectories()
  const report = await withPgClient(localPgConfig(), async (client) => {
    const version = await client.query("select current_setting('server_version') as server_version")
    const tables = await client.query(`
      select table_schema, table_name
      from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema not in ('pg_catalog', 'information_schema')
      order by table_schema, table_name
    `)
    const migrationHistory = await client.query(`
      select version
      from supabase_migrations.schema_migrations
      order by version
    `)
    const fundColumns = await columns(client, 'public', 'fundos')
    const activeFundPredicate = fundColumns.includes('status')
      ? "status::text = 'ativo'"
      : fundColumns.includes('ativo') ? 'ativo is true' : 'true'
    const activeFunds = await client.query(`
      select id::text
      from public.fundos
      where ${activeFundPredicate}
      order by id::text
    `).catch(() => ({ rows: [] }))
    const roleCounts = await client.query(`
      select coalesce(role::text, '<null>') as role, count(*)::integer as count
      from public.profiles
      group by role::text
      order by role::text
    `).catch(() => ({ rows: [] }))
    const storageSample = await client.query(`
      select bucket_id, name
      from storage.objects
      order by bucket_id, name
      limit 10
    `).catch(() => ({ rows: [] }))

    const counts = {
      fundos: await count(client, 'public', 'fundos'),
      cedentes: await count(client, 'public', 'cedentes'),
      profiles: await count(client, 'public', 'profiles'),
      auth_users: await count(client, 'auth', 'users'),
      gestores: null,
      operacoes: await count(client, 'public', 'operacoes'),
      notas_fiscais: await count(client, 'public', 'notas_fiscais'),
      documentos: await count(client, 'public', 'documentos'),
      storage_objects: await count(client, 'storage', 'objects'),
      cedente_fundos: await count(client, 'public', 'cedente_fundos'),
      usuario_fundos: await count(client, 'public', 'usuario_fundos'),
      operacoes_fromtis_legado: await countLegacyFromtis(client),
    }
    counts.gestores = roleCounts.rows.find((row) => row.role === 'gestor')?.count ?? 0

    const operationIds = await ids(client, 'operacoes')
    const invoiceIds = await ids(client, 'notas_fiscais')
    return {
      generated_at: new Date().toISOString(),
      environment: 'local-production-rehearsal',
      postgres_version: version.rows[0].server_version,
      counts,
      operation_statuses: await groupedStatus(client, 'operacoes'),
      invoice_statuses: await groupedStatus(client, 'notas_fiscais'),
      operation_samples: await samplesByStatus(client, 'operacoes'),
      document_sample_paths: storageSample.rows,
      active_fund_ids: activeFunds.rows.map((row) => row.id),
      user_roles: roleCounts.rows,
      ids: { operacoes: operationIds, notas_fiscais: invoiceIds },
      aggregates: {
        operacao_ids_sha256: sha256(operationIds.join('\n')),
        nota_fiscal_ids_sha256: sha256(invoiceIds.join('\n')),
        documento_ids_sha256: await orderedHash(client, `
          select id::text as value from public.documentos order by id::text
        `),
        profile_ids_sha256: await orderedHash(client, `
          select id::text as value from public.profiles order by id::text
        `),
        auth_user_ids_sha256: await orderedHash(client, `
          select id::text as value from auth.users order by id::text
        `),
        fundo_ids_sha256: await orderedHash(client, `
          select id::text as value from public.fundos order by id::text
        `),
        storage_paths_sha256: await orderedHash(client, `
          select bucket_id || '/' || name as value
          from storage.objects
          order by bucket_id, name
        `),
      },
      tables: tables.rows,
      migration_history: migrationHistory.rows.map((row) => row.version),
    }
  })

  report.divergences = Object.entries(EXPECTED).flatMap(([key, expected]) => {
    const actual = report.counts[key]
    return actual === expected ? [] : [{ metric: key, expected, actual }]
  })
  const deterministicPayload = {
    counts: report.counts,
    operation_statuses: report.operation_statuses,
    invoice_statuses: report.invoice_statuses,
    active_fund_ids: report.active_fund_ids,
    user_roles: report.user_roles,
    aggregates: report.aggregates,
    tables: report.tables,
    migration_history: report.migration_history,
  }
  report.deterministic_hash = sha256(stableJson(deterministicPayload))
  const output = path.join(REPORT_DIR, 'baseline-current.json')
  writeJson(output, report)
  console.log(`Baseline local gerado. Hash deterministico: ${report.deterministic_hash}`)
  console.log(`Divergencias contra a auditoria conhecida: ${report.divergences.length}.`)
}

main().catch((error) => {
  console.error(`Baseline abortado: ${formatError(error)}`)
  process.exitCode = 1
})
