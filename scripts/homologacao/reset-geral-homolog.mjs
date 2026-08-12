#!/usr/bin/env node
import { Client } from 'pg'
import {
  assertHomologEnvironment,
  createAdminClient,
  listAllAuthUsers,
  loadEnvFile,
  maskDbUrl,
  parseArgs,
} from '../perf9a/common.mjs'

const PRESERVED_PUBLIC_TABLES = new Set([
  // Catalogo tecnico criado e evoluido por migrations. Sem ele, os fluxos
  // documentais nao conseguem resolver os tipos de documento apos o reset.
  'documento_tipos',
])

const args = parseArgs()

try {
  await main()
} catch (error) {
  console.error(`\nReset geral de homologacao falhou: ${safeErrorMessage(error)}\n`)
  process.exitCode = 1
}

async function main() {
  if (args.help === true) {
    printHelp()
    return
  }

  loadEnvFile(args['env-file'] || '.env.homolog')
  const env = assertHomologEnvironment()
  assertDatabaseConfigured(env)
  assertExpectedProjectRef(args['expected-project-ref'], env.projectRef)
  assertDatabaseMatchesProject(env.dbUrl, env.projectRef)

  const execute = args.execute === true
  const confirmation = buildConfirmation(env.projectRef)
  const admin = createAdminClient(env)
  const db = createDatabaseClient(env.dbUrl)

  console.log(`\nBW Antecipa - RESET GERAL DE HOMOLOGACAO (${execute ? 'EXECUCAO DESTRUTIVA' : 'PREVIEW'})`)
  printEnvironment(env)
  console.log('Escopo: dados funcionais publicos, usuarios Auth e objetos de todos os buckets')
  console.log(`Preservado: schema, migrations, buckets e catalogo tecnico (${[...PRESERVED_PUBLIC_TABLES].join(', ')})`)

  try {
    await db.connect()
    const before = await collectSnapshot(db, admin)
    printSnapshot('Estado atual', before)
    await validateTruncatePlan(db, before.applicationTables.map((item) => item.table))
    console.log('- plano transacional de limpeza SQL: validado')

    if (!execute) {
      console.log('\nPREVIEW concluido. Nenhum dado foi alterado.')
      console.log('Para executar o reset irreversivel:')
      console.log(buildExecuteCommand(env.projectRef, confirmation))
      return
    }

    assertDestructiveConfirmation(args.confirm, confirmation)

    console.log('\n[1/4] Esvaziando todos os buckets via Storage API...')
    await emptyAllBuckets(admin, before.buckets)

    console.log('[2/4] Removendo todos os dados funcionais do schema public...')
    await truncateApplicationTables(db, before.applicationTables.map((item) => item.table))

    console.log('[3/4] Removendo todos os usuarios do Supabase Auth...')
    await deleteAllAuthUsers(admin, before.authUsers)

    console.log('[4/4] Verificando ausencia de residuos funcionais...')
    const after = await collectSnapshot(db, admin)
    assertResetCompleted(after)
    printSnapshot('Estado apos reset', after)

    console.log('\nReset geral de homologacao concluido.')
    console.log('O ambiente nao possui usuarios. Cadastre novamente os perfis necessarios para iniciar o fluxo do zero.')
  } finally {
    await db.end().catch(() => undefined)
  }
}

function createDatabaseClient(dbUrl) {
  return new Client({
    connectionString: dbUrl,
    application_name: 'bw_antecipa_reset_geral_homolog',
    statement_timeout: 180_000,
    query_timeout: 180_000,
    ssl: { rejectUnauthorized: false },
  })
}

async function collectSnapshot(db, admin) {
  const applicationTables = await listApplicationTables(db)
  const counts = []

  for (const table of applicationTables) {
    const result = await db.query(`SELECT count(*)::bigint AS total FROM ${qualifiedIdentifier('public', table)}`)
    counts.push({ table, count: Number(result.rows[0].total) })
  }

  const authUsers = await listAllAuthUsers(admin)
  const { data: buckets, error: bucketError } = await admin.storage.listBuckets()
  if (bucketError) throw new Error(`Nao foi possivel listar os buckets: ${bucketError.message}`)

  const storageResult = await db.query(`
    SELECT bucket_id, count(*)::bigint AS total
    FROM storage.objects
    GROUP BY bucket_id
    ORDER BY bucket_id
  `)
  const objectsByBucket = new Map(storageResult.rows.map((row) => [String(row.bucket_id), Number(row.total)]))
  const normalizedBuckets = (buckets || []).map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    count: objectsByBucket.get(String(bucket.id)) || 0,
  }))

  return {
    applicationTables: counts,
    authUsers,
    buckets: normalizedBuckets,
  }
}

