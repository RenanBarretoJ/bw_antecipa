#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { buildMigrationInventory, sanitizeError } from './lib.mjs'
import { captureSchemaSnapshot, closeDatabase, compareSchemaSnapshots, openDatabase } from './schema-snapshot.mjs'

const HOMOLOG_REF = 'fhgkmggthxikfpogrvaa'
const LOCAL_PROJECT_ID = 'bw-antecipa-p265-clean-room'
const CLI_PATH = resolve('node_modules/supabase/dist/supabase.js')
const BOOTSTRAP_CANDIDATE = resolve('scripts/perf9e/bootstrap/schema-base-candidate.sql')
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const cleanRoot = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'p2-6-5', runId)
const bootstrapPath = resolve('docs/financeiro/bootstrap-e2e-p2-6-5.json')
const goldenPath = resolve('docs/financeiro/golden-clean-room-p2-6-5.json')
const mainPath = resolve('docs/financeiro/clean-room-e2e-p2-6-5.json')
const result = {
  schema: 'bw-antecipa-p2-6-5-clean-room-e2e-v1', status: 'RUNNING',
  started_at: new Date().toISOString(), node: process.version, project_id: LOCAL_PROJECT_ID,
  migration_history: null, schema_parity: null, bootstrap: null, golden: null,
  runtime: null,
  api_auth_matrix: 'PENDING', cross_fund: 'PENDING', storage_api: 'PENDING',
  application: 'PENDING', repository_checks: 'PENDING', deployment_dry_run: 'PENDING',
  production_mutated: false, homolog_mutated: false, failure: null,
}

let stackStarted = false
try {
  await main()
  result.status = 'PASS'
} catch (error) {
  result.status = 'FAIL'
  result.failure = sanitizeError(error)
  console.error(`P2.6.5 falhou: ${result.failure}`)
  process.exitCode = 1
} finally {
  result.cleanup = stopLocalStack()
  result.finished_at = new Date().toISOString()
  writeJson(mainPath, result)
}

