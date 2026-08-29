#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { buildMigrationInventory, sanitizeError } from './lib.mjs'
import { captureSchemaSnapshot, closeDatabase, compareSchemaSnapshots, openDatabase } from './schema-snapshot.mjs'

const HOMOLOG_REF = 'fhgkmggthxikfpogrvaa'
const LOCAL_PROJECT_ID = 'bw-antecipa-p264-clean-room'
const CLI_PATH = resolve('node_modules/supabase/dist/supabase.js')
const BOOTSTRAP_CANDIDATE = resolve('scripts/perf9e/bootstrap/schema-base-candidate.sql')
const BASELINE_INVENTORY = resolve('docs/financeiro/migration-inventory-p2-6-1.json')
const phase = process.argv.includes('--final') ? 'final' : 'intermediate'
const artifactPath = resolve(`docs/financeiro/clean-room-p2-6-4-${phase}.json`)
const parityPath = resolve('docs/financeiro/schema-parity-p2-6-4.json')
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const cleanRoot = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'p2-6-4', phase, runId)
const result = {
  schema: 'bw-antecipa-p2-6-4-clean-room-v1',
  phase,
  status: 'RUNNING',
  started_at: new Date().toISOString(),
  node: process.version,
  project_id: LOCAL_PROJECT_ID,
  clean_room_root: cleanRoot,
  migrations: null,
  canonical_checks: null,
  parity: phase === 'final' ? { status: 'PENDING' } : { status: 'NOT_REQUESTED' },
  production_mutated: false,
  homolog_mutated: false,
  failure: null,
}

try {
  await main()
  result.status = 'PASS'
} catch (error) {
  result.status = 'FAIL'
  result.failure = sanitizeError(error)
  console.error(`P2.6.4 clean-room ${phase} falhou: ${result.failure}`)
  process.exitCode = 1
} finally {
  result.cleanup = stopLocalStack()
  result.finished_at = new Date().toISOString()
  writeJson(artifactPath, result)
}

async function main() {
  assertRuntime()
  const inventory = validateInventory()
  result.migrations = {
    expected: inventory.total,
    first: inventory.first,
    last: inventory.last,
    manifest_sha256: inventory.manifest_sha256,
    status: 'PENDING',
  }

  prepareIsolatedProject()
  const start = runCli(['start', '--workdir', cleanRoot, '--exclude', 'studio,edge-runtime,logflare,vector,imgproxy,realtime', '--yes'], true)
  if (start.status !== 0) throw new Error(`Supabase start: ${sanitizeOutput(start.combined)}`)
  const reset = runCli(['db', 'reset', '--local', '--no-seed', '--workdir', cleanRoot], true)
  if (reset.status !== 0) throw new Error(`Migration clean-room: ${sanitizeOutput(reset.combined)}`)

  const db = await openDatabase('postgresql://postgres:postgres@127.0.0.1:54322/postgres', 'bw_antecipa_p264_clean_room')
  try {
    const history = await db.query('select version::text,name::text from supabase_migrations.schema_migrations order by version')
    const active = new Set(inventory.migrations.map((item) => item.timestamp))
    const applied = history.rows.filter((item) => active.has(item.version)).length
    const bootstrapApplied = history.rows.some((item) => item.version === '001')
    result.migrations = {
      ...result.migrations,
      applied,
      bootstrap_applied: bootstrapApplied,
      total_history_rows: history.rowCount,
      status: applied === inventory.total && bootstrapApplied ? 'PASS' : 'FAIL',
    }
    if (result.migrations.status !== 'PASS') throw new Error(`Historico clean-room ${applied}/${inventory.total}; bootstrap=${bootstrapApplied}.`)
    result.canonical_checks = await canonicalChecks(db)
    if (Object.values(result.canonical_checks).some((item) => item !== true)) {
      throw new Error(`Estado canonico incompleto: ${JSON.stringify(result.canonical_checks)}`)
    }

    const localSnapshot = await captureSchemaSnapshot(db, 'clean-room-p2-6-4')
    if (phase === 'final') await compareWithHomolog(localSnapshot)
  } finally {
    await closeDatabase(db)
  }

  const dryRun = runCli(['db', 'push', '--dry-run', '--local', '--workdir', cleanRoot], true)
  result.local_db_push_dry_run = {
    status: dryRun.status === 0 && /up to date|no migrations to push/i.test(dryRun.combined) ? 'PASS' : 'FAIL',
    output: sanitizeOutput(dryRun.combined),
  }
  if (result.local_db_push_dry_run.status !== 'PASS') throw new Error('db push --dry-run local nao ficou vazio.')
}

