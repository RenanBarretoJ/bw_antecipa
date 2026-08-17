#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { buildMigrationInventory, sanitizeError } from './lib.mjs'
import { captureSchemaSnapshot, closeDatabase, compareSchemaSnapshots, openDatabase } from './schema-snapshot.mjs'

const LOCAL_PROJECT_ID = 'bw-antecipa-p263-clean-room'
const HOMOLOG_REF = 'fhgkmggthxikfpogrvaa'
const SOURCE_INVENTORY = resolve('docs/financeiro/migration-inventory-p2-6-1.json')
const CLEAN_ROOM_RESULT = resolve('docs/financeiro/clean-room-p2-6-3.json')
const PARITY_RESULT = resolve('docs/financeiro/schema-parity-p2-6-3.json')
const BOOTSTRAP_RESULT = resolve('docs/financeiro/bootstrap-p2-6-3.json')
const DEPLOYMENT_RESULT = resolve('docs/financeiro/deployment-dry-run-p2-6-3.json')
const CLI_PATH = resolve('node_modules/supabase/dist/supabase.js')
const BOOTSTRAP_CANDIDATE = resolve('scripts/perf9e/bootstrap/schema-base-candidate.sql')
const BOOTSTRAP_FILENAME = '001_schema_base_candidate.sql'

const startedAt = new Date()
const runId = startedAt.toISOString().replace(/[:.]/g, '-')
const cleanRoot = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'p2-6-3', runId)
const result = {
  schema: 'bw-antecipa-p2-6-3-clean-room-v1',
  status: 'RUNNING',
  started_at: startedAt.toISOString(),
  node: { version: process.version, expected: '22.x', executable: process.execPath },
  docker: null,
  wsl: null,
  supabase_cli: null,
  migration_count: 0,
  migration_first: null,
  migration_last: null,
  migration_result: { status: 'PENDING', applied: 0, failed_at: null, retry_count: 0 },
  bootstrap: { status: 'PENDING' }, golden: { status: 'PENDING' }, rls: { status: 'PENDING' },
  storage: { status: 'PENDING' }, build: { status: 'PENDING' }, cleanup: { status: 'PENDING' },
  production_mutated: false, homolog_mutated: false, clean_room_root: cleanRoot,
  failure: null,
}

try {
  await main()
} catch (error) {
  result.status = 'FAIL'
  result.failure = classifyFailure(error)
  if (result.failure.classification === 'SCHEMA PARITY') {
    result.bootstrap = { ...result.bootstrap, status: 'BLOCKED_BY_SCHEMA_PARITY' }
    writeJson(BOOTSTRAP_RESULT, {
      schema: 'bw-antecipa-p2-6-3-bootstrap-v1', status: 'BLOCKED_BY_SCHEMA_PARITY',
      migrations: result.migration_result, manual_sql: false,
      schema_base: { status: 'PASS', source: 'scripts/perf9e/bootstrap/schema-base-candidate.sql', migration_history_version: '001' },
      application_bootstrap: 'NOT_EXECUTED', golden_v1: 'NOT_EXECUTED', golden_v2: 'NOT_EXECUTED', security: 'NOT_EXECUTED',
    })
    markDeploymentBlocked()
  }
  writeJson(CLEAN_ROOM_RESULT, result)
  console.error(`P2.6.3 falhou: ${result.failure.message}`)
  process.exitCode = 1
} finally {
  const cleanup = stopLocalStack()
  result.cleanup = cleanup
  result.finished_at = new Date().toISOString()
  writeJson(CLEAN_ROOM_RESULT, result)
}

