import fs from 'node:fs'
import path from 'node:path'
import {
  SNAPSHOT_DIR,
  assertLocalTarget,
  fileSha256,
  formatError,
  localPgConfig,
  run,
  runPgTool,
  withPgClient,
} from './lib.mjs'

const ARTIFACTS = [
  'production-public.dump',
  'production-storage-metadata.sql',
  'production-migration-history.sql',
  'production-auth-sanitized.sql',
]
const LOCAL_DB_CONTAINER = 'supabase_db_bw-antecipa-prod-rehearsal'
const CONTAINER_PUBLIC_DUMP = '/tmp/bw-antecipa-production-public.dump'

async function main() {
  assertLocalTarget()
  const manifestPath = path.join(SNAPSHOT_DIR, 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error('Snapshot ausente. Execute rehearsal:export:production primeiro.')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  for (const artifact of ARTIFACTS) {
    const artifactPath = path.join(SNAPSHOT_DIR, artifact)
    if (!fs.existsSync(artifactPath)) throw new Error(`Artefato ausente: ${artifact}.`)
    if (manifest.artifacts?.[artifact] !== fileSha256(artifactPath)) throw new Error(`Checksum invalido: ${artifact}.`)
  }

  const local = localPgConfig()
  const localAdmin = { ...local, user: 'supabase_admin' }
  await withPgClient(local, async (client) => {
    const version = await client.query("select current_setting('server_version') as server_version")
    if (!String(version.rows[0].server_version).startsWith('17.')) throw new Error('PostgreSQL local nao e major 17.')
    await client.query("select set_config('app.rehearsal_target', 'local-only', false)")
    await client.query(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key,
        statements text[],
        name text
      );
    `)
  })

  // Remover primeiro os schemas recriados pelas migrations elimina as FKs
  // que apontam para Auth. O snapshot de origem nao possui schema private.
  // Assim, o TRUNCATE CASCADE de auth.users permanece restrito ao schema Auth
  // e nao tenta truncar tabelas publicas pertencentes a supabase_admin.
  await withPgClient(localAdmin, async (client) => {
    await client.query('drop schema if exists private cascade; drop schema if exists public cascade')
  })

  console.log('Restaurando Auth sanitizado no rehearsal local...')
  runPgTool('psql', ['--set=ON_ERROR_STOP=1', '--file=/output/production-auth-sanitized.sql'], {
    connection: localAdmin,
    outputDirectory: SNAPSHOT_DIR,
  })

  console.log('Restaurando schema e dados publicos...')
  run('docker', ['cp', path.join(SNAPSHOT_DIR, 'production-public.dump'), `${LOCAL_DB_CONTAINER}:${CONTAINER_PUBLIC_DUMP}`])
  try {
    run('docker', [
      'exec', LOCAL_DB_CONTAINER,
      'pg_restore',
      '--username=supabase_admin',
      '--exit-on-error',
      '--no-owner',
      '--dbname=postgres',
      CONTAINER_PUBLIC_DUMP,
    ])
  } finally {
    run('docker', ['exec', LOCAL_DB_CONTAINER, 'rm', '-f', CONTAINER_PUBLIC_DUMP])
  }

  await withPgClient(local, async (client) => {
    await client.query('truncate table storage.objects, storage.buckets cascade')
    await client.query('truncate table supabase_migrations.schema_migrations')
  })

  console.log('Restaurando metadados de Storage (sem binarios)...')
  runPgTool('psql', ['--set=ON_ERROR_STOP=1', '--file=/output/production-storage-metadata.sql'], {
    connection: local,
    outputDirectory: SNAPSHOT_DIR,
  })

  console.log('Restaurando migration history de producao...')
  runPgTool('psql', ['--set=ON_ERROR_STOP=1', '--file=/output/production-migration-history.sql'], {
    connection: local,
    outputDirectory: SNAPSHOT_DIR,
  })

  console.log('Restore local concluido. Nenhuma migration de upgrade foi aplicada.')
}

main().catch((error) => {
  console.error(`Restore abortado: ${formatError(error)}`)
  process.exitCode = 1
})