async function canonicalChecks(db) {
  const { rows: [row] } = await db.query(`select
    (select convalidated and pg_get_constraintdef(oid, true) like '%valor_bruto > 0%'
       from pg_constraint where conrelid='public.notas_fiscais'::regclass and conname='notas_fiscais_valor_bruto_check') as nf_valor_positivo,
    to_regclass('public.idx_operacao_calculo_nfs_operacao') is null as indice_redundante_ausente,
    to_regprocedure('public.aprovar_operacao_atomica_financeiro_v1(uuid,numeric)') is not null as motor_financeiro_presente,
    to_regprocedure('public.registrar_cte_documento(uuid[],text,text,text,bigint,text,text,text,text,text,text,date,text,text,text,numeric,text,jsonb)') is not null as registrar_cte_presente,
    exists(select 1 from pg_trigger where tgrelid='public.operacoes'::regclass and tgname='operacoes_bloquear_aprovacao_financeira_direta' and not tgisinternal) as trigger_gate_presente,
    (select relrowsecurity from pg_class where oid='public.devedores_solidarios'::regclass) as devedores_rls,
    exists(select 1 from pg_policies where schemaname='public' and tablename='devedores_solidarios' and policyname='devedores_solidarios_cedente_select') as devedores_cedente_policy,
    exists(select 1 from pg_policies where schemaname='public' and tablename='devedores_solidarios' and policyname='devedores_solidarios_gestor_select_multifundo') as devedores_gestor_policy,
    not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('storage_contratos_gestor_insert','storage_contratos_gestor_update')) as storage_legado_ausente,
    not has_function_privilege('anon', 'public.aprovar_operacao_atomica(uuid,numeric)', 'EXECUTE') as anon_sem_aprovacao,
    not has_function_privilege('authenticated', 'public.aprovar_operacao_atomica(uuid,numeric)', 'EXECUTE') as authenticated_sem_bypass`)
  return row
}

async function compareWithHomolog(localSnapshot) {
  const remoteDb = await openDatabase(loadHomologDbUrl(), 'bw_antecipa_p264_homolog_snapshot', true)
  try {
    const remoteSnapshot = await captureSchemaSnapshot(remoteDb, 'homolog-p2-6-4')
    const parity = compareSchemaSnapshots(remoteSnapshot, localSnapshot)
    parity.schema = 'bw-antecipa-p2-6-4-schema-parity-v1'
    parity.captured_at = new Date().toISOString()
    parity.homolog.project_ref = HOMOLOG_REF
    parity.clean_room.project_id = LOCAL_PROJECT_ID
    writeJson(parityPath, parity)
    result.parity = {
      status: parity.status,
      material_differences: parity.material_differences.length,
      allowed_differences: parity.allowed_differences.length,
    }
    if (parity.status !== 'PASS') throw new Error(`Schema parity final possui ${parity.material_differences.length} diferencas materiais.`)
  } finally {
    await closeDatabase(remoteDb, true)
  }
}

function assertRuntime() {
  if (!process.version.startsWith('v22.')) throw new Error(`Node 22 obrigatorio; recebido ${process.version}.`)
  if (run('git', ['branch', '--show-current']).stdout.trim() !== 'homolog') throw new Error('Branch homolog obrigatoria.')
  if (!existsSync(CLI_PATH) || !existsSync(BOOTSTRAP_CANDIDATE)) throw new Error('Dependencia de clean-room ausente.')
  for (const key of ['DATABASE_URL', 'SUPABASE_DB_URL']) {
    if (process.env[key] && !isLocalUrl(process.env[key])) throw new Error(`${key} remoto bloqueado no clean-room.`)
  }
}