async function main() {
  assertRuntime()
  const inventory = validateInventory()
  Object.assign(result, {
    migration_count: inventory.total,
    migration_first: inventory.first,
    migration_last: inventory.last,
  })
  result.docker = dockerEvidence()
  result.wsl = wslEvidence()
  result.supabase_cli = runCli(['--version']).stdout.trim()
  if (!existsSync(BOOTSTRAP_CANDIDATE)) throw new Error('DEPENDENCIA HISTORICA AUSENTE: bootstrap oficial do Escopo 9E nao encontrado.')

  prepareIsolatedProject()
  assertCleanRoomLocal()

  const start = runCli(['start', '--workdir', cleanRoot, '--exclude', 'studio,edge-runtime,logflare,vector,imgproxy,realtime', '--yes'], { allowFailure: true })
  if (start.status !== 0) throw migrationFailure('supabase start', start.combined)

  const reset = runCli(['db', 'reset', '--local', '--no-seed', '--workdir', cleanRoot], { allowFailure: true })
  if (reset.status !== 0) throw migrationFailure('supabase db reset', reset.combined)

  const localDbUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  assertLocalUrl(localDbUrl, 'localDbUrl')
  const localDb = await openDatabase(localDbUrl, 'bw_antecipa_p263_clean_room')
  const history = await localDb.query('select version::text,name::text from supabase_migrations.schema_migrations order by version')
  const activeVersions = new Set(inventory.migrations.map((item) => item.timestamp))
  const appliedActive = history.rows.filter((item) => activeVersions.has(item.version)).length
  const bootstrapApplied = history.rows.some((item) => item.version === '001')
  result.migration_result = {
    status: appliedActive === inventory.total && bootstrapApplied ? 'PASS' : 'FAIL', applied: appliedActive,
    bootstrap_applied: bootstrapApplied, total_history_rows: history.rowCount,
    failed_at: null, retry_count: 0,
  }
  if (appliedActive !== inventory.total || !bootstrapApplied) {
    throw new Error(`Historico local possui ${appliedActive}/${inventory.total} migrations ativas; bootstrap=${bootstrapApplied}.`)
  }
  const localSnapshot = await captureSchemaSnapshot(localDb, 'clean-room')
  await closeDatabase(localDb)

  result.bootstrap = { status: 'SCHEMA_READY', source: 'bootstrap_9e_versionado_mais_migrations', manual_sql: false }
  writeJson(BOOTSTRAP_RESULT, {
    schema: 'bw-antecipa-p2-6-3-bootstrap-v1', status: 'SCHEMA_READY',
    migrations: result.migration_result, manual_sql: false,
    schema_base: { status: 'PASS', source: 'scripts/perf9e/bootstrap/schema-base-candidate.sql', migration_history_version: '001' },
    application_bootstrap: 'PENDING', golden_v1: 'PENDING', golden_v2: 'PENDING', security: 'PENDING',
  })

  const dryRun = runCli(['db', 'push', '--dry-run', '--local', '--workdir', cleanRoot], { allowFailure: true })
  const dryRunOk = dryRun.status === 0 && /up to date|no migrations to push/i.test(dryRun.combined)
  writeJson(DEPLOYMENT_RESULT, {
    schema: 'bw-antecipa-p2-6-3-deployment-dry-run-v1', status: dryRunOk ? 'SCHEMA_ONLY_PASS' : 'FAIL',
    node: process.version, npm_ci: 'NOT_EXECUTED_IN_EXISTING_WORKTREE', supabase_start: 'PASS',
    migrations: result.migration_result, db_push_dry_run: sanitizeOutput(dryRun.combined), build: 'PENDING',
  })
  if (!dryRunOk) throw new Error(`db push --dry-run local nao comprovou paridade: ${sanitizeOutput(dryRun.combined)}`)

  const remoteDbUrl = loadHomologDbUrl()
  const remoteDb = await openDatabase(remoteDbUrl, 'bw_antecipa_p263_homolog_snapshot', true)
  const remoteSnapshot = await captureSchemaSnapshot(remoteDb, 'homolog')
  await closeDatabase(remoteDb, true)
  const parity = compareSchemaSnapshots(remoteSnapshot, localSnapshot)
  parity.schema = 'bw-antecipa-p2-6-3-schema-parity-v1'
  parity.captured_at = new Date().toISOString()
  parity.homolog.project_ref = HOMOLOG_REF
  parity.clean_room.project_id = LOCAL_PROJECT_ID
  writeJson(PARITY_RESULT, parity)
  if (parity.status !== 'PASS') throw new Error(`Schema parity encontrou ${parity.material_differences.length} diferencas materiais.`)

  result.status = 'SCHEMA_PARITY_PASS'
}

