#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

loadEnv(resolve('.env.homolog'))
const expectedRef = 'fhgkmggthxikfpogrvaa'
const apiRef = new URL(required('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0]
const productionRef = required('SUPABASE_PRODUCTION_PROJECT_REF')
const databaseUrl = new URL(required('SUPABASE_DB_URL'))
databaseUrl.password = required('SUPABASE_PASSWORD')

if (apiRef !== expectedRef) throw new Error('Destino nao corresponde ao projeto homolog autorizado.')
if (apiRef === productionRef) throw new Error('Projeto de producao bloqueado.')

const migrations = [
  { version: '20260826200000', name: 'p3_cutover_autorizacao_cedente', file: '20260826200000_p3_cutover_autorizacao_cedente.sql' },
  { version: '20260826201000', name: 'p3_notificacoes_cedente_ativas', file: '20260826201000_p3_notificacoes_cedente_ativas.sql' },
  { version: '20260826202000', name: 'p3_hardening_acl_rpcs_cedente', file: '20260826202000_p3_hardening_acl_rpcs_cedente.sql' },
]

const client = new pg.Client({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  for (const migration of migrations) {
    const existing = await client.query(
      'select 1 from supabase_migrations.schema_migrations where version = $1',
      [migration.version],
    )
    if (existing.rowCount) {
      console.log(`Migration ${migration.version} ja consta no historico de homologacao (${apiRef}).`)
      continue
    }

    const rawSql = readFileSync(resolve('supabase/migrations', migration.file), 'utf8')
    const sql = rawSql
      .replace(/^\s*BEGIN;\s*/i, '')
      .replace(/\s*COMMIT;\s*$/i, '')

    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query(
        `insert into supabase_migrations.schema_migrations (version, name, statements)
         values ($1, $2, $3::text[])`,
        [migration.version, migration.name, [sql]],
      )
      await client.query('COMMIT')
      console.log(`Migration ${migration.version} aplicada em homologacao (${apiRef}).`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
} finally {
  await client.end()
}

function required(key) {
  const value = process.env[key]
  if (!value) throw new Error(`${key} ausente em .env.homolog.`)
  return value
}

function loadEnv(path) {
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
