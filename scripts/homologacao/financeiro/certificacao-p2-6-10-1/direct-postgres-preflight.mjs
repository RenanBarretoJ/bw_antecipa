import pg from 'pg'

const EXPECTED_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const configuredDatabaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || ''
const rotatedPassword = process.env.SUPABASE_PASSWORD || ''
const databaseUrl = applyRotatedPassword(configuredDatabaseUrl, rotatedPassword)
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const testedAt = new Date().toISOString()

function apiProjectRef(value) {
  try {
    return new URL(value).hostname.split('.')[0] || null
  } catch {
    return null
  }
}

function databaseTargetsProject(value) {
  try {
    const parsed = new URL(value)
    return `${parsed.hostname} ${decodeURIComponent(parsed.username)}`.includes(EXPECTED_PROJECT_REF)
  } catch {
    return false
  }
}

function applyRotatedPassword(value, password) {
  if (!value || !password) return value
  try {
    const parsed = new URL(value)
    parsed.password = password
    return parsed.toString()
  } catch {
    return value
  }
}

const result = {
  target_project_ref: apiProjectRef(apiUrl),
  db_target_matches_expected: databaseTargetsProject(databaseUrl),
  direct_postgres_connection_credential_updated: Boolean(rotatedPassword),
  direct_postgres_connection_test: 'FAIL',
  tested_at: testedAt,
}

if (result.target_project_ref !== EXPECTED_PROJECT_REF || !result.db_target_matches_expected) {
  console.log(JSON.stringify({ ...result, error_code: 'TARGET_MISMATCH' }))
  process.exit(2)
}

const client = new pg.Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 10_000,
})

try {
  await client.connect()
  await client.query('select 1 as ok')
  result.direct_postgres_connection_credential_updated = true
  result.direct_postgres_connection_test = 'PASS'
  console.log(JSON.stringify(result))
} catch (error) {
  console.log(JSON.stringify({
    ...result,
    error_code: typeof error?.code === 'string' ? error.code : 'CONNECTION_ERROR',
  }))
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