function assertRuntime() {
  if (!process.version.startsWith('v22.')) throw new Error(`RUNNER: Node 22 obrigatorio; recebido ${process.version}.`)
  if (!existsSync(CLI_PATH)) throw new Error('RUNNER: Supabase CLI local nao encontrado.')
  const branch = run('git', ['branch', '--show-current']).stdout.trim()
  if (branch !== 'homolog') throw new Error(`RUNNER: branch homolog obrigatoria; recebido ${branch || 'ausente'}.`)
  for (const key of ['DATABASE_URL', 'SUPABASE_DB_URL']) {
    const value = process.env[key]
    if (value) assertLocalUrl(value, key)
  }
}

function validateInventory() {
  const inventory = buildMigrationInventory()
  const versions = new Set()
  for (const migration of inventory.migrations) {
    if (!migration.bytes) throw new Error(`MIGRATION NAO REPRODUTIVEL: arquivo vazio ${migration.filename}.`)
    if (versions.has(migration.timestamp)) throw new Error(`ORDEM INCORRETA: versao duplicada ${migration.timestamp}.`)
    versions.add(migration.timestamp)
  }
  if (existsSync(SOURCE_INVENTORY)) {
    const baseline = JSON.parse(readFileSync(SOURCE_INVENTORY, 'utf8'))
    const baselineByName = new Map(baseline.migrations.map((item) => [item.filename, item.sha256]))
    const changed = inventory.migrations.filter((item) => baselineByName.has(item.filename) && baselineByName.get(item.filename) !== item.sha256)
    if (changed.length) throw new Error(`MIGRATION NAO REPRODUTIVEL: checksums historicos alterados: ${changed.map((item) => item.filename).join(', ')}.`)
  }
  return inventory
}

function prepareIsolatedProject() {
  mkdirSync(cleanRoot, { recursive: true })
  cpSync(resolve('supabase'), resolve(cleanRoot, 'supabase'), { recursive: true })
  const configPath = resolve(cleanRoot, 'supabase/config.toml')
  let config = readFileSync(configPath, 'utf8')
  config = config.replace(/^project_id\s*=.*$/m, `project_id = "${LOCAL_PROJECT_ID}"`)
  writeFileSync(configPath, config, 'utf8')
  cpSync(BOOTSTRAP_CANDIDATE, resolve(cleanRoot, 'supabase/migrations', BOOTSTRAP_FILENAME))
}

function assertCleanRoomLocal() {
  const config = readFileSync(resolve(cleanRoot, 'supabase/config.toml'), 'utf8')
  const projectId = config.match(/^project_id\s*=\s*["']([^"']+)/m)?.[1]
  if (projectId !== LOCAL_PROJECT_ID) throw new Error('RUNNER: project_id clean-room invalido.')
  if (config.includes(HOMOLOG_REF)) throw new Error('RUNNER: referencia de homologacao detectada no projeto mutavel.')
  const productionRef = String(process.env.SUPABASE_PRODUCTION_PROJECT_REF || '').trim()
  if (productionRef && config.includes(productionRef)) throw new Error('RUNNER: referencia de producao detectada no projeto mutavel.')
}

function dockerEvidence() {
  const version = run('docker', ['version', '--format', '{{json .}}'])
  const info = JSON.parse(run('docker', ['info', '--format', '{{json .}}']).stdout)
  const context = run('docker', ['context', 'show']).stdout.trim()
  if (info.OSType !== 'linux') throw new Error(`INFRAESTRUTURA: Docker OSType ${info.OSType}; linux obrigatorio.`)
  return { client_server: JSON.parse(version.stdout), server_version: info.ServerVersion, os_type: info.OSType, context }
}

function wslEvidence() {
  const output = run('wsl', ['--list', '--verbose']).stdout.replaceAll('\u0000', '')
  if (!/\s2\s*$/m.test(output)) throw new Error('INFRAESTRUTURA: WSL2 nao comprovado.')
  return { version_2_present: true, distributions: output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }
}

function loadHomologDbUrl() {
  const envPath = resolve('.env.homolog')
  const entries = new Map()
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    entries.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ''))
  }
  const value = entries.get('SUPABASE_DB_URL') || entries.get('DATABASE_URL')
  if (!value) throw new Error('RUNNER: URL read-only de homologacao ausente.')
  const url = new URL(value)
  const ref = decodeURIComponent(url.username).match(/^postgres[.]([a-z0-9]+)$/i)?.[1]
    || url.hostname.match(/^db[.]([a-z0-9]+)[.]supabase[.]co$/i)?.[1]
  if (ref !== HOMOLOG_REF) throw new Error('RUNNER: snapshot remoto nao aponta para homologacao autorizada.')
  return value
}

