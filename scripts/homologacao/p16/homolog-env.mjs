import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'

export const projectRef = 'fhgkmggthxikfpogrvaa'
export function loadHomologEnv() {
  const file = process.argv.find(arg => arg.startsWith('--env='))?.slice(6)
  assert.ok(file, 'Informe --env=<arquivo de homologacao>')
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_0-9]+)=(.*)$/)
    if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
  assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${projectRef}.supabase.co`)
  const url = new URL(env.SUPABASE_DB_URL)
  assert.ok(url.hostname === `db.${projectRef}.supabase.co` ||
    (url.hostname.endsWith('.pooler.supabase.com') && url.username === `postgres.${projectRef}`), 'Banco fora de homologacao')
  url.password = env.SUPABASE_PASSWORD
  return { env, connectionString: url.toString() }
}
export function database(connectionString) {
  return new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 })
}
