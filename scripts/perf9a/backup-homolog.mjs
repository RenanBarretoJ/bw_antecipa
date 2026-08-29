#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import {
  PERF9A_EMAIL_DOMAIN,
  PERF9A_STORAGE_PREFIX,
  PERF9A_TABLES,
  assertHomologEnvironment,
  createAdminClient,
  fetchAllRows,
  getPerf9aLocalDir,
  listAllAuthUsers,
  loadEnvFile,
  parseArgs,
  printEnvironmentSummary,
  writeRestrictedJson,
} from './common.mjs'

const args = parseArgs()

try {
  await main()
} catch (error) {
  console.error(`\nSnapshot PERF9A falhou: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

async function main() {
  loadEnvFile(args['env-file'])
  const env = assertHomologEnvironment()
  const supabase = createAdminClient(env)
  const startedAt = new Date()
  const timestamp = startedAt.toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(getPerf9aLocalDir('backups'), `preload-${env.projectRef}-${timestamp}.json`)

  console.log('\nBW Antecipa - snapshot logico pre-carga PERF9A')
  printEnvironmentSummary(env)
  console.log(`Destino: ${backupPath}`)

  const tables = {}
  for (const table of PERF9A_TABLES) {
    const rows = await fetchAllRows(supabase, table)
    tables[table] = rows
    console.log(`- ${table}: ${rows.length}`)
  }

  const authUsers = await listAllAuthUsers(supabase)
  const storage = await listStoragePrefix(supabase)
  const snapshot = {
    metadata: {
      format: 'bw-antecipa-perf9a-logical-snapshot-v1',
      projectRef: env.projectRef,
      appEnv: env.appEnv,
      createdAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      authUsersTotal: authUsers.length,
      perf9aAuthUsersBefore: authUsers.filter((user) => user.email?.endsWith(`@${PERF9A_EMAIL_DOMAIN}`)).length,
      storagePrefix: PERF9A_STORAGE_PREFIX,
      storageObjectsBefore: storage.length,
    },
    tables,
    auth: authUsers.map((user) => ({
      id: user.id,
      email: user.email,
      role: user.user_metadata?.role ?? null,
      created_at: user.created_at,
      updated_at: user.updated_at,
      last_sign_in_at: user.last_sign_in_at,
      banned_until: user.banned_until,
    })),
    storage,
  }

  const canonical = JSON.stringify(snapshot)
  snapshot.metadata.sha256 = createHash('sha256').update(canonical).digest('hex')
  writeRestrictedJson(backupPath, snapshot)

  console.log(`\nSnapshot concluido: ${backupPath}`)
  console.log(`SHA-256: ${snapshot.metadata.sha256}`)
  console.log('Nenhuma linha foi alterada.')
}

async function listStoragePrefix(supabase) {
  const objects = []
  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets()
  if (bucketsError) throw new Error(`Falha ao listar buckets: ${bucketsError.message}`)

  for (const bucket of buckets || []) {
    const { data, error } = await supabase.storage
      .from(bucket.name)
      .list(PERF9A_STORAGE_PREFIX.replace(/\/$/, ''), { limit: 1000 })
    if (error && !/not found/i.test(error.message)) {
      throw new Error(`Falha ao listar Storage ${bucket.name}: ${error.message}`)
    }
    for (const object of data || []) {
      objects.push({
        bucket: bucket.name,
        name: object.name,
        id: object.id,
        created_at: object.created_at,
        updated_at: object.updated_at,
        metadata: object.metadata,
      })
    }
  }

  return objects
}
