import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { configureDisposableToml, sanitizedLocalEnvironment, fileSha256, redactCommandOutput } from '../../perf9e/clean-room-lib.mjs'
import { disposableResources, nativeSupabaseCli } from '../../email-intake/disposable-resources.mjs'
import { verifyMunicipalCompatibility } from './r1-1-municipal-db.mjs'
import { seedDocumentFixture } from './r1-2-document-fixture.mjs'
import { localStorageFixture } from './r1-2-storage.mjs'

// Deliberately no URL, project-ref, remote, linked or environment-file option.
assert.deepEqual(process.argv.slice(2), ['--local-only'])
const projectId = `bw_email03_r12_${Date.now()}`
const root = resolve('rehearsal/tmp', projectId)
const reportPath = resolve('rehearsal/reports/R1_2_FOCUSED_SQL.json')
const cli = await nativeSupabaseCli()
const env = sanitizedLocalEnvironment()
for (const key of Object.keys(env)) if (/SUPABASE|DATABASE|POSTGRES|EMAIL_INTAKE|SECRET|PASSWORD|TOKEN|CREDENTIAL|OPENAI/i.test(key)) delete env[key]
const migrations = JSON.parse(await readFile('scripts/qa/reconciliation/r1-1-focused-manifest.json', 'utf8'))
const schemaPath = resolve('../bw_antecipa_notificacoes/rehearsal/tmp/notificacoes-reference-schema.sql')
const metadataPath = resolve('../bw_antecipa_notificacoes/rehearsal/tmp/notificacoes-reference-metadata.json')
assert.equal(fileSha256(schemaPath), '23ab8782a97872210730a4fe85ab5ceb6682694ca8572d6c9f41f7f04c58c589')
assert.equal(fileSha256(metadataPath), 'a35fccc79017f786c58109933897a94706b37093dc752903aec2b04377afe08a')
for (const m of migrations) {
  assert.match(m.path, /^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/)
  assert(!m.path.includes('20260929193129'), 'ORIGINAL_A6_REFUSED')
  assert.equal(fileSha256(m.path), m.sha256, `MIGRATION_HASH_DRIFT:${m.path}`)
}
const source = JSON.parse(await readFile(metadataPath, 'utf8'))
const schema = await readFile(schemaPath, 'utf8')
assert(!/^COPY\s|^INSERT INTO\s|^SELECT pg_catalog.setval/m.test(schema), 'DATA_DUMP_REFUSED')
assert(!/CREATE TABLE[^\n]*"supabase_migrations"/i.test(schema), 'HISTORY_DUMP_REFUSED')
await mkdir(resolve(root, 'supabase/migrations'), { recursive: true })
await mkdir('rehearsal/reports', { recursive: true })
await writeFile(resolve(root, 'supabase/config.toml'), configureDisposableToml(await readFile('supabase/config.toml', 'utf8'), {
  projectId, apiPort: 57841, dbPort: 57842, shadowPort: 57840, studioPort: 57843, mailPort: 57844, analyticsPort: 57847,
}))
const evidence = { projectId, result: 'IN_PROGRESS', stage: 'BOOTSTRAP', productionChanged: false, homologChanged: false,
  originalA6Executed: false, historyFaked: false, baseline: { schemaSha256: fileSha256(schemaPath), metadataSha256: fileSha256(metadataPath) },
  migrations, applied: [], checks: [], cleanup: 'NOT_RUN' }
