#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

loadEnv(resolve('.env.homolog'))
const expectedRef = 'fhgkmggthxikfpogrvaa'
const apiRef = new URL(required('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0]
const productionRef = required('SUPABASE_PRODUCTION_PROJECT_REF')
const databaseUrl = rotatedDatabaseUrl()

if (apiRef !== expectedRef || !`${databaseUrl.hostname} ${decodeURIComponent(databaseUrl.username)}`.includes(expectedRef)) {
  throw new Error('Destino PostgreSQL nao corresponde a homologacao autorizada.')
}
if (apiRef === productionRef) throw new Error('Projeto de producao bloqueado.')

const migrationPath = resolve('supabase/migrations/20260818191418_p0_onboarding_cedente_rpc_segura.sql')
const sql = readFileSync(migrationPath, 'utf8')
  .replace(/^\s*BEGIN;\s*/i, '')
  .replace(/\s*COMMIT;\s*$/i, '')

const client = new pg.Client({
  connectionString: databaseUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'bw_p0_onboarding_validate',
})

await client.connect()
try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('ROLLBACK')
  console.log(`Migration P0 validada e revertida integralmente em homologacao (${apiRef}).`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  throw error
} finally {
  await client.end()
}

function rotatedDatabaseUrl() {
  const parsed = new URL(required('SUPABASE_DB_URL'))
  parsed.password = required('SUPABASE_PASSWORD')
  return parsed
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