async function main() {
  assertRuntime()
  result.runtime = captureRuntime()
  const inventory = validateInventory()
  prepareIsolatedProject()

  const start = runCli(['start', '--workdir', cleanRoot, '--exclude', 'studio,edge-runtime,logflare,vector,imgproxy,realtime', '--yes'], true)
  if (start.status !== 0) throw new Error(`Supabase start: ${sanitizeOutput(start.combined)}`)
  stackStarted = true
  const reset = runCli(['db', 'reset', '--local', '--no-seed', '--workdir', cleanRoot], true)
  if (reset.status !== 0) throw new Error(`Migration clean-room: ${sanitizeOutput(reset.combined)}`)

  const localDbUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  const localDb = await openDatabase(localDbUrl, 'bw_antecipa_p265_clean_room')
  try {
    const history = await localDb.query('select version::text,name::text from supabase_migrations.schema_migrations order by version')
    const active = new Set(inventory.migrations.map((item) => item.timestamp))
    const applied = history.rows.filter((item) => active.has(item.version)).length
    const bootstrapApplied = history.rows.some((item) => item.version === '001')
    result.migration_history = {
      expected: inventory.total, applied, bootstrap_applied: bootstrapApplied,
      total_history_rows: history.rowCount, first: inventory.first, last: inventory.last,
      manifest_sha256: inventory.manifest_sha256,
      status: applied === inventory.total && bootstrapApplied ? 'PASS' : 'FAIL',
    }
    if (result.migration_history.status !== 'PASS') throw new Error(`Historico clean-room ${applied}/${inventory.total}; bootstrap=${bootstrapApplied}.`)

    const localSnapshot = await captureSchemaSnapshot(localDb, 'clean-room-p2-6-5')
    const remoteDb = await openDatabase(loadHomologDbUrl(), 'bw_antecipa_p265_homolog_snapshot', true)
    try {
      const remoteHistory = await remoteDb.query('select version::text from supabase_migrations.schema_migrations order by version')
      const remoteApplied = remoteHistory.rows.filter((item) => active.has(item.version)).length
      result.migration_history.remote_applied = remoteApplied
      result.migration_history.remote_total_history_rows = remoteHistory.rowCount
      result.migration_history.remote_status = remoteApplied === inventory.total ? 'PASS' : 'FAIL'
      if (result.migration_history.remote_status !== 'PASS') {
        throw new Error(`Historico remoto de homologacao ${remoteApplied}/${inventory.total}.`)
      }
      const remoteSnapshot = await captureSchemaSnapshot(remoteDb, 'homolog-p2-6-5')
      const parity = compareSchemaSnapshots(remoteSnapshot, localSnapshot)
      result.schema_parity = {
        status: parity.status, material_differences: parity.material_differences.length,
        allowed_differences: parity.allowed_differences.length,
        allowed_details: parity.allowed_differences,
      }
      if (parity.status !== 'PASS') throw new Error(`Schema parity possui ${parity.material_differences.length} diferencas materiais.`)
    } finally {
      await closeDatabase(remoteDb, true)
    }
  } finally {
    await closeDatabase(localDb)
  }

  const dryRun = runCli(['db', 'push', '--dry-run', '--local', '--workdir', cleanRoot], true)
  const dryRunPass = dryRun.status === 0 && /up to date|no migrations to push/i.test(dryRun.combined)
  result.deployment_dry_run = dryRunPass ? 'PASS' : 'FAIL'
  if (!dryRunPass) throw new Error(`db push --dry-run local: ${sanitizeOutput(dryRun.combined)}`)

  const local = readLocalEnvironment()
  const childEnv = buildCleanRoomEnv(local)
  result.bootstrap = {
    status: 'PASS', source: 'schema-base-candidate.sql + migrations canonicas',
    auth_api: await health(`${local.apiUrl}/auth/v1/health`, local.anonKey),
    rest_api: await health(`${local.apiUrl}/rest/v1/`, local.anonKey),
    storage_api: await health(`${local.apiUrl}/storage/v1/bucket`, local.serviceRoleKey),
  }
  writeJson(bootstrapPath, { schema: 'bw-antecipa-p2-6-5-bootstrap-v1', ...result.bootstrap, migration_history: result.migration_history, schema_parity: result.schema_parity })
  if (Object.values(result.bootstrap).some((value) => value === 'FAIL')) throw new Error('Health do Supabase local falhou.')

  const golden = { schema: 'bw-antecipa-p2-6-5-golden-v1', v1: {}, v2: {}, p24: {}, p25: {}, p26: {}, status: 'RUNNING' }
  writeJson(goldenPath, golden)
  const v1Confirmation = `SEED_RLX_GOLDEN_HOMOLOG_${LOCAL_PROJECT_ID}`
  golden.v1.fixtures = runNode(['scripts/homologacao/rlx-golden/generate-fixtures.mjs', '--check'], childEnv)
  golden.v1.seed = runNode(['scripts/homologacao/rlx-golden/seed.mjs', '--execute', '--expected-project-ref', LOCAL_PROJECT_ID, '--confirm', v1Confirmation], childEnv)
  golden.v1.verify = runNode(['scripts/homologacao/rlx-golden/verify.mjs', '--expected-project-ref', LOCAL_PROJECT_ID], childEnv)
  if (Object.values(golden.v1).some((item) => item.status !== 'PASS')) {
    golden.status = 'FAIL'; writeJson(goldenPath, golden); throw new Error('Golden V1 clean-room falhou.')
  }

  const v2Confirmation = `E2E_V2_RLX_GOLDEN_HOMOLOG_${LOCAL_PROJECT_ID}`
  golden.v2.e2e = runNode(['scripts/homologacao/rlx-golden-v2/e2e.mjs', '--execute', '--expected-project-ref', LOCAL_PROJECT_ID, '--confirm', v2Confirmation], childEnv)
  if (golden.v2.e2e.status !== 'PASS') {
    golden.status = 'FAIL'; writeJson(goldenPath, golden); throw new Error('Golden V2 clean-room falhou.')
  }

  golden.p24.run = runMutation('scripts/homologacao/financeiro/logistica/run.mjs', 'RUN_P24_V2', childEnv)
  golden.security_actors = runNode(['scripts/homologacao/financeiro/readiness/p2-6-5-api-worker.mjs', '--bootstrap-only'], childEnv)
  if (golden.security_actors.status !== 'PASS') {
    golden.status = 'FAIL'; writeJson(goldenPath, golden); throw new Error('Bootstrap dos atores de seguranca falhou.')
  }
  golden.p24.verify = runVerification('scripts/homologacao/financeiro/logistica/verify.mjs', childEnv)
  golden.p24.security = runVerification('scripts/homologacao/financeiro/logistica/verify-security.mjs', childEnv)
  assertGoldenStage('P2.4', golden.p24, golden)

  golden.p25.configure = runMutation('scripts/homologacao/financeiro/exposicao/configure-golden.mjs', 'CONFIGURE_P25_GOLDEN', childEnv)
  golden.p25.run = runMutation('scripts/homologacao/financeiro/exposicao/run.mjs', 'RUN_P25', childEnv)
  golden.p25.verify = runVerification('scripts/homologacao/financeiro/exposicao/verify.mjs', childEnv)
  golden.p25.security = runVerification('scripts/homologacao/financeiro/exposicao/verify-security.mjs', childEnv)
  assertGoldenStage('P2.5', golden.p25, golden)

  golden.p26.configure = runMutation('scripts/homologacao/financeiro/risco/configure-golden.mjs', 'CONFIGURE_P26_GOLDEN', childEnv)
  golden.p26.run = runMutation('scripts/homologacao/financeiro/risco/run.mjs', 'RUN_P26', childEnv)
  golden.p26.verify = runVerification('scripts/homologacao/financeiro/risco/verify.mjs', childEnv)
  golden.p26.security = runVerification('scripts/homologacao/financeiro/risco/verify-security.mjs', childEnv)
  assertGoldenStage('P2.6', golden.p26, golden)
  golden.status = 'PASS'
  golden.completed_at = new Date().toISOString()
  writeJson(goldenPath, golden)
  result.golden = 'PASS'

  const api = runNode(['scripts/homologacao/financeiro/readiness/p2-6-5-api-worker.mjs'], childEnv)
  if (api.status !== 'PASS') throw new Error(`Matriz API/RLS/Storage falhou: ${api.detail}`)
  result.api_auth_matrix = 'PASS'
  result.cross_fund = 'PASS'
  result.storage_api = 'PASS'

  result.repository_checks = validateRepository(childEnv)
  if (Object.values(result.repository_checks).some((item) => item.status !== 'PASS')) {
    throw new Error('Uma ou mais validacoes obrigatorias do repositorio falharam.')
  }

  result.application = await validateApplication(childEnv)
  if (result.application.status !== 'PASS') throw new Error(`Aplicacao local falhou: ${result.application.detail || 'health/cron invalido'}`)
}

