// READ ONLY: certify existing migration and preserve Preview data/history across config rollout.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { loadHealthMigration, manifest } from './migration-manifest.mjs'

const mode = process.argv[2]
assert(['--baseline', '--verify'].includes(mode) && process.argv.length === 3, 'READONLY_MODE_REQUIRED')
const migration = loadHealthMigration()
const sha = s => createHash('sha256').update(s).digest('hex')
const file = 'rehearsal/reports/HEALTH_MANUAL_PREVIEW_BASELINE.json'
const r = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'branches', 'get',
  'b5227cca-3494-46f9-b3a7-2f0ddee7650d', '--project-ref', 'wwsndnuvnjuabpbjwlck', '-o', 'json'],
{ encoding: 'utf8', windowsHide: true, timeout: 30000 })
assert.equal(r.status, 0, 'BRANCH_LOOKUP_FAILED')
const details = JSON.parse(r.stdout)
assert.equal(new URL(details.SUPABASE_URL).hostname, `${manifest.projectRef}.supabase.co`)
const url = new URL(details.POSTGRES_URL)
assert(url.hostname === `db.${manifest.projectRef}.supabase.co` || decodeURIComponent(url.username).endsWith(`.${manifest.projectRef}`), 'WRONG_TARGET')
const client = new pg.Client({ connectionString: details.POSTGRES_URL, ssl: { rejectUnauthorized: false } })
try {
  await client.connect()
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='60s'; SET LOCAL search_path='';")
  const row = (await client.query('select version,name,statements from supabase_migrations.schema_migrations where version=$1', [migration.version])).rows
  assert.equal(row.length, 1, 'EXPLICIT_MIGRATION_NOT_APPLIED')
  assert.equal(row[0].name, migration.name, 'REMOTE_MIGRATION_NAME_MISMATCH')
  assert.equal(sha(row[0].statements.join('\n').replaceAll('\r\n','\n')), migration.sha256, 'REMOTE_MIGRATION_HASH_MISMATCH')
  assert.equal((await client.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1', [manifest.excludedVersions[0]])).rows[0].n, 0, 'ORIGINAL_A6_HISTORY_PRESENT')
  const catalog = (await client.query(readFileSync('scripts/qa/health/schema-catalog.sql', 'utf8'))).rows[0].objects
  const history = (await client.query("select count(*)::int n,md5(string_agg(to_jsonb(m)::text,'' order by version)) hash from supabase_migrations.schema_migrations m")).rows[0]
  const tables = (await client.query("select schemaname,tablename from pg_tables where schemaname in ('public','private') or (schemaname='storage' and tablename in ('objects','buckets')) order by schemaname,tablename")).rows
  const fingerprints = []
  const ident = s => '"' + s.replaceAll('"', '""') + '"'
  for (const t of tables) {
    const name = `${ident(t.schemaname)}.${ident(t.tablename)}`
    const value = (await client.query(`select count(*)::int n,md5(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text)) hash from ${name} t`)).rows[0]
    fingerprints.push({ table: `${t.schemaname}.${t.tablename}`, ...value })
  }
  const state = { target: manifest.projectRef, migrationHash: migration.sha256, catalogHash: sha(JSON.stringify(catalog)), history, fingerprints }
  if (mode === '--baseline') {
    // Exclusive creation prevents accidentally replacing the pre-change evidence.
    writeFileSync(file, JSON.stringify(state, null, 2), { flag: 'wx' })
  } else {
    assert.deepEqual(state, JSON.parse(readFileSync(file, 'utf8')), 'PREVIEW_STATE_CHANGED')
  }
  await client.query('ROLLBACK')
  console.log(JSON.stringify({ success: true, mode, migrationHashCheck: 'PASS', a6OriginalHistory: 'ABSENT',
    historyRows: history.n, nfs: fingerprints.find(t=>t.table==='public.notas_fiscais')?.n,
    objects: fingerprints.find(t=>t.table==='storage.objects')?.n, tablesChecked: fingerprints.length }))
} catch (e) {
  await client.query('ROLLBACK').catch(()=>{})
  console.error(JSON.stringify({ success: false, code: e.code || 'ASSERTION', message: String(e.message).split('\n')[0].slice(0,150) }))
  process.exitCode = 1
} finally {
  await client.end()
}
