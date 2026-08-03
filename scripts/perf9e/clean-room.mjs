#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Client } from 'pg'
import { parseArgs } from '../perf9a/common.mjs'
import {
  assertCleanRoomArguments,
  configureDisposableToml,
  fileSha256,
  redactCommandOutput,
  sanitizedLocalEnvironment,
  sha256,
} from './clean-room-lib.mjs'

const args = parseArgs()
const repositoryRoot = process.cwd()
const candidatePath = resolve(repositoryRoot, 'scripts/perf9e/bootstrap/schema-base-candidate.sql')
const cliScript = resolve(repositoryRoot, 'node_modules/supabase/dist/supabase.js')
const expectedActiveMigrations = 74

try {
  await main()
} catch (error) {
  console.error(`\nClean-room 9E falhou: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

async function main() {
  assertCleanRoomArguments(args)
  if (!existsSync(candidatePath)) throw new Error('Bootstrap candidato nao encontrado.')
  if (!existsSync(cliScript)) throw new Error('Supabase CLI local nao encontrado.')

  const activeMigrations = readdirSync(resolve(repositoryRoot, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()
  if (activeMigrations.length !== expectedActiveMigrations) {
    throw new Error(`Cadeia ativa inesperada: ${activeMigrations.length}; esperado ${expectedActiveMigrations}.`)
  }
  if (activeMigrations.some((name) => /^(001|002)_/.test(name))) {
    throw new Error('Bootstrap 001/002 nao pode existir na cadeia ativa durante o Escopo 9E.')
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const root = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'perf9e', 'clean-room', runId)
  mkdirSync(root, { recursive: true, mode: 0o700 })

  const evidence = {
    metadata: {
      format: 'bw-antecipa-perf9e-clean-room-v1',
      startedAt: new Date().toISOString(),
      target: 'two-independent-local-disposable-supabase-stacks',
      activeMigrationCount: activeMigrations.length,
      bootstrapCandidateSha256: fileSha256(candidatePath),
      sourceManifestSha256: sha256(activeMigrations.map((name) => `${name}:${fileSha256(resolve(repositoryRoot, 'supabase/migrations', name))}`).join('\n')),
      remoteCredentialsInherited: false,
      remoteConnectionUsed: false,
      remoteMutationExecuted: false,
      exactCyclesRequired: 2,
    },
    cycles: [],
  }

  for (let cycle = 1; cycle <= 2; cycle += 1) {
    const result = await runCycle({ cycle, root, runId, activeMigrations })
    evidence.cycles.push(result)
    writeEvidence(root, evidence)
    if (!result.success) break
  }

  evidence.metadata.finishedAt = new Date().toISOString()
  evidence.metadata.success = evidence.cycles.length === 2 && evidence.cycles.every((cycle) => cycle.success)
  evidence.metadata.reproducible = evidence.metadata.success
    && evidence.cycles[0].schemaDump?.sha256 === evidence.cycles[1].schemaDump?.sha256
    && evidence.cycles[0].catalog?.sha256 === evidence.cycles[1].catalog?.sha256
  evidence.metadata.payloadSha256 = sha256(JSON.stringify(evidence))
  const evidencePath = writeEvidence(root, evidence)

  console.log('\nBW Antecipa - Escopo 9E / clean-room')
  for (const cycle of evidence.cycles) {
    console.log(`Ciclo ${cycle.cycle}: ${cycle.success ? 'APROVADO' : 'FALHOU'} (${cycle.migrationHistory.length}/${expectedActiveMigrations + 1} entradas incluindo bootstrap)`)
    if (cycle.failure) console.log(`  Primeira falha: ${cycle.failure.stage} / ${cycle.failure.migration ?? 'migration nao identificada'}`)
  }
  console.log(`Reprodutivel: ${evidence.metadata.reproducible ? 'SIM' : 'NAO'}`)
  console.log(`Evidencia local restrita: ${evidencePath}`)
  console.log('Nenhuma conexao remota foi utilizada.')
  if (!evidence.metadata.reproducible) process.exitCode = 1
}

async function runCycle({ cycle, root, runId, activeMigrations }) {
  const cycleRoot = resolve(root, `cycle-${cycle}`)
  const targetSupabase = resolve(cycleRoot, 'supabase')
  mkdirSync(cycleRoot, { recursive: true, mode: 0o700 })
  cpSync(resolve(repositoryRoot, 'supabase'), targetSupabase, {
    recursive: true,
    filter: (source) => !source.includes(`${separator()}supabase${separator()}.temp`),
  })
  cpSync(candidatePath, resolve(targetSupabase, 'migrations/001_schema_base_candidate.sql'))

  const base = 57400 + (cycle * 20)
  const ports = { apiPort: base + 1, dbPort: base + 2, shadowPort: base, studioPort: base + 3, mailPort: base + 4, analyticsPort: base + 7 }
  const projectId = `bw_antecipa_perf9e_${runId.replace(/[^0-9]/g, '').slice(0, 14)}_${cycle}`
  const configPath = resolve(targetSupabase, 'config.toml')
  writeFileSync(configPath, configureDisposableToml(readFileSync(configPath, 'utf8'), { projectId, ...ports }), { encoding: 'utf8', mode: 0o600 })

  const result = {
    cycle,
    projectId,
    workdir: cycleRoot,
    activeMigrations: activeMigrations.length,
    expectedHistoryEntries: activeMigrations.length + 1,
    startedAt: new Date().toISOString(),
    commands: [],
    migrationHistory: [],
    functionalChecks: [],
    failure: null,
    success: false,
  }
  const environment = sanitizedLocalEnvironment()
  let started = false
  try {
    const start = runCli(['start', '--workdir', cycleRoot, '--exclude', 'gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], environment)
    result.commands.push(start)
    started = start.exitCode === 0
    if (!started) return fail(result, 'supabase start', start)

    const reset = runCli(['db', 'reset', '--local', '--no-seed', '--workdir', cycleRoot], environment)
    result.commands.push(reset)
    if (reset.exitCode !== 0) return fail(result, 'supabase db reset --local', reset)

    const connectionString = `postgresql://postgres:postgres@127.0.0.1:${ports.dbPort}/postgres`
    const client = new Client({ connectionString, application_name: `bw_antecipa_perf9e_cycle_${cycle}` })
    await client.connect()
    try {
      result.migrationHistory = (await client.query('SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version')).rows
      result.catalog = await collectCompactCatalog(client)
      result.functionalChecks = await runReducedFunctionalChecks(client)
    } finally {
      await client.end()
    }

    if (result.migrationHistory.length !== result.expectedHistoryEntries) {
      result.failure = { stage: 'migration history', message: `Esperado ${result.expectedHistoryEntries}, obtido ${result.migrationHistory.length}.` }
      return result
    }
    if (result.functionalChecks.some((check) => !check.passed)) {
      result.failure = { stage: 'reduced functional checks', message: 'Ao menos um gate reduzido 9B/9C falhou.' }
      return result
    }

    const dumpPath = resolve(cycleRoot, 'schema-clean-final.sql')
    const dump = runCli(['db', 'dump', '--local', '--schema', 'public,private,storage', '--file', dumpPath, '--workdir', cycleRoot], environment)
    result.commands.push(dump)
    if (dump.exitCode !== 0 || !existsSync(dumpPath)) return fail(result, 'supabase db dump --local', dump)
    result.schemaDump = { path: dumpPath, bytes: readFileSync(dumpPath).byteLength, sha256: fileSha256(dumpPath) }
    result.success = true
    result.finishedAt = new Date().toISOString()
    return result
  } catch (error) {
    result.failure = { stage: 'unexpected', message: redactCommandOutput(error instanceof Error ? error.message : String(error)) }
    return result
  } finally {
    if (started) {
      const stop = runCli(['stop', '--no-backup', '--workdir', cycleRoot], environment)
      result.commands.push(stop)
      result.stoppedAt = new Date().toISOString()
    }
  }
}

