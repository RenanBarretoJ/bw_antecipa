#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Client } from 'pg'
import { parseArgs } from '../perf9a/common.mjs'
import {
  assertCleanRoomArguments,
  fileSha256,
  redactCommandOutput,
  sha256,
  stableCatalogRows,
} from './clean-room-lib.mjs'

const POSTGRES_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.156'
const STORAGE_IMAGE = 'public.ecr.aws/supabase/storage-api:v1.67.20'
const STORAGE_CORE_MAX_MIGRATION = 46
const EXPECTED_ACTIVE_MIGRATIONS = 73
const args = parseArgs()
const repositoryRoot = process.cwd()
const candidatePath = resolve(repositoryRoot, 'scripts/perf9e/bootstrap/schema-base-candidate.sql')

try {
  await main()
} catch (error) {
  console.error(`\nClean-room de banco 9E falhou: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

async function main() {
  assertCleanRoomArguments(args)
  assertDockerAvailable()
  assertImageAvailable(POSTGRES_IMAGE)
  assertImageAvailable(STORAGE_IMAGE)

  const migrationDirectory = resolve(repositoryRoot, 'supabase/migrations')
  const activeFiles = readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql')).sort()
  if (activeFiles.length !== EXPECTED_ACTIVE_MIGRATIONS) throw new Error(`Esperadas ${EXPECTED_ACTIVE_MIGRATIONS} migrations ativas; encontradas ${activeFiles.length}.`)
  if (activeFiles.some((name) => /^(001|002)_/.test(name))) throw new Error('001/002 nao podem estar na cadeia ativa durante o Escopo 9E.')
  if (!existsSync(candidatePath)) throw new Error('Bootstrap candidato nao encontrado.')

  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const root = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'perf9e', 'database-clean-room', runId)
  const platformDirectory = resolve(root, 'platform-storage-core')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  extractStorageMigrations(platformDirectory)
  const storageMigrations = readdirSync(platformDirectory)
    .filter((name) => name.endsWith('.sql') && migrationNumber(name) <= STORAGE_CORE_MAX_MIGRATION)
    .sort(compareMigrationNames)

  const evidence = {
    metadata: {
      format: 'bw-antecipa-perf9e-database-clean-room-v1',
      startedAt: new Date().toISOString(),
      target: 'two-fresh-local-disposable-postgres-containers',
      postgresImage: POSTGRES_IMAGE,
      storagePlatformImage: STORAGE_IMAGE,
      storageCoreMigrations: storageMigrations.length,
      activeMigrationCount: activeFiles.length,
      bootstrapCandidateSha256: fileSha256(candidatePath),
      sourceManifestSha256: sha256(activeFiles.map((name) => `${name}:${fileSha256(resolve(migrationDirectory, name))}`).join('\n')),
      remoteConnectionUsed: false,
      remoteMutationExecuted: false,
      seedEnabled: false,
      exactCyclesRequired: 2,
    },
    cycles: [],
  }

  for (let cycle = 1; cycle <= 2; cycle += 1) {
    const cycleResult = await runCycle({ cycle, runId, root, storageMigrations, platformDirectory, activeFiles, migrationDirectory })
    evidence.cycles.push(cycleResult)
    writeEvidence(root, evidence)
    if (!cycleResult.success) break
  }

  evidence.metadata.finishedAt = new Date().toISOString()
  evidence.metadata.success = evidence.cycles.length === 2 && evidence.cycles.every((cycle) => cycle.success)
  evidence.metadata.reproducible = evidence.metadata.success
    && evidence.cycles[0].catalog.sha256 === evidence.cycles[1].catalog.sha256
    && evidence.cycles[0].schemaDump.sha256 === evidence.cycles[1].schemaDump.sha256
  evidence.metadata.payloadSha256 = sha256(JSON.stringify(evidence))
  const path = writeEvidence(root, evidence)

  console.log('\nBW Antecipa - Escopo 9E / database clean-room')
  for (const cycle of evidence.cycles) {
    console.log(`Ciclo ${cycle.cycle}: ${cycle.success ? 'APROVADO' : 'FALHOU'} (${cycle.applicationMigrations.filter((item) => item.success).length}/${EXPECTED_ACTIVE_MIGRATIONS + 1} com bootstrap)`)
    if (cycle.failure) console.log(`  Falha: ${cycle.failure.stage} / ${cycle.failure.migration ?? 'nao identificada'} / ${cycle.failure.sqlstate ?? 'sem SQLSTATE'}`)
  }
  console.log(`Reprodutivel por dump e catalogo: ${evidence.metadata.reproducible ? 'SIM' : 'NAO'}`)
  console.log(`Evidencia local restrita: ${path}`)
  console.log('Nenhuma conexao remota foi utilizada.')
  if (!evidence.metadata.reproducible) process.exitCode = 1
}

async function runCycle({ cycle, runId, root, storageMigrations, platformDirectory, activeFiles, migrationDirectory }) {
  const compactRunId = runId.replace(/[^0-9]/g, '').slice(0, 14)
  const containerName = `bw_antecipa_perf9e_db_${compactRunId}_${cycle}`
  const hostPort = 57602 + (cycle * 20)
  const cycleDirectory = resolve(root, `cycle-${cycle}`)
  mkdirSync(cycleDirectory, { recursive: true, mode: 0o700 })
  const result = {
    cycle,
    containerName,
    hostPort,
    startedAt: new Date().toISOString(),
    platformMigrations: [],
    applicationMigrations: [],
    migrationHistory: [],
    functionalChecks: [],
    commands: [],
    failure: null,
    success: false,
  }

  removeContainerIfPresent(containerName)
  const start = runDocker(['run', '--rm', '--name', containerName, '-e', 'POSTGRES_PASSWORD=postgres', '-p', `127.0.0.1:${hostPort}:5432`, '-d', POSTGRES_IMAGE])
  result.commands.push(start)
  if (start.exitCode !== 0) return fail(result, 'docker run', null, start.stderr)

  let client
  try {
    client = await waitForDatabase(hostPort)
    await preparePlatform(client, storageMigrations, platformDirectory, result)
    await prepareMigrationHistory(client)

    const applicationFiles = [
      { version: '001', name: 'schema_base_candidate', path: candidatePath },
      ...activeFiles.map((filename) => {
        const match = filename.match(/^(\d+)_([^.]*)\.sql$/)
        if (!match) throw new Error(`Nome de migration invalido: ${filename}`)
        return { version: match[1], name: match[2], path: resolve(migrationDirectory, filename) }
      }),
    ]

    for (const migration of applicationFiles) {
      const item = await applyMigration(client, migration)
      result.applicationMigrations.push(item)
      if (!item.success) {
        result.failure = { stage: 'application migration', migration: basename(migration.path), sqlstate: item.sqlstate, message: item.message }
        return result
      }
    }

    result.migrationHistory = (await client.query('SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version')).rows
    result.functionalChecks = await runFunctionalChecks(client)
    if (result.functionalChecks.some((check) => !check.passed)) {
      result.failure = { stage: 'functional checks', migration: null, sqlstate: null, message: result.functionalChecks.filter((check) => !check.passed).map((check) => check.name).join(', ') }
      return result
    }

    result.catalog = await collectCatalog(client)
    const dumpPath = resolve(cycleDirectory, 'schema-clean-final.sql')
    const dump = runDocker(['exec', containerName, 'pg_dump', '-U', 'supabase_admin', '--schema-only', '--no-owner', '--no-privileges', '--schema=public', '--schema=private', '--schema=storage', 'postgres'], { maxBuffer: 128 * 1024 * 1024 })
    result.commands.push({ ...dump, stdout: dump.exitCode === 0 ? '[SCHEMA_DUMP_WRITTEN_TO_RESTRICTED_FILE]' : dump.stdout })
    if (dump.exitCode !== 0) return fail(result, 'pg_dump', null, dump.stderr)
    writeFileSync(dumpPath, dump.rawStdout, { encoding: 'utf8', mode: 0o600 })
    result.schemaDump = { path: dumpPath, bytes: Buffer.byteLength(dump.rawStdout), sha256: sha256(normalizeDump(dump.rawStdout)) }
    result.success = true
    result.finishedAt = new Date().toISOString()
    return result
  } catch (error) {
    result.failure = { stage: 'unexpected', migration: null, sqlstate: error?.code ?? null, message: redactCommandOutput(error instanceof Error ? error.message : String(error)) }
    return result
  } finally {
    if (client) await client.end().catch(() => undefined)
    const stop = runDocker(['stop', '--time', '20', containerName])
    result.commands.push(stop)
    result.stoppedAt = new Date().toISOString()
  }
}

async function preparePlatform(client, storageMigrations, platformDirectory, result) {
  await client.query('REVOKE authenticator FROM postgres')
  for (const filename of storageMigrations) {
    const startedAt = Date.now()
    try {
      await client.query(readFileSync(resolve(platformDirectory, filename), 'utf8'))
      result.platformMigrations.push({ filename, success: true, durationMs: Date.now() - startedAt })
    } catch (error) {
      result.platformMigrations.push({ filename, success: false, durationMs: Date.now() - startedAt, sqlstate: error.code ?? null, message: redactCommandOutput(error.message) })
      throw new Error(`Bootstrap da plataforma Storage falhou em ${filename}: ${error.message}`, { cause: error })
    }
  }
  await client.query(`
    CREATE OR REPLACE FUNCTION auth.jwt()
    RETURNS jsonb
    LANGUAGE sql
    STABLE
    AS $$
      SELECT coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
      )::jsonb
    $$
  `)
}

async function prepareMigrationHistory(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text PRIMARY KEY,
      statements text[] NOT NULL DEFAULT '{}',
      name text
    );
  `)
}

