#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
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

const ticketVersions = ['20260820130000', '20260820140000']
const localVersions = readdirSync(resolve('supabase/migrations'))
  .map((file) => file.match(/^(\d+)_.*\.sql$/)?.[1])
  .filter(Boolean)

const client = new pg.Client({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } })
await client.connect()
let appliedVersions
try {
  const result = await client.query('select version from supabase_migrations.schema_migrations')
  appliedVersions = new Set(result.rows.map((row) => String(row.version)))
} finally {
  await client.end()
}

const pendingVersions = [...new Set(localVersions.filter((version) => !appliedVersions.has(version)))].sort()
const unexpectedPending = pendingVersions.filter((version) => !ticketVersions.includes(version))
if (unexpectedPending.length > 0) {
  throw new Error(`Aplicacao recusada: existem migrations pendentes fora deste ticket (${unexpectedPending.join(', ')}).`)
}
if (pendingVersions.length === 0) {
  console.log(`Migrations deste ticket ja constam no historico de homologacao (${apiRef}).`)
  process.exit(0)
}

const executable = process.platform === 'win32'
  ? resolve('node_modules/@supabase/cli-windows-x64/bin/supabase.exe')
  : resolve('node_modules/.bin/supabase')
const result = spawnSync(executable, [
  'migration', 'up', '--db-url', databaseUrl.toString(), '--yes',
], { cwd: process.cwd(), stdio: 'inherit', shell: false })

if (result.error) throw result.error
if (result.status !== 0) throw new Error(`Falha ao aplicar migrations em homologacao (exit ${result.status}).`)
console.log(`Migrations deste ticket aplicadas em homologacao (${apiRef}).`)

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