function assertRuntime() {
  if (!process.version.startsWith('v22.')) throw new Error(`Node 22 obrigatorio; recebido ${process.version}.`)
  if (run('git', ['branch', '--show-current']).stdout.trim() !== 'homolog') throw new Error('Branch homolog obrigatoria.')
  if (!existsSync(CLI_PATH) || !existsSync(BOOTSTRAP_CANDIDATE)) throw new Error('Dependencia do clean-room ausente.')
}

function captureRuntime() {
  const engine = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).engines?.node || null
  const context = run('docker', ['context', 'show']).stdout.trim()
  const osType = run('docker', ['info', '--format', '{{.OSType}}']).stdout.trim()
  const version = run('docker', ['version', '--format', '{{.Server.Version}}']).stdout.trim()
  if (osType.toLowerCase() !== 'linux') throw new Error(`Docker Linux obrigatorio; recebido ${osType || 'desconhecido'}.`)
  return { node: process.version, package_engine: engine, docker_context: context, docker_os: osType, docker_server_version: version }
}

function validateInventory() {
  const inventory = buildMigrationInventory()
  const seen = new Set()
  for (const migration of inventory.migrations) {
    if (!migration.bytes) throw new Error(`Migration vazia: ${migration.filename}.`)
    if (seen.has(migration.timestamp)) throw new Error(`Timestamp duplicado: ${migration.timestamp}.`)
    seen.add(migration.timestamp)
  }
  return inventory
}

function prepareIsolatedProject() {
  mkdirSync(cleanRoot, { recursive: true })
  cpSync(resolve('supabase'), resolve(cleanRoot, 'supabase'), { recursive: true })
  const configPath = resolve(cleanRoot, 'supabase/config.toml')
  let config = readFileSync(configPath, 'utf8').replace(/^project_id\s*=.*$/m, `project_id = "${LOCAL_PROJECT_ID}"`)
  config = config.replace(/^site_url\s*=.*$/m, 'site_url = "http://127.0.0.1:3011"')
  writeFileSync(configPath, config, 'utf8')
  cpSync(BOOTSTRAP_CANDIDATE, resolve(cleanRoot, 'supabase/migrations/001_schema_base_candidate.sql'))
}

