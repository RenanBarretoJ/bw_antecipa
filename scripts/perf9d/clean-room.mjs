#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import { parseArgs } from '../perf9a/common.mjs'
import { inventoryMigrations, redactSensitiveText, sha256 } from './audit-lib.mjs'

const CONFIRMATION = 'DISPOSABLE_LOCAL_ONLY'
const args = parseArgs()

try {
  await main()
} catch (error) {
  console.error(`\nProva clean-room 9D falhou: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

async function main() {
  if (args.confirm !== CONFIRMATION) {
    throw new Error(`Confirme o alvo descartavel local com --confirm ${CONFIRMATION}.`)
  }
  if (args['db-url'] || args.linked || args.remote || args.prod || args.production || args['env-file']) {
    throw new Error('A prova clean-room recusa DB URL, projeto linked, ambiente remoto e arquivos de ambiente.')
  }

  const repositoryRoot = process.cwd()
  const sourceSupabase = resolve(repositoryRoot, 'supabase')
  const cli = resolve(repositoryRoot, 'node_modules/supabase/bin', process.platform === 'win32' ? 'supabase.exe' : 'supabase')
  if (!existsSync(cli)) throw new Error('Supabase CLI local nao encontrado em node_modules.')

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const workdir = resolve(getPerf9dLocalDir('clean-room'), timestamp)
  const targetSupabase = resolve(workdir, 'supabase')
  mkdirSync(workdir, { recursive: true, mode: 0o700 })
  cpSync(sourceSupabase, targetSupabase, {
    recursive: true,
    filter: (source) => !source.includes(`${separator()}supabase${separator()}.temp`),
  })

  const configPath = resolve(targetSupabase, 'config.toml')
  const projectId = `bw_antecipa_perf9d_${timestamp.replace(/[^0-9]/g, '').slice(0, 14)}`
  let config = readFileSync(configPath, 'utf8')
    .replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`)
    .replace(/^port\s*=\s*54321$/m, 'port = 56321')
    .replace(/^port\s*=\s*54322$/m, 'port = 56322')
    .replace(/^shadow_port\s*=\s*54320$/m, 'shadow_port = 56320')
    .replace(/^port\s*=\s*54329$/m, 'port = 56329')
    .replace(/^port\s*=\s*54323$/m, 'port = 56323')
    .replace(/^port\s*=\s*54324$/m, 'port = 56324')
    .replace(/^port\s*=\s*54327$/m, 'port = 56327')
  config = config.replace(/(\[db\.seed\][\s\S]*?enabled\s*=\s*)true/, '$1false')
  writeFileSync(configPath, config, { encoding: 'utf8', mode: 0o600 })

  const inventory = inventoryMigrations(resolve(targetSupabase, 'migrations'))
  const evidence = {
    metadata: {
      format: 'bw-antecipa-perf9d-clean-room-v1',
      startedAt: new Date().toISOString(),
      target: 'local-disposable-supabase',
      projectId,
      workdir,
      migrationCount: inventory.count,
      sourceManifestSha256: sha256(JSON.stringify(inventory.migrations.map((item) => ({ version: item.version, sha256: item.sha256 })))),
      remoteCredentialsInherited: false,
      remoteMutationExecuted: false,
    },
    commands: [],
    firstFailure: null,
    localMigrationHistory: [],
    schemaDump: null,
  }

  const childEnvironment = sanitizedLocalEnvironment()
  let started = false
  try {
    const start = runCli(cli, ['start', '--workdir', workdir, '--exclude', 'gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], childEnvironment)
    evidence.commands.push(start)
    started = start.exitCode === 0
    if (!started) {
      evidence.firstFailure = failureFrom('supabase start', start)
      return finalize(evidence)
    }

    const reset = runCli(cli, ['db', 'reset', '--local', '--no-seed', '--workdir', workdir], childEnvironment)
    evidence.commands.push(reset)
    if (reset.exitCode !== 0) {
      evidence.firstFailure = failureFrom('supabase db reset --local', reset)
      return finalize(evidence)
    }

    const dumpPath = resolve(workdir, 'schema-clean-room.sql')
    const dump = runCli(cli, ['db', 'dump', '--local', '--schema', 'public,private,storage', '--file', dumpPath, '--workdir', workdir], childEnvironment)
    evidence.commands.push(dump)
    if (dump.exitCode === 0 && existsSync(dumpPath)) {
      const dumpSql = readFileSync(dumpPath, 'utf8')
      evidence.schemaDump = { path: dumpPath, bytes: Buffer.byteLength(dumpSql), sha256: sha256(dumpSql) }
    } else if (dump.exitCode !== 0) evidence.firstFailure = failureFrom('supabase db dump --local', dump)

    evidence.localMigrationHistory = await readLocalMigrationHistory()
    return finalize(evidence)
  } finally {
    if (started) {
      const stop = runCli(cli, ['stop', '--no-backup', '--workdir', workdir], childEnvironment)
      evidence.commands.push(stop)
      evidence.metadata.stoppedAt = new Date().toISOString()
      writeEvidence(evidence)
    }
  }
}

function runCli(cli, cliArgs, environment) {
  const startedAt = Date.now()
  const result = spawnSync(cli, cliArgs, {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
    timeout: 900_000,
    windowsHide: true,
  })
  return {
    executable: basename(cli),
    args: cliArgs,
    exitCode: result.status ?? (result.error ? 1 : 0),
    durationMs: Date.now() - startedAt,
    stdout: redactSensitiveText(result.stdout ?? ''),
    stderr: redactSensitiveText(result.stderr ?? result.error?.message ?? ''),
  }
}

function sanitizedLocalEnvironment() {
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (/^(DATABASE_URL|SUPABASE_DB_URL|SUPABASE_ACCESS_TOKEN|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL)$/i.test(key)) {
      delete environment[key]
    }
  }
  return environment
}

async function readLocalMigrationHistory() {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:56322/postgres' })
  await client.connect()
  try {
    const result = await client.query('SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version')
    return result.rows
  } finally {
    await client.end()
  }
}

function failureFrom(stage, result) {
  const combined = `${result.stderr}\n${result.stdout}`.trim()
  const migration = combined.match(/(?:migration|file)\s+([^\s]+\.sql)/i)?.[1] ?? null
  const sqlstate = combined.match(/SQLSTATE\s*[:=]?\s*([0-9A-Z]{5})/i)?.[1] ?? null
  return { stage, migration, sqlstate, message: combined.slice(-8_000) }
}

function finalize(evidence) {
  evidence.metadata.finishedAt = new Date().toISOString()
  evidence.metadata.success = evidence.firstFailure == null && evidence.localMigrationHistory.length === evidence.metadata.migrationCount
  evidence.metadata.payloadSha256 = sha256(JSON.stringify(evidence))
  const path = writeEvidence(evidence)
  console.log('\nBW Antecipa - prova clean-room 9D')
  console.log(`Stack descartavel: ${evidence.metadata.projectId}`)
  console.log(`Migrations esperadas: ${evidence.metadata.migrationCount}`)
  console.log(`Migrations registradas localmente: ${evidence.localMigrationHistory.length}`)
  console.log(`Resultado: ${evidence.metadata.success ? 'REPRODUZIVEL' : 'FALHOU'}`)
  if (evidence.firstFailure) console.log(`Primeira falha: ${evidence.firstFailure.stage} / ${evidence.firstFailure.migration ?? 'migration nao identificada'}`)
  console.log(`Evidencia local restrita: ${path}`)
  console.log('Nenhuma conexao remota foi utilizada.')
  return evidence
}

function writeEvidence(evidence) {
  const path = resolve(evidence.metadata.workdir, 'clean-room-evidence.json')
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(path, 0o600) } catch { /* Windows nao aplica modo POSIX. */ }
  return path
}

function getPerf9dLocalDir(...segments) {
  return resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'perf9d', ...segments)
}

function separator() {
  return process.platform === 'win32' ? '\\' : '/'
}