function validateInventory() {
  const inventory = buildMigrationInventory()
  const seen = new Set()
  for (const migration of inventory.migrations) {
    if (!migration.bytes) throw new Error(`Migration vazia: ${migration.filename}.`)
    if (seen.has(migration.timestamp)) throw new Error(`Timestamp duplicado: ${migration.timestamp}.`)
    seen.add(migration.timestamp)
  }
  if (existsSync(BASELINE_INVENTORY)) {
    const baseline = JSON.parse(readFileSync(BASELINE_INVENTORY, 'utf8'))
    const expected = new Map(baseline.migrations.map((item) => [item.filename, item.sha256]))
    const changed = inventory.migrations.filter((item) => expected.has(item.filename) && expected.get(item.filename) !== item.sha256)
    if (changed.length) throw new Error(`Migration historica alterada: ${changed.map((item) => item.filename).join(', ')}.`)
  }
  return inventory
}

function prepareIsolatedProject() {
  mkdirSync(cleanRoot, { recursive: true })
  cpSync(resolve('supabase'), resolve(cleanRoot, 'supabase'), { recursive: true })
  const configPath = resolve(cleanRoot, 'supabase/config.toml')
  const config = readFileSync(configPath, 'utf8').replace(/^project_id\s*=.*$/m, `project_id = "${LOCAL_PROJECT_ID}"`)
  writeFileSync(configPath, config, 'utf8')
  cpSync(BOOTSTRAP_CANDIDATE, resolve(cleanRoot, 'supabase/migrations/001_schema_base_candidate.sql'))
}

function loadHomologDbUrl() {
  const entries = new Map()
  for (const line of readFileSync(resolve('.env.homolog'), 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (match) entries.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ''))
  }
  const value = entries.get('SUPABASE_DB_URL') || entries.get('DATABASE_URL')
  if (!value) throw new Error('URL de homologacao ausente.')
  const url = new URL(value)
  const ref = decodeURIComponent(url.username).match(/^postgres[.]([a-z0-9]+)$/i)?.[1]
    || url.hostname.match(/^db[.]([a-z0-9]+)[.]supabase[.]co$/i)?.[1]
  if (ref !== HOMOLOG_REF) throw new Error('URL remota nao aponta para homologacao autorizada.')
  return value
}

function stopLocalStack() {
  if (!existsSync(resolve(cleanRoot, 'supabase/config.toml'))) return { status: 'NOT_STARTED' }
  const stopped = runCli(['stop', '--workdir', cleanRoot, '--no-backup'], true)
  if (stopped.status !== 0) return { status: 'FAIL', output: sanitizeOutput(stopped.combined) }
  const allowedRoot = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'p2-6-4')
  if (!cleanRoot.startsWith(`${allowedRoot}\\`)) return { status: 'FAIL', output: 'Workspace temporario fora do escopo permitido.' }
  rmSync(cleanRoot, { recursive: true, force: true })
  return { status: 'PASS', stack_stopped: true, workspace_removed: true }
}

function runCli(args, allowFailure = false) {
  return run(process.execPath, [CLI_PATH, ...args], allowFailure)
}

function run(command, args, allowFailure = false) {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  delete env.DATABASE_URL
  delete env.SUPABASE_DB_URL
  delete env.SUPABASE_ACCESS_TOKEN
  const child = spawnSync(command, args, { cwd: process.cwd(), env, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024, timeout: 900_000 })
  if (child.error) throw child.error
  const combined = [child.stdout, child.stderr].filter(Boolean).join('\n').trim()
  if ((child.status ?? 1) !== 0 && !allowFailure) throw new Error(`${command} falhou: ${sanitizeOutput(combined)}`)
  return { status: child.status ?? 1, stdout: child.stdout || '', stderr: child.stderr || '', combined }
}

function isLocalUrl(value) {
  return ['127.0.0.1', 'localhost', '::1'].includes(new URL(value).hostname)
}

function sanitizeOutput(value) {
  return sanitizeError(value).replace(/(password|service_role|access_token)\s*[=:]\s*\S+/gi, '$1=[REDACTED]').replace(/\u001b\[[0-9;]*m/g, '')
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