async function collectCompactCatalog(client) {
  const queries = {
    relations: `SELECT n.nspname schema_name, c.relname relation_name, c.relkind, c.relrowsecurity rls_enabled, c.relforcerowsecurity rls_forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','storage') AND c.relkind IN ('r','p','v','m') ORDER BY 1,2`,
    columns: `SELECT n.nspname schema_name, c.relname table_name, a.attname column_name, pg_catalog.format_type(a.atttypid,a.atttypmod) formatted_type, a.attnotnull not_null, pg_get_expr(ad.adbin,ad.adrelid) default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum WHERE n.nspname IN ('public','private','storage') AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,a.attnum`,
    enums: `SELECT n.nspname schema_name,t.typname type_name,array_agg(e.enumlabel ORDER BY e.enumsortorder) labels FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname IN ('public','private','storage') GROUP BY 1,2 ORDER BY 1,2`,
    constraints: `SELECT n.nspname schema_name,c.relname table_name,con.conname constraint_name,con.contype,pg_get_constraintdef(con.oid,true) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','storage') ORDER BY 1,2,3`,
    indexes: `SELECT ns.nspname schema_name,idx.relname index_name,tbl.relname table_name,i.indisunique is_unique,i.indisvalid is_valid,pg_get_indexdef(i.indexrelid) definition FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_class tbl ON tbl.oid=i.indrelid JOIN pg_namespace ns ON ns.oid=tbl.relnamespace WHERE ns.nspname IN ('public','private','storage') ORDER BY 1,2`,
    routines: `SELECT n.nspname schema_name,p.proname routine_name,pg_get_function_identity_arguments(p.oid) identity_arguments,pg_get_function_result(p.oid) result_type,l.lanname language,p.provolatile volatility,p.prosecdef security_definer,p.proconfig config,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN ('public','private','storage') ORDER BY 1,2,3`,
    triggers: `SELECT n.nspname schema_name,c.relname table_name,t.tgname trigger_name,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','storage') AND NOT t.tgisinternal ORDER BY 1,2,3`,
    policies: `SELECT schemaname schema_name,tablename table_name,policyname policy_name,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname IN ('public','private','storage') ORDER BY 1,2,3`,
    buckets: `SELECT id,name,public,file_size_limit,allowed_mime_types FROM storage.buckets ORDER BY id`,
  }
  const snapshot = {}
  for (const [name, sql] of Object.entries(queries)) snapshot[name] = (await client.query(sql)).rows
  snapshot.sha256 = sha256(JSON.stringify(snapshot))
  snapshot.counts = Object.fromEntries(Object.entries(snapshot).filter(([, value]) => Array.isArray(value)).map(([name, value]) => [name, value.length]))
  return snapshot
}

