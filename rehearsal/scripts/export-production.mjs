import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  POSTGRES_IMAGE,
  SNAPSHOT_DIR,
  TMP_DIR,
  assertProductionReadOnlyConfig,
  ensureRuntimeDirectories,
  fileSha256,
  formatError,
  loadRehearsalEnv,
  remoteConnectionConfig,
  runPgTool,
  sqlLiteral,
  withPgClient,
  writeJson,
  writeSensitiveFile,
} from './lib.mjs'

const SENSITIVE_TABLE_PATTERN = /(credential|credencial|secret|segredo|token|senha|password|private.?key|api.?key)/iu

export function buildSafeAuthSql(users, identities) {
  const lines = [
    '-- Auth sanitizado: sem senhas, tokens, sessoes ou fatores MFA.',
    'begin;',
    'truncate table auth.users cascade;',
  ]

  for (const user of users) {
    lines.push(`insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
  phone, phone_confirmed_at, is_sso_user, deleted_at, is_anonymous
) values (
  ${sqlLiteral(user.instance_id, 'uuid')}, ${sqlLiteral(user.id, 'uuid')}, ${sqlLiteral(user.aud)},
  ${sqlLiteral(user.role)}, ${sqlLiteral(user.email)}, null, ${sqlLiteral(user.email_confirmed_at, 'timestamptz')},
  ${sqlLiteral(user.raw_app_meta_data ?? {}, 'jsonb')}, ${sqlLiteral(user.raw_user_meta_data ?? {}, 'jsonb')},
  ${sqlLiteral(user.is_super_admin, 'boolean')}, ${sqlLiteral(user.created_at, 'timestamptz')},
  ${sqlLiteral(user.updated_at, 'timestamptz')}, ${sqlLiteral(user.phone)},
  ${sqlLiteral(user.phone_confirmed_at, 'timestamptz')}, ${sqlLiteral(user.is_sso_user, 'boolean')},
  ${sqlLiteral(user.deleted_at, 'timestamptz')}, ${sqlLiteral(user.is_anonymous, 'boolean')}
);`)
  }

  for (const identity of identities) {
    const safeIdentity = {
      sub: identity.user_id,
      email: identity.email,
      email_verified: Boolean(identity.email),
      phone_verified: false,
    }
    lines.push(`insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id
) values (
  ${sqlLiteral(identity.provider_id)}, ${sqlLiteral(identity.user_id, 'uuid')},
  ${sqlLiteral(safeIdentity, 'jsonb')}, ${sqlLiteral(identity.provider)},
  ${sqlLiteral(identity.last_sign_in_at, 'timestamptz')}, ${sqlLiteral(identity.created_at, 'timestamptz')},
  ${sqlLiteral(identity.updated_at, 'timestamptz')}, ${sqlLiteral(identity.id, 'uuid')}
);`)
  }

  lines.push('commit;', '')
  return lines.join('\n')
}

export function buildStorageMetadataSql(buckets, objects) {
  const lines = [
    '-- Metadados de Storage; binarios e colunas gerenciadas incompatíveis ficam fora do P0.',
    'begin;',
  ]
  for (const bucket of buckets) {
    lines.push(`insert into storage.buckets (
  id, name, owner, created_at, updated_at, public, avif_autodetection,
  file_size_limit, allowed_mime_types, owner_id, type
) values (
  ${sqlLiteral(bucket.id)}, ${sqlLiteral(bucket.name)}, ${sqlLiteral(bucket.owner, 'uuid')},
  ${sqlLiteral(bucket.created_at, 'timestamptz')}, ${sqlLiteral(bucket.updated_at, 'timestamptz')},
  ${sqlLiteral(bucket.public, 'boolean')}, ${sqlLiteral(bucket.avif_autodetection, 'boolean')},
  ${sqlLiteral(bucket.file_size_limit, 'number')}, ${sqlLiteral(bucket.allowed_mime_types, 'text_array')},
  ${sqlLiteral(bucket.owner_id)}, ${sqlLiteral(bucket.type)}
);`)
  }
  for (const object of objects) {
    lines.push(`insert into storage.objects (
  id, bucket_id, name, owner, created_at, updated_at, last_accessed_at,
  metadata, version, owner_id, user_metadata
) values (
  ${sqlLiteral(object.id, 'uuid')}, ${sqlLiteral(object.bucket_id)}, ${sqlLiteral(object.name)},
  ${sqlLiteral(object.owner, 'uuid')}, ${sqlLiteral(object.created_at, 'timestamptz')},
  ${sqlLiteral(object.updated_at, 'timestamptz')}, ${sqlLiteral(object.last_accessed_at, 'timestamptz')},
  ${sqlLiteral(object.metadata, 'jsonb')}, ${sqlLiteral(object.version)}, ${sqlLiteral(object.owner_id)},
  ${sqlLiteral(object.user_metadata, 'jsonb')}
);`)
  }
  lines.push('commit;', '')
  return lines.join('\n')
}