function readLocalEnvironment() {
  const status = runCli(['status', '--workdir', cleanRoot, '-o', 'env'], false)
  const values = new Map()
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(?:"([^"]*)"|(.*))$/)
    if (match) values.set(match[1], match[2] ?? match[3] ?? '')
  }
  const apiUrl = values.get('API_URL') || values.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
  const anonKey = values.get('ANON_KEY') || values.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY') || values.get('SUPABASE_SERVICE_ROLE_KEY')
  const dbUrl = values.get('DB_URL') || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  for (const [label, value] of [['apiUrl', apiUrl], ['dbUrl', dbUrl]]) assertLocalUrl(value, label)
  if (!anonKey || !serviceRoleKey) throw new Error('Supabase local nao informou anon/service role key.')
  return { apiUrl, anonKey, serviceRoleKey, dbUrl }
}

function buildCleanRoomEnv(local) {
  const env = { ...process.env,
    BW_CLEAN_ROOM_E2E: '1', NEXT_PUBLIC_APP_ENV: 'homolog', APP_ENV: 'homolog',
    NEXT_PUBLIC_SUPABASE_URL: local.apiUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: local.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: local.serviceRoleKey, SUPABASE_DB_URL: local.dbUrl,
    DATABASE_URL: local.dbUrl, RLX_GOLDEN_HOMOLOG_PROJECT_REF: LOCAL_PROJECT_ID,
    NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3011', CRON_SECRET: 'p265-local-only-secret',
    BW_P265_ACTOR_SEED: randomBytes(32).toString('base64url'),
    NO_COLOR: '1', FORCE_COLOR: '0',
  }
  delete env.SUPABASE_ACCESS_TOKEN
  return env
}

async function health(url, key) {
  try {
    const response = await fetch(url, { headers: { apikey: key, authorization: `Bearer ${key}` } })
    return response.status < 500 ? 'PASS' : 'FAIL'
  } catch { return 'FAIL' }
}

function runNode(args, env) {
  const child = run(process.execPath, args, true, env, 1_800_000)
  return { status: child.status === 0 ? 'PASS' : 'FAIL', detail: sanitizeOutput(child.combined).slice(-4000) }
}

function runMutation(script, action, env) {
  return runNode([script, '--execute', '--expected-project-ref', LOCAL_PROJECT_ID, '--confirm', `${action}_RLX_GOLDEN_HOMOLOG_${LOCAL_PROJECT_ID}`], env)
}

function runVerification(script, env) {
  return runNode([script, '--expected-project-ref', LOCAL_PROJECT_ID], env)
}

function validateRepository(env) {
  const checks = {
    typescript: runNode(['node_modules/typescript/bin/tsc', '--noEmit'], env),
    tests: runNode(['node_modules/vitest/vitest.mjs', '--run'], env),
    lint: runNode(['node_modules/eslint/bin/eslint.js', '.'], env),
    diff_check: commandCheck('git', ['diff', '--check'], env),
    build: runNode(['node_modules/next/dist/bin/next', 'build', '--webpack'], env),
  }
  return checks
}

function commandCheck(command, args, env) {
  const child = run(command, args, true, env, 1_800_000)
  return { status: child.status === 0 ? 'PASS' : 'FAIL', detail: sanitizeOutput(child.combined).slice(-4000) }
}