async function listApplicationTables(db) {
  const result = await db.query(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `)

  return result.rows
    .map((row) => String(row.table_name))
    .filter((table) => !PRESERVED_PUBLIC_TABLES.has(table))
}

async function emptyAllBuckets(admin, buckets) {
  for (const bucket of buckets) {
    const { error } = await admin.storage.emptyBucket(bucket.id)
    if (error) throw new Error(`Falha ao esvaziar o bucket ${bucket.name}: ${error.message}`)
    console.log(`  - ${bucket.name}: ${bucket.count} objeto(s) removido(s)`)
  }
}

async function truncateApplicationTables(db, tables) {
  if (tables.length === 0) return

  await db.query('BEGIN')
  try {
    await runTruncate(db, tables)
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

async function validateTruncatePlan(db, tables) {
  if (tables.length === 0) return

  await db.query('BEGIN')
  try {
    await runTruncate(db, tables)
  } finally {
    await db.query('ROLLBACK').catch(() => undefined)
  }
}

async function runTruncate(db, tables) {
  const targets = tables.map((table) => qualifiedIdentifier('public', table)).join(',\n      ')
  await db.query(`
    TRUNCATE TABLE
      ${targets}
    RESTART IDENTITY
  `)
}

async function deleteAllAuthUsers(admin, users) {
  let removed = 0
  for (const user of users) {
    const { error } = await admin.auth.admin.deleteUser(user.id, false)
    if (error) throw new Error(`Falha ao remover usuario Auth ${removed + 1}/${users.length}: ${error.message}`)
    removed += 1
  }
  console.log(`  - ${removed} usuario(s) Auth removido(s)`)
}

function assertResetCompleted(snapshot) {
  const residualTables = snapshot.applicationTables.filter((item) => item.count > 0)
  const residualBuckets = snapshot.buckets.filter((item) => item.count > 0)

  if (residualTables.length > 0 || snapshot.authUsers.length > 0 || residualBuckets.length > 0) {
    const details = [
      ...residualTables.map((item) => `public.${item.table}=${item.count}`),
      ...(snapshot.authUsers.length > 0 ? [`auth.users=${snapshot.authUsers.length}`] : []),
      ...residualBuckets.map((item) => `storage.${item.name}=${item.count}`),
    ]
    throw new Error(`O reset deixou residuos: ${details.join(', ')}`)
  }
}

function printSnapshot(label, snapshot) {
  const tablesWithData = snapshot.applicationTables.filter((item) => item.count > 0)
  const publicRows = tablesWithData.reduce((total, item) => total + item.count, 0)
  const storageObjects = snapshot.buckets.reduce((total, item) => total + item.count, 0)

  console.log(`\n${label}:`)
  console.log(`- tabelas publicas no escopo: ${snapshot.applicationTables.length}`)
  console.log(`- tabelas publicas com dados: ${tablesWithData.length}`)
  console.log(`- registros publicos no escopo: ${publicRows}`)
  console.log(`- usuarios Auth: ${snapshot.authUsers.length}`)
  console.log(`- buckets preservados: ${snapshot.buckets.length}`)
  console.log(`- objetos no Storage: ${storageObjects}`)
}

function assertDatabaseConfigured(env) {
  if (!env.dbUrl) throw new Error('SUPABASE_DB_URL e obrigatoria para o reset geral.')
}

function assertExpectedProjectRef(expected, actual) {
  if (!expected || expected !== actual) {
    throw new Error(`Projeto nao confirmado. Informe exatamente --expected-project-ref ${actual}.`)
  }
}

function assertDatabaseMatchesProject(dbUrl, projectRef) {
  let parsed
  try {
    parsed = new URL(dbUrl)
  } catch {
    throw new Error('SUPABASE_DB_URL invalida.')
  }

  const identity = `${parsed.hostname}:${parsed.username}`.toLowerCase()
  if (!identity.includes(projectRef.toLowerCase())) {
    throw new Error('SUPABASE_DB_URL nao pertence ao mesmo projeto indicado por NEXT_PUBLIC_SUPABASE_URL.')
  }
}

function assertDestructiveConfirmation(value, expected) {
  if (value !== expected) {
    throw new Error(`Confirmacao destrutiva invalida. Informe exatamente --confirm ${expected}.`)
  }
}

function buildConfirmation(projectRef) {
  return `RESETAR_TODA_HOMOLOGACAO_${projectRef}`
}

function buildExecuteCommand(projectRef, confirmation) {
  return `npm run reset:geral:homolog -- --execute --expected-project-ref ${projectRef} --confirm ${confirmation}`
}

function qualifiedIdentifier(schema, table) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function printEnvironment(env) {
  console.log(`Ambiente: ${env.appEnv}`)
  console.log(`Projeto Supabase: ${env.projectRef}`)
  console.log(`API: ${new URL(env.supabaseUrl).host}`)
  console.log(`DB: ${maskDbUrl(env.dbUrl)}`)
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function printHelp() {
  console.log(`
Reset geral e irreversivel do ambiente de homologacao.

Preview:
  npm run reset:geral:homolog -- --expected-project-ref <project-ref>

Execucao:
  npm run reset:geral:homolog -- --execute --expected-project-ref <project-ref> --confirm RESETAR_TODA_HOMOLOGACAO_<project-ref>

Opcoes:
  --env-file <arquivo>          Arquivo de ambiente; padrao: .env.homolog
  --expected-project-ref <ref>  Confirma explicitamente o projeto Supabase
  --execute                     Habilita a operacao destrutiva
  --confirm <frase>             Frase de confirmacao vinculada ao project ref
  --help                        Exibe esta ajuda
`)
}