async function applyMigration(client, migration) {
  const startedAt = Date.now()
  const sql = readFileSync(migration.path, 'utf8')
  try {
    await client.query(sql)
    await client.query('INSERT INTO supabase_migrations.schema_migrations(version, statements, name) VALUES ($1, $2, $3)', [migration.version, [sql], migration.name])
    return { version: migration.version, name: migration.name, filename: basename(migration.path), sha256: sha256(sql), durationMs: Date.now() - startedAt, success: true }
  } catch (error) {
    return { version: migration.version, name: migration.name, filename: basename(migration.path), sha256: sha256(sql), durationMs: Date.now() - startedAt, success: false, sqlstate: error.code ?? null, message: redactCommandOutput(error.message) }
  }
}

async function runFunctionalChecks(client) {
  const checks = []
  const scalar = async (name, sql, params = []) => {
    const passed = (await client.query(sql, params)).rows[0]?.ok === true
    checks.push({ name, passed })
  }
  await scalar('9B: RLS habilitado nas tabelas publicas sensiveis', `SELECT bool_and(c.relrowsecurity) ok FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('fundos','cedentes','cedente_fundos','notas_fiscais','operacoes','documentos')`)
  await scalar('9B: helpers privados finais existem', `SELECT count(*) = 5 ok FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN ('usuario_tem_acesso_fundo','consultor_tem_acesso_cedente','sacado_tem_acesso_operacao','sacado_tem_acesso_operacao_nf','usuario_pode_ler_objeto_storage')`)
  await scalar('9B: SECURITY DEFINER possui search_path', `SELECT coalesce(bool_and(p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')),true) ok FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prosecdef`)
  await scalar('9C: storage.objects com RLS', `SELECT c.relrowsecurity ok FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relname='objects'`)
  await scalar('9C: policy final delega autorizacao ao helper privado', `SELECT count(*) = 1 ok FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='storage_private_objects_select_authorized' AND qual ILIKE '%usuario_pode_ler_objeto_storage%'`)
  await scalar('9C: buckets privados configurados', `SELECT count(*) = 6 AND bool_and(public=false) ok FROM storage.buckets`)

  const gestorId = '10000000-0000-4000-8000-000000000001'
  const fundoA = '20000000-0000-4000-8000-000000000001'
  const fundoB = '20000000-0000-4000-8000-000000000002'
  await client.query('BEGIN')
  try {
    await client.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,'perf9e-gestor@local.invalid','{"nome_completo":"Gestor 9E","role":"gestor"}'::jsonb)`, [gestorId])
    await client.query(`INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj) VALUES ($1,'Fundo A','00000000000001','Admin','00000000000001'),($2,'Fundo B','00000000000002','Admin','00000000000002')`, [fundoA, fundoB])
    await client.query(`INSERT INTO public.usuario_fundos(usuario_id,fundo_id,status,principal) VALUES ($1,$2,'ativo',true)`, [gestorId, fundoA])
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: gestorId, role: 'authenticated', aal: 'aal2' })])
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [gestorId])
    await client.query('SET LOCAL ROLE authenticated')
    const access = (await client.query('SELECT private.usuario_tem_acesso_fundo($1) permitido, private.usuario_tem_acesso_fundo($2) cruzado', [fundoA, fundoB])).rows[0]
    checks.push({ name: '9B funcional: gestor acessa somente fundo autorizado', passed: access.permitido === true && access.cruzado === false })
    const visibleFunds = Number((await client.query('SELECT count(*) count FROM public.fundos')).rows[0].count)
    checks.push({ name: '9B funcional: SELECT com RLS nao vaza outro fundo', passed: visibleFunds === 1 })
    const unknownStorage = (await client.query(`SELECT private.usuario_pode_ler_objeto_storage('notas-fiscais','fundo-inexistente/arquivo.pdf') ok`)).rows[0].ok
    checks.push({ name: '9C funcional reduzido: objeto sem vinculo e negado', passed: unknownStorage === false })
    await client.query('RESET ROLE')
  } finally {
    await client.query('ROLLBACK')
  }
  return checks
}

async function collectCatalog(client) {
  const queries = catalogQueries()
  const snapshot = {}
  for (const [name, sql] of Object.entries(queries)) snapshot[name] = stableCatalogRows((await client.query(sql)).rows)
  snapshot.counts = Object.fromEntries(Object.entries(snapshot).map(([name, rows]) => [name, rows.length]))
  snapshot.sha256 = sha256(JSON.stringify(snapshot))
  return snapshot
}

function catalogQueries() {
  return {
    schemas: `SELECT nspname schema_name,pg_get_userbyid(nspowner) owner FROM pg_namespace WHERE nspname IN ('public','private','storage') ORDER BY 1`,
    relations: `SELECT n.nspname schema_name,c.relname relation_name,c.relkind,c.relrowsecurity rls_enabled,c.relforcerowsecurity rls_forced,pg_get_userbyid(c.relowner) owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','storage') AND c.relkind IN ('r','p','v','m') ORDER BY 1,2`,
    columns: `SELECT n.nspname schema_name,c.relname table_name,a.attname column_name,pg_catalog.format_type(a.atttypid,a.atttypmod) formatted_type,a.attnotnull not_null,pg_get_expr(ad.adbin,ad.adrelid) default_expression,a.attidentity identity_kind,a.attgenerated generated_kind FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum WHERE n.nspname IN ('public','private','storage') AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,a.attnum`,
    enums: `SELECT n.nspname schema_name,t.typname type_name,array_agg(e.enumlabel ORDER BY e.enumsortorder) labels FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname IN ('public','private','storage') GROUP BY 1,2 ORDER BY 1,2`,
    constraints: `SELECT n.nspname schema_name,c.relname table_name,con.conname constraint_name,con.contype,pg_get_constraintdef(con.oid,true) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','storage') ORDER BY 1,2,3`,
    indexes: `SELECT ns.nspname schema_name,idx.relname index_name,tbl.relname table_name,i.indisunique is_unique,i.indisvalid is_valid,pg_get_indexdef(i.indexrelid) definition FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_class tbl ON tbl.oid=i.indrelid JOIN pg_namespace ns ON ns.oid=tbl.relnamespace WHERE ns.nspname IN ('public','private','storage') ORDER BY 1,2`,
    routines: `SELECT n.nspname schema_name,p.proname routine_name,pg_get_function_identity_arguments(p.oid) identity_arguments,pg_get_function_result(p.oid) result_type,l.lanname language,p.provolatile volatility,p.prosecdef security_definer,p.proconfig config,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN ('public','private','storage') ORDER BY 1,2,3`,
    triggers: `SELECT n.nspname schema_name,c.relname table_name,t.tgname trigger_name,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','storage') AND NOT t.tgisinternal ORDER BY 1,2,3`,
    policies: `SELECT schemaname schema_name,tablename table_name,policyname policy_name,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname IN ('public','private','storage') ORDER BY 1,2,3`,
    tableGrants: `SELECT table_schema schema_name,table_name,grantee,privilege_type,is_grantable FROM information_schema.role_table_grants WHERE table_schema IN ('public','private','storage') ORDER BY 1,2,3,4`,
    routineGrants: `SELECT n.nspname schema_name,p.proname routine_name,pg_get_function_identity_arguments(p.oid) identity_arguments,pg_get_userbyid(x.grantee) grantee,x.privilege_type,x.is_grantable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) x WHERE n.nspname IN ('public','private','storage') ORDER BY 1,2,3,4,5`,
    schemaGrants: `SELECT n.nspname schema_name,pg_get_userbyid(x.grantee) grantee,x.privilege_type,x.is_grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) x WHERE n.nspname IN ('public','private','storage') ORDER BY 1,2,3`,
    extensions: `SELECT e.extname extension_name,e.extversion version,n.nspname schema_name FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY 1`,
    buckets: `SELECT id,name,public,file_size_limit,allowed_mime_types FROM storage.buckets ORDER BY id`,
  }
}