async function validateApplication(env) {
  const logs = []
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3011'], {
    cwd: process.cwd(), env, shell: false, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const collect = (chunk) => {
    logs.push(String(chunk))
    if (logs.length > 80) logs.shift()
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  try {
    const app = await pollHttp('http://127.0.0.1:3011/login', {}, 60_000)
    const unauthorized = await fetch('http://127.0.0.1:3011/api/cron/financeiro')
    const cron = await fetch('http://127.0.0.1:3011/api/cron/financeiro', {
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    })
    const alias = await fetch('http://127.0.0.1:3011/api/cron/rlx-financeiro', {
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    })
    const checks = [
      { surface: 'NEXT_LOGIN', expected: 200, actual: app.status, status: app.status === 200 ? 'PASS' : 'FAIL' },
      { surface: 'CRON_UNAUTHORIZED', expected: 401, actual: unauthorized.status, status: unauthorized.status === 401 ? 'PASS' : 'FAIL' },
      { surface: 'CRON_FINANCEIRO', expected: 200, actual: cron.status, status: cron.status === 200 ? 'PASS' : 'FAIL' },
      { surface: 'CRON_RLX_ALIAS', expected: 200, actual: alias.status, status: alias.status === 200 ? 'PASS' : 'FAIL' },
    ]
    return {
      status: checks.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL',
      checks,
      external_providers_called: false,
      detail: checks.every((item) => item.status === 'PASS') ? 'Next e crons locais responderam sem 500.' : 'Uma superficie HTTP local divergiu do esperado.',
    }
  } catch (error) {
    return { status: 'FAIL', detail: sanitizeError(error), log_tail: sanitizeOutput(logs.join('')).slice(-2000) }
  } finally {
    child.kill('SIGTERM')
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5000)),
    ])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

async function pollHttp(url, headers, timeoutMs) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { headers, redirect: 'manual' })
      if (response.status < 500) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) { lastError = error }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw lastError || new Error(`Timeout ao aguardar ${url}`)
}

function assertGoldenStage(label, stage, golden) {
  if (Object.values(stage).every((item) => item.status === 'PASS')) return
  golden.status = 'FAIL'
  writeJson(goldenPath, golden)
  throw new Error(`${label} clean-room falhou.`)
}

function loadHomologDbUrl() {
  const entries = new Map()
  for (const line of readFileSync(resolve('.env.homolog'), 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (match) entries.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ''))
  }
  const value = entries.get('SUPABASE_DB_URL') || entries.get('DATABASE_URL')
  if (!value) throw new Error('URL read-only de homologacao ausente.')
  const url = new URL(value)
  const ref = decodeURIComponent(url.username).match(/^postgres[.]([a-z0-9]+)$/i)?.[1]
    || url.hostname.match(/^db[.]([a-z0-9]+)[.]supabase[.]co$/i)?.[1]
  if (ref !== HOMOLOG_REF) throw new Error('URL remota nao aponta para homologacao autorizada.')
  return value
}

function stopLocalStack() {
  if (!existsSync(resolve(cleanRoot, 'supabase/config.toml'))) return { status: 'NOT_STARTED' }
  const stopped = runCli(['stop', '--workdir', cleanRoot, '--no-backup'], true)
  const allowedRoot = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'p2-6-5')
  if (stopped.status === 0 && cleanRoot.startsWith(`${allowedRoot}\\`)) {
    rmSync(cleanRoot, { recursive: true, force: true })
    return { status: 'PASS', stack_stopped: stackStarted, workspace_removed: true }
  }
  return { status: 'FAIL', detail: sanitizeOutput(stopped.combined) }
}

function runCli(args, allowFailure = false) {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  delete env.DATABASE_URL; delete env.SUPABASE_DB_URL; delete env.SUPABASE_ACCESS_TOKEN
  return run(process.execPath, [CLI_PATH, ...args], allowFailure, env, 900_000)
}

function run(command, args, allowFailure = false, env = process.env, timeout = 900_000) {
  const child = spawnSync(command, args, { cwd: process.cwd(), env, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024, timeout })
  if (child.error) throw child.error
  const combined = [child.stdout, child.stderr].filter(Boolean).join('\n').trim()
  const status = child.status ?? 1
  if (status !== 0 && !allowFailure) throw new Error(`${command} falhou: ${sanitizeOutput(combined)}`)
  return { status, stdout: child.stdout || '', stderr: child.stderr || '', combined }
}

function assertLocalUrl(value, label) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(value).hostname)) throw new Error(`${label} remoto bloqueado.`)
}

function sanitizeOutput(value) {
  return sanitizeError(value).replace(/(password|service_role|access_token|apikey|authorization)\s*[=:]\s*\S+/gi, '$1=[REDACTED]').replace(/eyJ[A-Za-z0-9._-]+/g, '[JWT_REDACTED]').replace(/\u001b\[[0-9;]*m/g, '')
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
