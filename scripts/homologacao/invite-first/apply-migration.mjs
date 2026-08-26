#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const EXPECTED_REF = 'fhgkmggthxikfpogrvaa'
const MIGRATIONS = [
  { version: '20260826190000', name: 'p2_invite_first_novo_cedente', file: '20260826190000_p2_invite_first_novo_cedente.sql' },
  { version: '20260826193000', name: 'p2_invite_first_compatibilidade_convites_existentes', file: '20260826193000_p2_invite_first_compatibilidade_convites_existentes.sql' },
]

loadEnv(resolve('.env.homolog'))
const apiRef = new URL(required('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0]
const productionRef = required('SUPABASE_PRODUCTION_PROJECT_REF')
const databaseUrl = new URL(required('SUPABASE_DB_URL'))
databaseUrl.password = required('SUPABASE_PASSWORD')
const databaseIdentity = `${databaseUrl.hostname} ${decodeURIComponent(databaseUrl.username)}`

if (apiRef !== EXPECTED_REF || !databaseIdentity.includes(EXPECTED_REF)) throw new Error('Destino nao corresponde a homologacao autorizada.')
if (apiRef === productionRef) throw new Error('Projeto de producao bloqueado.')

const client = new pg.Client({
  connectionString: databaseUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'bw_antecipa_p2_invite_first_apply',
})

await client.connect()
try {
  for (const migration of MIGRATIONS) {
    const applied = await client.query(
      'select 1 from supabase_migrations.schema_migrations where version = $1',
      [migration.version],
    )
    if (applied.rowCount) {
      console.log(`Migration ${migration.version} ja aplicada em homolog (${apiRef}).`)
      continue
    }
    const sql = readFileSync(resolve('supabase/migrations', migration.file), 'utf8')
    await client.query(sql)
    await client.query(
      'insert into supabase_migrations.schema_migrations(version, statements, name) values ($1, $2, $3)',
      [migration.version, [sql], migration.name],
    )
    console.log(`Migration ${migration.version} aplicada exclusivamente em homolog (${apiRef}).`)
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