function extractStorageMigrations(targetDirectory) {
  mkdirSync(targetDirectory, { recursive: true, mode: 0o700 })
  const container = runDocker(['create', STORAGE_IMAGE])
  if (container.exitCode !== 0) throw new Error(`Nao foi possivel preparar migrations da plataforma Storage: ${container.stderr}`)
  const containerId = container.rawStdout.trim()
  try {
    const copied = runDocker(['cp', `${containerId}:/app/migrations/tenant/.`, targetDirectory])
    if (copied.exitCode !== 0) throw new Error(`Nao foi possivel extrair migrations da plataforma Storage: ${copied.stderr}`)
  } finally {
    runDocker(['rm', containerId])
  }
}

async function waitForDatabase(hostPort) {
  const deadline = Date.now() + 180_000
  let lastError
  while (Date.now() < deadline) {
    const client = new Client({ connectionString: `postgresql://supabase_admin:postgres@127.0.0.1:${hostPort}/postgres`, application_name: 'bw_antecipa_perf9e_local_clean_room' })
    try {
      await client.connect()
      await client.query('SELECT 1')
      return client
    } catch (error) {
      lastError = error
      await client.end().catch(() => undefined)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500))
    }
  }
  throw new Error(`PostgreSQL descartavel nao ficou pronto: ${lastError?.message ?? 'timeout'}`)
}