async function main() {
  ensureRuntimeDirectories()
  const env = loadRehearsalEnv()
  const production = assertProductionReadOnlyConfig(env)
  const remote = remoteConnectionConfig(production.parsed)
  const temporaryDirectory = path.join(TMP_DIR, `export-${Date.now()}`)
  fs.mkdirSync(temporaryDirectory, { recursive: true })

  console.log('Export read-only de producao iniciado.')
  console.log(`Project ref confirmado: ${production.projectRef}`)
  console.log(`Imagem PostgreSQL: ${POSTGRES_IMAGE}`)

  const inventory = await withPgClient(remote, async (client) => {
    const version = await client.query("select current_setting('server_version') as server_version")
    const schemas = await client.query(`
      select nspname as schema_name
      from pg_namespace
      where nspname not like 'pg_%'
        and nspname <> 'information_schema'
      order by nspname
    `)
    const tables = await client.query(`
      select schemaname as table_schema, tablename as table_name
      from pg_tables
      where schemaname = 'public'
      order by tablename
    `)
    const users = await client.query(`
      select instance_id, id, aud, role, email, email_confirmed_at,
             coalesce(raw_app_meta_data, '{}'::jsonb) as raw_app_meta_data,
             coalesce(raw_user_meta_data, '{}'::jsonb) as raw_user_meta_data,
             is_super_admin, created_at, updated_at, phone, phone_confirmed_at,
             is_sso_user, deleted_at, is_anonymous
      from auth.users
      order by id
    `)
    const identities = await client.query(`
      select i.provider_id, i.user_id, i.provider, i.last_sign_in_at, i.created_at,
             i.updated_at, i.id, coalesce(i.identity_data ->> 'email', u.email) as email
      from auth.identities i
      join auth.users u on u.id = i.user_id
      order by i.id
    `)
    const storageColumns = await client.query(`
      select table_name, array_agg(column_name order by ordinal_position) as columns
      from information_schema.columns
      where table_schema = 'storage' and table_name in ('buckets', 'objects')
      group by table_name
      order by table_name
    `)
    const buckets = await client.query(`
      select id, name, owner, created_at, updated_at, public, avif_autodetection,
             file_size_limit, allowed_mime_types, owner_id, type
      from storage.buckets
      order by id
    `)
    const objects = await client.query(`
      select id, bucket_id, name, owner, created_at, updated_at, last_accessed_at,
             metadata, version, owner_id, user_metadata
      from storage.objects
      order by bucket_id, name, id
    `)
    return {
      serverVersion: version.rows[0].server_version,
      schemas: schemas.rows.map((row) => row.schema_name),
      tables: tables.rows,
      users: users.rows,
      identities: identities.rows,
      storageColumns: storageColumns.rows,
      buckets: buckets.rows,
      objects: objects.rows,
    }
  }, { readOnly: true })

  if (!String(inventory.serverVersion).startsWith('17.')) {
    throw new Error(`Versao PostgreSQL inesperada em producao: ${inventory.serverVersion}.`)
  }

  const sensitiveTables = inventory.tables.filter((table) => SENSITIVE_TABLE_PATTERN.test(table.table_name))
  const exclusions = sensitiveTables.flatMap((table) => ['--exclude-table-data', `${table.table_schema}.${table.table_name}`])

  runPgTool('pg_dump', [
    '--format=custom',
    '--file=/output/production-public.dump',
    '--no-owner',
    '--schema=public',
    ...exclusions,
  ], { connection: remote, outputDirectory: temporaryDirectory, readOnly: true })

  runPgTool('pg_dump', [
    '--format=plain',
    '--file=/output/production-migration-history.sql',
    '--data-only',
    '--column-inserts',
    '--no-owner',
    '--table=supabase_migrations.schema_migrations',
  ], { connection: remote, outputDirectory: temporaryDirectory, readOnly: true })

  writeSensitiveFile(
    path.join(temporaryDirectory, 'production-auth-sanitized.sql'),
    buildSafeAuthSql(inventory.users, inventory.identities),
  )
  writeSensitiveFile(
    path.join(temporaryDirectory, 'production-storage-metadata.sql'),
    buildStorageMetadataSql(inventory.buckets, inventory.objects),
  )

  const artifactNames = [
    'production-public.dump',
    'production-storage-metadata.sql',
    'production-migration-history.sql',
    'production-auth-sanitized.sql',
  ]
  const manifest = {
    format_version: 1,
    generated_at: new Date().toISOString(),
    source_project_ref: production.projectRef,
    source_postgres_version: inventory.serverVersion,
    public_tables: inventory.tables.map((table) => table.table_name),
    source_schemas: inventory.schemas,
    source_storage_columns: inventory.storageColumns,
    restored_storage_columns: {
      buckets: ['id', 'name', 'owner', 'created_at', 'updated_at', 'public', 'avif_autodetection', 'file_size_limit', 'allowed_mime_types', 'owner_id', 'type'],
      objects: ['id', 'bucket_id', 'name', 'owner', 'created_at', 'updated_at', 'last_accessed_at', 'metadata', 'version', 'owner_id', 'user_metadata'],
    },
    included: ['public schema e dados', 'auth.users/identities sanitizados', 'storage.buckets/objects metadata', 'migration history'],
    excluded: ['auth passwords/tokens/sessions/MFA', 'storage binaries', 'storage versioning_status/archived_at/delete markers', 'vault', 'public sensitive table data'],
    sensitive_public_tables_without_data: sensitiveTables.map((table) => `${table.table_schema}.${table.table_name}`),
    artifacts: Object.fromEntries(artifactNames.map((name) => [name, fileSha256(path.join(temporaryDirectory, name))])),
  }
  writeJson(path.join(temporaryDirectory, 'manifest.json'), manifest)

  fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true })
  fs.renameSync(temporaryDirectory, SNAPSHOT_DIR)
  console.log(`Export concluido com ${inventory.users.length} usuarios Auth sanitizados.`)
  console.log(`Tabelas publicas com dados sensiveis excluidos: ${sensitiveTables.length}.`)
  console.log('Snapshot salvo em rehearsal/snapshots/current (ignorado pelo Git).')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Exportacao abortada: ${formatError(error)}`)
    process.exitCode = 1
  })
}