function migrationFailure(stage, output) {
  const clean = sanitizeOutput(output)
  const match = clean.match(/(?:Applying migration|migration)\s+([^\s]+[.]sql)/i)
  const error = new Error(`MIGRATION NAO REPRODUTIVEL: ${stage}: ${clean.split(/\r?\n/).slice(-12).join(' | ')}`)
  error.failedAt = match?.[1] ?? null
  return error
}

function stopLocalStack() {
  if (!existsSync(resolve(cleanRoot, 'supabase/config.toml'))) return { status: 'NOT_STARTED' }
  const stopped = runCli(['stop', '--workdir', cleanRoot, '--no-backup'], { allowFailure: true })
  if (stopped.status === 0) {
    rmSync(cleanRoot, { recursive: true, force: true })
    return { status: 'PASS', stack_stopped: true, workspace_removed: true }
  }
  return { status: 'FAIL', stack_stopped: false, workspace_removed: false, detail: sanitizeOutput(stopped.combined) }
}

function runCli(args, options = {}) {
  return run(process.execPath, [CLI_PATH, ...args], options)
}

function run(command, args, options = {}) {
  const child = spawnSync(command, args, {
    cwd: process.cwd(), env: sanitizedChildEnv(), encoding: 'utf8', shell: false,
    maxBuffer: 64 * 1024 * 1024, timeout: options.timeout ?? 900_000,
  })
  if (child.error && child.error.code !== 'ETIMEDOUT') throw child.error
  const combined = [child.stdout, child.stderr].filter(Boolean).join('\n').trim()
  const status = child.status ?? 1
  if (status !== 0 && options.allowFailure !== true) throw new Error(`RUNNER: ${command} falhou: ${sanitizeOutput(combined)}`)
  return { status, stdout: child.stdout || '', stderr: child.stderr || '', combined }
}

function sanitizedChildEnv() {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  delete env.DATABASE_URL
  delete env.SUPABASE_DB_URL
  delete env.SUPABASE_ACCESS_TOKEN
  return env
}

function assertLocalUrl(value, label) {
  const host = new URL(value).hostname
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`RUNNER: ${label} remoto bloqueado (${host}).`)
}

function classifyFailure(error) {
  const message = sanitizeError(error)
  if (/^Schema parity encontrou \d+ diferencas materiais[.]$/i.test(message)) {
    return { classification: 'SCHEMA PARITY', message, failed_at: null }
  }
  const prefix = message.split(':')[0]
  const allowed = ['DEPENDÊNCIA HISTÓRICA AUSENTE','MIGRATION NÃO REPRODUTÍVEL','ASSUNÇÃO DE ESTADO MANUAL','ORDEM INCORRETA','OBJETO AUSENTE','OBJETO DUPLICADO','RLS/GRANT','STORAGE','EXTENSION','SEED','RUNNER','INFRAESTRUTURA']
  const normalized = prefix.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  const classification = allowed.find((item) => item.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() === normalized) || 'RUNNER'
  return { classification, message, failed_at: error?.failedAt ?? null }
}

function markDeploymentBlocked() {
  if (!existsSync(DEPLOYMENT_RESULT)) return
  const deployment = JSON.parse(readFileSync(DEPLOYMENT_RESULT, 'utf8'))
  deployment.status = 'BLOCKED_BY_SCHEMA_PARITY'
  deployment.build = 'NOT_EXECUTED'
  deployment.reason = 'Schema parity material diverge da homologacao.'
  writeJson(DEPLOYMENT_RESULT, deployment)
}

function sanitizeOutput(value) {
  return sanitizeError(value).replace(/(password|service_role|access_token)\s*[=:]\s*\S+/gi, '$1=[REDACTED]').replace(/\u001b\[[0-9;]*m/g, '')
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