function assertDockerAvailable() {
  const result = runDocker(['version', '--format', '{{.Server.Version}}'])
  if (result.exitCode !== 0) throw new Error('Docker local nao esta disponivel.')
}

function assertImageAvailable(image) {
  const result = runDocker(['image', 'inspect', image])
  if (result.exitCode !== 0) throw new Error(`Imagem local obrigatoria ausente: ${image}. O script nao faz pull implicito.`)
}

function removeContainerIfPresent(name) {
  const inspected = runDocker(['container', 'inspect', name])
  if (inspected.exitCode === 0) runDocker(['rm', '-f', name])
}

function runDocker(dockerArgs, options = {}) {
  const startedAt = Date.now()
  const command = process.platform === 'win32' ? 'docker.exe' : 'docker'
  const result = spawnSync(command, dockerArgs, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 600_000,
    windowsHide: true,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  })
  return {
    executable: basename(command),
    args: dockerArgs.map((argument) => argument === 'POSTGRES_PASSWORD=postgres' ? 'POSTGRES_PASSWORD=[LOCAL_ONLY]' : argument),
    exitCode: result.status ?? (result.error ? 1 : 0),
    durationMs: Date.now() - startedAt,
    stdout: redactCommandOutput(result.stdout ?? ''),
    stderr: redactCommandOutput(result.stderr ?? result.error?.message ?? ''),
    rawStdout: result.stdout ?? '',
  }
}

function fail(result, stage, migration, message) {
  result.failure = { stage, migration, sqlstate: null, message: redactCommandOutput(message) }
  result.finishedAt = new Date().toISOString()
  return result
}

function normalizeDump(value) {
  return value
    .replace(/^-- Dumped (?:from|by).*$/gm, '')
    .replace(/^\\restrict .*$/gm, '\\restrict [NORMALIZED]')
    .replace(/^\\unrestrict .*$/gm, '\\unrestrict [NORMALIZED]')
    .replace(/\r\n/g, '\n')
    .trim()
}

function migrationNumber(filename) {
  return Number(filename.match(/^\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER)
}

function compareMigrationNames(left, right) {
  return migrationNumber(left) - migrationNumber(right) || left.localeCompare(right)
}

function writeEvidence(root, evidence) {
  const path = join(root, 'database-clean-room-evidence.json')
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(path, 0o600) } catch { /* Windows nao aplica modo POSIX. */ }
  return path
}