async function runReducedFunctionalChecks(client) {
  const scalar = async (name, sql) => {
    const value = (await client.query(sql)).rows[0]?.ok === true
    return { name, passed: value }
  }
  return Promise.all([
    scalar('9B: RLS habilitado em tabelas publicas sensiveis', `SELECT bool_and(c.relrowsecurity) ok FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('fundos','cedentes','cedente_fundos','notas_fiscais','operacoes','documentos')`),
    scalar('9B: helpers privados de autorizacao existem', `SELECT count(*) >= 3 ok FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN ('usuario_pode_acessar_fundo','usuario_pode_acessar_cedente','usuario_pode_acessar_operacao')`),
    scalar('9B: funcoes security definer possuem search_path', `SELECT coalesce(bool_and(p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')),true) ok FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prosecdef`),
    scalar('9C: storage.objects possui RLS', `SELECT c.relrowsecurity ok FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relname='objects'`),
    scalar('9C: policies de storage usam fundo autorizado', `SELECT count(*) >= 4 ok FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND coalesce(qual,'') || coalesce(with_check,'') ILIKE '%fundo%'`),
    scalar('9C: buckets privados esperados existem', `SELECT count(*) >= 4 ok FROM storage.buckets WHERE public=false`),
  ])
}

function runCli(cliArgs, environment) {
  const startedAt = Date.now()
  const result = spawnSync(process.execPath, [cliScript, ...cliArgs], {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
    timeout: 1_200_000,
    windowsHide: true,
  })
  return {
    executable: `${basename(process.execPath)} supabase`,
    args: cliArgs,
    exitCode: result.status ?? (result.error ? 1 : 0),
    durationMs: Date.now() - startedAt,
    stdout: redactCommandOutput(result.stdout ?? ''),
    stderr: redactCommandOutput(result.stderr ?? result.error?.message ?? ''),
  }
}

function fail(result, stage, command) {
  const message = `${command.stderr}\n${command.stdout}`.trim()
  result.failure = {
    stage,
    migration: message.match(/(?:migration|file)\s+([^\s]+\.sql)/i)?.[1] ?? null,
    sqlstate: message.match(/SQLSTATE\s*[:=]?\s*([0-9A-Z]{5})/i)?.[1] ?? null,
    message: message.slice(-12_000),
  }
  result.finishedAt = new Date().toISOString()
  return result
}

function writeEvidence(root, evidence) {
  const path = join(root, 'clean-room-evidence.json')
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(path, 0o600) } catch { /* Windows nao aplica modo POSIX. */ }
  return path
}

function separator() {
  return process.platform === 'win32' ? '\\' : '/'
}
