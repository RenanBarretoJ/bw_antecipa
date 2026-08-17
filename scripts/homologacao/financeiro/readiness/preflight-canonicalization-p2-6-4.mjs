#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { buildMigrationInventory, compareMigrationHistory } from './lib.mjs'

const HOMOLOG_REF = 'fhgkmggthxikfpogrvaa'
const outputPath = resolve('docs/financeiro/homolog-preflight-p2-6-4.json')

if (!process.version.startsWith('v22.')) throw new Error(`Node 22 obrigatorio; recebido ${process.version}.`)
const connectionString = loadHomologDbUrl()
const client = new pg.Client({
  connectionString,
  application_name: 'bw_antecipa_p264_preflight_read_only',
  statement_timeout: 240_000,
  query_timeout: 240_000,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
try {
  await client.query('BEGIN READ ONLY')
  const inventory = buildMigrationInventory()
  const history = await client.query('select version::text,name::text from supabase_migrations.schema_migrations order by version')
  const migrationHistory = compareMigrationHistory(inventory, history.rows)
  const counts = await countExistingRelations(client, [
    'notas_fiscais', 'operacoes', 'operacoes_nfs', 'documentos', 'documento_versoes',
    'remessas_cnab', 'integracao_fundo_versoes', 'logs_auditoria', 'eventos_dominio',
    'importacoes_financeiras', 'matching_resultados', 'conciliacao_resultados',
    'posicao_logistica_resultados', 'exposicao_execucoes', 'risco_operacao_resultados',
  ])
  const { rows: [compatibility] } = await client.query(`select
    (select count(*)::bigint from public.notas_fiscais where valor_bruto <= 0) as notas_valor_nao_positivo,
    (select count(*)::bigint
       from public.remessas_cnab r
       where r.integracao_fundo_versao_id is not null
         and not exists (select 1 from public.integracao_fundo_versoes v where v.id=r.integracao_fundo_versao_id)) as remessas_integracao_orfas,
    (select count(*)::bigint from public.devedores_solidarios) as devedores_solidarios`)
  const defaultAcl = await client.query(`select r.rolname as owner,n.nspname as schema,d.defaclobjtype,
      coalesce(d.defaclacl::text,'') as acl
    from pg_default_acl d
    join pg_roles r on r.oid=d.defaclrole
    left join pg_namespace n on n.oid=d.defaclnamespace
    where n.nspname='public' or n.nspname is null
    order by 1,2,3`)
  const acl = await client.query(`select grantee,kind,count(*)::integer as privileges
    from (
      select grantee,'table'::text kind from information_schema.table_privileges
       where table_schema='public' and grantee in ('PUBLIC','anon','authenticated','service_role')
      union all
      select grantee,'routine'::text kind from information_schema.routine_privileges
       where routine_schema='public' and grantee in ('PUBLIC','anon','authenticated','service_role')
    ) q group by grantee,kind order by grantee,kind`)
  const result = {
    schema: 'bw-antecipa-p2-6-4-homolog-preflight-v1',
    status: Number(compatibility.notas_valor_nao_positivo) === 0 && Number(compatibility.remessas_integracao_orfas) === 0 ? 'PASS' : 'FAIL',
    captured_at: new Date().toISOString(),
    environment: { project_ref: HOMOLOG_REF, transaction: 'READ ONLY', production_mutated: false, homolog_mutated: false },
    migration_history: migrationHistory,
    row_counts: counts,
    compatibility,
    acl_summary: acl.rows,
    default_acl: defaultAcl.rows,
  }
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  if (result.status !== 'PASS') throw new Error(`Preflight bloqueado: ${JSON.stringify(compatibility)}`)
  console.log(JSON.stringify({ status: result.status, migration_history: migrationHistory, compatibility, output: outputPath }, null, 2))
} finally {
  await client.query('ROLLBACK').catch(() => undefined)
  await client.end()
}

async function countExistingRelations(db, names) {
  const output = {}
  for (const name of names) {
    const exists = await db.query('select to_regclass($1) is not null as present', [`public.${name}`])
    if (!exists.rows[0].present) {
      output[name] = null
      continue
    }
    const count = await db.query(`select count(*)::bigint as count from public.${quoteIdentifier(name)}`)
    output[name] = count.rows[0].count
  }
  return output
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`
}

function loadHomologDbUrl() {
  const env = new Map()
  for (const line of readFileSync(resolve('.env.homolog'), 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (match) env.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ''))
  }
  const value = env.get('SUPABASE_DB_URL') || env.get('DATABASE_URL')
  if (!value) throw new Error('URL de homologacao ausente.')
  const url = new URL(value)
  const ref = decodeURIComponent(url.username).match(/^postgres[.]([a-z0-9]+)$/i)?.[1]
    || url.hostname.match(/^db[.]([a-z0-9]+)[.]supabase[.]co$/i)?.[1]
  if (ref !== HOMOLOG_REF) throw new Error('Projeto remoto diferente da homologacao autorizada.')
  return value
}