const owned = await disposableResources({ projectId, file: `rehearsal/reports/${projectId}-resources.json`, tempDirs: [root] })
const run = args => new Promise((done, reject) => {
  const child = spawn(cli, [...args, '--workdir', root], { env, windowsHide: true })
  let output = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { output += b })
  child.on('error', reject); child.on('exit', code => done({ code, output }))
})
const ident = text => '"' + text.replaceAll('"', '""') + '"'
const connection = { host: '127.0.0.1', port: 57842, user: 'postgres', password: 'postgres', database: 'postgres' }
let db
try {
  console.log(JSON.stringify({ stage: evidence.stage, projectId }))
  const start = await run(['start', '--exclude', 'realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'])
  await owned.capture()
  assert.equal(start.code, 0, redactCommandOutput(start.output).slice(-2000))
  db = new Client(connection); await db.connect()
  await db.query("SET statement_timeout='120s'; SET lock_timeout='5s'")
  evidence.stage = 'RESTORE_SCHEMA_ONLY'
  assert.equal((await db.query("select count(*)::int n from pg_tables where schemaname in ('public','private')")).rows[0].n, 0)
  await db.query('BEGIN')
  for (const kind of ['TABLES', 'SEQUENCES', 'FUNCTIONS']) await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${kind} FROM anon,authenticated,service_role`)
  const installed = new Set((await db.query('select extname from pg_extension')).rows.map(r => r.extname))
  for (const e of source.extensions) if (!installed.has(e.name)) {
    assert(['unaccent', 'pgcrypto', 'uuid-ossp'].includes(e.name), 'UNREVIEWED_EXTENSION')
    await db.query(`CREATE EXTENSION ${ident(e.name)} WITH SCHEMA ${ident(e.schema)}`)
  }
  await db.query(schema.replace('SET statement_timeout = 0;', "SET LOCAL statement_timeout='120s';").replace('SET lock_timeout = 0;', "SET LOCAL lock_timeout='5s';").replace('SET row_security = off;', ''))
  for (const p of source.storagePolicies ?? []) await db.query(`CREATE POLICY ${ident(p.policyname)} ON storage.${ident(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(r => r === 'public' ? 'PUBLIC' : ident(r)).join(',')}${p.qual ? ` USING (${p.qual})` : ''}${p.with_check ? ` WITH CHECK (${p.with_check})` : ''}`)
  for (const trigger of source.authTriggers ?? []) await db.query(trigger)
  for (const b of source.buckets ?? []) {
    assert.equal(b.public, false)
    await db.query('insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values($1,$2,$3,$4,$5)', [b.id,b.name,b.public,b.file_size_limit,b.allowed_mime_types])
  }
  await db.query('COMMIT')
  await db.query('SET search_path=public,extensions')
  evidence.fixture = await seedDocumentFixture(db,'SCHEMA_ONLY_MINIMAL')
  assert.deepEqual(await seedDocumentFixture(db,'SCHEMA_ONLY_MINIMAL'), evidence.fixture, 'FIXTURE_NOT_IDEMPOTENT')
  evidence.checks.push('MINIMAL_OFFICIAL_DOCUMENT_FIXTURE_IDEMPOTENT')
  for (const m of migrations) {
    evidence.stage = `MIGRATION:${m.path}`
    const entrypoints = ['public.fiscal_intake_reserve(jsonb,uuid,uuid,uuid,text,text,text,boolean)',
      'public.fiscal_intake_stage(uuid,uuid,bigint,jsonb,jsonb,text,text,bigint,text)',
      'private.fiscal_assert_nf(uuid,uuid,uuid,bigint)']
    const catalog = async () => (await db.query(`select oid::regprocedure::text signature,prosecdef,proconfig,proacl::text,proargnames
      from pg_proc where oid=any($1::regprocedure[]) order by oid::regprocedure::text`, [entrypoints])).rows
    const isForward = m.path.includes('20261006201914_')
    const before = isForward ? await catalog() : null
    await db.query(await readFile(m.path, 'utf8'))
    if (isForward) {
      evidence.sqlEntrypoints = await catalog()
      assert.deepEqual(evidence.sqlEntrypoints, before, 'SQL_EXTERNAL_SECURITY_OR_SIGNATURE_CHANGED')
      assert(evidence.sqlEntrypoints.every(p => p.prosecdef && p.proconfig.includes('search_path=""')))
      evidence.checks.push('FORWARD_EXTERNAL_SIGNATURE_ACL_DEFINER_SEARCH_PATH_PRESERVED')
    }
    evidence.applied.push(m)
  }
  evidence.checks.push('HASH_PINNED_EXPLICIT_CHAIN', 'HEALTH_BASELINE_THEN_RLX_THEN_FORWARD')
  console.log(JSON.stringify({ stage: 'SQL_TESTS', migrations: evidence.applied.length }))
  evidence.stage = 'MUNICIPAL_REAL_SQL'
  const status = await run(['status', '--output', 'json'])
  assert.equal(status.code, 0, 'LOCAL_API_STATUS_FAILED')
  const local = JSON.parse(status.output.slice(status.output.indexOf('{'),status.output.lastIndexOf('}')+1))
  const storage = localStorageFixture(local, projectId)
  await verifyMunicipalCompatibility(db, connection, storage, name => evidence.checks.push(name))
  evidence.result = 'PASS'
} catch (error) {
  evidence.result = 'FAIL'
  evidence.failure = { code: error.code ?? 'ASSERTION', message: redactCommandOutput(error.message).slice(0, 2000) }
  await db?.query('ROLLBACK').catch(() => {})
} finally {
  await db?.end().catch(() => {})
  try {
    await owned.cleanup(async () => { const stopped = await run(['stop', '--project-id', projectId, '--no-backup']); assert.equal(stopped.code, 0) })
    evidence.cleanup = 'PASS'
  } catch (error) { evidence.cleanup = 'FAIL'; evidence.cleanupFailure = error.message }
  await writeFile(reportPath, JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ result: evidence.result, stage: evidence.stage, failure: evidence.failure, cleanup: evidence.cleanup, checks: evidence.checks, reportPath }))
  if (evidence.result !== 'PASS' || evidence.cleanup !== 'PASS') process.exitCode = 1
}
