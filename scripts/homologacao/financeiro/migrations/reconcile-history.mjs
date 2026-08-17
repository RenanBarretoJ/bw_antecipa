#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  assertHomologEnvironment,
  connectDb,
  loadHomologEnv,
  parseArgs,
} from '../../rlx-golden/helpers.mjs'
import { sanitizeError } from '../readiness/lib.mjs'

const AUTHORIZED_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const AUTHORIZED_BRANCH = 'homolog'
const PLAN_PATH = resolve('docs/financeiro/migration-history-repair-plan.json')
const RESULT_PATH = resolve('docs/financeiro/migration-history-repair-result.json')
const DEFAULT_BATCH_SIZE = 10
const MAX_BATCH_SIZE = 20
const KEY_DATA_TABLES = [
  'importacoes_financeiras',
  'importacao_linhas',
  'matching_execucoes',
  'matching_resultados',
  'conciliacao_execucoes',
  'conciliacao_resultados',
  'posicao_logistica_execucoes',
  'posicao_logistica_resultados',
  'exposicao_execucoes',
  'exposicao_overlay_itens',
  'risco_execucoes',
  'risco_motivos',
  'risco_revisoes',
]
const PRECHECKS = [
  ['generalizacao_estrutural', 'homolog:financeiro:generalizacao:verify'],
  ['p2_2_funcional', 'homolog:financeiro:ingestao:verify'],
  ['p2_2_seguranca', 'homolog:financeiro:ingestao:verify-security'],
  ['p2_3_funcional', 'homolog:financeiro:conciliacao:verify'],
  ['p2_3_seguranca', 'homolog:financeiro:conciliacao:verify-security'],
  ['p2_4_funcional', 'homolog:financeiro:logistica:verify'],
  ['p2_4_seguranca', 'homolog:financeiro:logistica:verify-security'],
  ['p2_5_funcional', 'homolog:financeiro:exposicao:verify'],
  ['p2_5_seguranca', 'homolog:financeiro:exposicao:verify-security'],
  ['p2_6_funcional', 'homolog:financeiro:risco:verify'],
  ['p2_6_seguranca', 'homolog:financeiro:risco:verify-security'],
  ['golden_v1', 'homolog:rlx:golden:verify'],
  ['golden_v2', 'homolog:rlx:golden:v2:verify'],
  ['golden_v2_seguranca', 'homolog:rlx:golden:v2:verify-security'],
]

const args = parseArgs()

main().catch((error) => {
  console.error(`\nP2.6.2 interrompido: ${sanitizeError(error)}\n`)
  process.exitCode = 1
})

async function main() {
  if (args.help || args.h) {
    console.log(helpText())
    return
  }

  loadHomologEnv()
  const env = assertHomologEnvironment(args)
  const runtime = validateRuntime(env)
  const inventory = buildStrictLocalInventory()
  const batchSize = parseBatchSize(args['batch-size'])
  const cliVersion = runSupabaseCli(['--version']).stdout.trim()
  const connectionMode = resolveConnectionMode()
  const db = await connectDb(env, 'p262_migration_history')

  let result = {
    schema: 'bw-antecipa-p2-6-2-migration-history-result-v1',
    project_ref: env.projectRef,
    environment: env.appEnv,
    branch: runtime.branch,
    connection_mode: connectionMode,
    production_mutated: false,
    executed_at: null,
    generated_at: new Date().toISOString(),
    status: 'IN_PROGRESS',
    versions_before: [],
    versions_repaired: [],
    versions_after: [],
    count_before: 0,
    count_repaired: 0,
    count_after: 0,
    checkpoints: [],
    prechecks_before: [],
    prechecks_after: [],
    snapshot_before: null,
    snapshot_after: null,
    schema_unchanged: null,
    data_unchanged: null,
    migration_list_before: null,
    migration_list_after: null,
    db_push_dry_run: null,
    error: null,
  }

  try {
    const remoteBefore = await readRemoteHistory(db)
    const comparison = compareInventories(inventory.migrations, remoteBefore)
    const migrationListBefore = runSupabaseCli(
      ['migration', 'list', ...connectionArgs(connectionMode, env.dbUrl)],
      { allowFailure: false },
    )
    const plan = buildPlan({ env, runtime, cliVersion, inventory, remoteBefore, comparison, migrationListBefore, connectionMode })
    writeJson(PLAN_PATH, plan)

    result.versions_before = remoteBefore.map((item) => item.version)
    result.count_before = remoteBefore.length
    result.migration_list_before = sanitizeCliOutput(migrationListBefore.combined)
    result.snapshot_before = await captureMaterialSnapshot(db)

    printPlanSummary(plan)
    if (comparison.remoteOnly.length) {
      result.status = 'ABORT_REMOTE_ONLY'
      result.error = `Versoes somente remotas: ${comparison.remoteOnly.map((item) => item.version).join(', ')}`
      writeJson(RESULT_PATH, result)
      throw new Error(result.error)
    }

    result.prechecks_before = runPrechecks(env.projectRef, 'antes')
    writeJson(RESULT_PATH, result)

    const confirmation = confirmationToken(env.projectRef, comparison.missingRemote.length)
    if (args.execute !== true) {
      result.status = comparison.missingRemote.length ? 'DRY_RUN_READY' : 'DRY_RUN_ALREADY_ALIGNED'
      result.count_after = result.count_before
      result.versions_after = [...result.versions_before]
      writeJson(RESULT_PATH, result)
      console.log(`\nDry-run concluido. Nenhuma mutacao foi executada.`)
      console.log(`Para executar, use exatamente:`)
      console.log(`npm run homolog:financeiro:migrations:reconcile-history -- --execute --expected-project-ref ${env.projectRef} --confirm ${confirmation}`)
      return
    }

    if (args.confirm !== confirmation) {
      result.status = 'ABORT_INVALID_CONFIRMATION'
      result.error = `Confirmacao invalida. Informe exatamente --confirm ${confirmation}.`
      writeJson(RESULT_PATH, result)
      throw new Error(result.error)
    }

    result.executed_at = new Date().toISOString()
    if (comparison.missingRemote.length) {
      await repairInBatches({ db, env, connectionMode, missing: comparison.missingRemote, batchSize, result })
    }

    const remoteAfter = await readRemoteHistory(db)
    const finalComparison = compareInventories(inventory.migrations, remoteAfter)
    if (finalComparison.missingRemote.length || finalComparison.remoteOnly.length) {
      throw new Error(`Historico final divergente: ${finalComparison.missingRemote.length} ausentes e ${finalComparison.remoteOnly.length} somente remotas.`)
    }

    const migrationListAfter = runSupabaseCli(['migration', 'list', ...connectionArgs(connectionMode, env.dbUrl)])
    const dbPushDryRun = runSupabaseCli(['db', 'push', '--dry-run', ...connectionArgs(connectionMode, env.dbUrl)])
    assertNoPendingMigrations(dbPushDryRun.combined)

    result.versions_after = remoteAfter.map((item) => item.version)
    result.count_after = remoteAfter.length
    result.count_repaired = result.versions_repaired.length
    result.migration_list_after = sanitizeCliOutput(migrationListAfter.combined)
    result.db_push_dry_run = sanitizeCliOutput(dbPushDryRun.combined)
    result.snapshot_after = await captureMaterialSnapshot(db)
    result.schema_unchanged = stableJson(result.snapshot_before.schema) === stableJson(result.snapshot_after.schema)
    result.data_unchanged = stableJson(result.snapshot_before.data) === stableJson(result.snapshot_after.data)
    if (!result.schema_unchanged || !result.data_unchanged) {
      throw new Error(`Prova material falhou: schema_unchanged=${result.schema_unchanged}; data_unchanged=${result.data_unchanged}.`)
    }

    result.prechecks_after = runPrechecks(env.projectRef, 'depois')
    result.status = 'PASS'
    writeJson(RESULT_PATH, result)
    console.log(`\nP2.6.2 concluido: ${result.count_repaired} versoes reparadas; ${result.count_after}/${inventory.total} alinhadas.`)
  } catch (error) {
    if (!String(result.status).startsWith('ABORT')) result.status = 'FAIL'
    result.error = sanitizeError(error)
    writeJson(RESULT_PATH, result)
    throw error
  } finally {
    await db.end().catch(() => undefined)
  }
}

function validateRuntime(env) {
  if (env.projectRef !== AUTHORIZED_PROJECT_REF) throw new Error(`Project ref nao autorizado: ${env.projectRef}.`)
  const expected = String(args['expected-project-ref'] || '')
  if (expected !== AUTHORIZED_PROJECT_REF) throw new Error(`Informe --expected-project-ref ${AUTHORIZED_PROJECT_REF}.`)
  const branch = runGit(['branch', '--show-current']).trim()
  if (branch !== AUTHORIZED_BRANCH) throw new Error(`Branch bloqueada: esperado ${AUTHORIZED_BRANCH}; recebido ${branch || 'ausente'}.`)

  const config = readFileSync(resolve('supabase/config.toml'), 'utf8')
  const configuredRef = config.match(/^project_id\s*=\s*["']([^"']+)["']/m)?.[1]
  if (configuredRef !== AUTHORIZED_PROJECT_REF) throw new Error('supabase/config.toml nao aponta para a homologacao autorizada.')

  const productionRef = String(process.env.SUPABASE_PRODUCTION_PROJECT_REF || '').trim()
  if (!productionRef) throw new Error('SUPABASE_PRODUCTION_PROJECT_REF deve identificar explicitamente producao em .env.homolog.')
  if (productionRef === env.projectRef) throw new Error('Project ref de homologacao coincide com producao. Execucao bloqueada.')
  return { branch, configured_project_ref: configuredRef, production_ref_identified: true }
}

function resolveConnectionMode() {
  const requested = String(args['connection-mode'] || 'auto').toLowerCase()
  if (!['auto', 'linked', 'db-url'].includes(requested)) throw new Error('--connection-mode deve ser auto, linked ou db-url.')
  const linkedRefFiles = [resolve('supabase/.temp/project-ref'), resolve('.supabase/project-ref')]
  const linked = linkedRefFiles.some((path) => existsSync(path) && readFileSync(path, 'utf8').trim() === AUTHORIZED_PROJECT_REF)
  const authenticated = Boolean(process.env.SUPABASE_ACCESS_TOKEN)
  if (requested === 'linked' && (!linked || !authenticated)) {
    throw new Error('Modo linked solicitado, mas o CLI nao esta simultaneamente linkado e autenticado.')
  }
  if (requested === 'db-url') return 'db-url'
  return linked && authenticated ? 'linked' : 'db-url'
}

function buildStrictLocalInventory() {
  const directory = resolve('supabase/migrations')
  const filenames = readdirSync(directory).filter((filename) => filename.endsWith('.sql')).sort()
  const versions = new Set()
  const migrations = filenames.map((filename) => {
    const match = filename.match(/^([0-9]+)_(.+)\.sql$/)
    if (!match) throw new Error(`Filename de migration invalido: ${filename}`)
    if (versions.has(match[1])) throw new Error(`Versao de migration duplicada: ${match[1]}`)
    versions.add(match[1])
    const content = readFileSync(resolve(directory, filename))
    if (!content.toString('utf8').trim()) throw new Error(`Migration vazia: ${filename}`)
    return {
      version: match[1],
      filename,
      sha256: createHash('sha256').update(content).digest('hex'),
      size: content.byteLength,
    }
  })
  const ordered = [...migrations].sort((left, right) => BigInt(left.version) < BigInt(right.version) ? -1 : BigInt(left.version) > BigInt(right.version) ? 1 : left.filename.localeCompare(right.filename))
  if (ordered.some((item, index) => item.filename !== migrations[index].filename)) {
    throw new Error('Migrations locais nao estao na ordenacao crescente esperada por versao.')
  }
  return { total: migrations.length, migrations }
}

async function readRemoteHistory(db) {
  const { rows } = await db.query('select version::text, name::text from supabase_migrations.schema_migrations order by version')
  return rows
}

function compareInventories(local, remote) {
  const localByVersion = new Map(local.map((item) => [item.version, item]))
  const remoteByVersion = new Map(remote.map((item) => [item.version, item]))
  return {
    missingRemote: local.filter((item) => !remoteByVersion.has(item.version)),
    remoteOnly: remote.filter((item) => !localByVersion.has(item.version)),
  }
}

function buildPlan({ env, runtime, cliVersion, inventory, remoteBefore, comparison, migrationListBefore, connectionMode }) {
  const localByVersion = new Map(inventory.migrations.map((item) => [item.version, item]))
  const remoteByVersion = new Map(remoteBefore.map((item) => [item.version, item]))
  const versions = [...new Set([...localByVersion.keys(), ...remoteByVersion.keys()])]
    .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1)
  return {
    schema: 'bw-antecipa-p2-6-2-migration-history-plan-v1',
    generated_at: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    project_ref: env.projectRef,
    environment: env.appEnv,
    branch: runtime.branch,
    cli_version: cliVersion,
    node_version: process.version,
    connection_mode: connectionMode,
    production_ref_identified: runtime.production_ref_identified,
    production_mutated: false,
    migration_count_local: inventory.total,
    migration_count_remote: remoteBefore.length,
    migration_count_missing_remote: comparison.missingRemote.length,
    migration_count_remote_only: comparison.remoteOnly.length,
    first_missing: comparison.missingRemote[0]?.version ?? null,
    last_missing: comparison.missingRemote.at(-1)?.version ?? null,
    confirmation_required: confirmationToken(env.projectRef, comparison.missingRemote.length),
    migration_list_before: sanitizeCliOutput(migrationListBefore.combined),
    migrations: versions.map((version) => {
      const local = localByVersion.get(version)
      const remote = remoteByVersion.get(version)
      return {
        version,
        filename: local?.filename ?? null,
        sha256: local?.sha256 ?? null,
        size: local?.size ?? null,
        local: Boolean(local),
        remote: Boolean(remote),
        action: local && remote ? 'ALINHADA' : local ? 'REPAIR_APPLIED' : 'ABORT_REMOTE_ONLY',
      }
    }),
  }
}

async function captureMaterialSnapshot(db) {
  await db.query('BEGIN READ ONLY')
  try {
    const relations = await db.query(`select n.nspname schema_name, c.relkind, count(*)::int total
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private','storage') and c.relkind in ('r','p','v','m','S')
      group by n.nspname,c.relkind order by n.nspname,c.relkind`)
    const rls = await db.query(`select
        count(*) filter (where c.relrowsecurity)::int rls_enabled,
        count(*) filter (where c.relforcerowsecurity)::int rls_forced,
        (select count(*)::int from pg_policies where schemaname in ('public','storage')) policy_count
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','storage') and c.relkind in ('r','p')`)
    const foreignKeys = await db.query(`select count(*)::int total
      from pg_constraint c join pg_namespace n on n.oid=c.connamespace
      where n.nspname in ('public','private','storage') and c.contype='f'`)
    const routines = await db.query(`select p.oid::regprocedure::text signature,
        md5(pg_get_functiondef(p.oid)) definition_hash
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and (
        p.proname like '%financeir%' or p.proname like '%matching%' or p.proname like '%conciliacao%'
        or p.proname like '%logistica%' or p.proname like '%exposicao%' or p.proname like '%risco%'
      ) order by 1`)
    const storage = await db.query(`select id::text, public, file_size_limit, coalesce(array_length(allowed_mime_types,1),0)::int allowed_mime_count
      from storage.buckets order by id`)

    const data = {}
    for (const table of KEY_DATA_TABLES) {
      const exists = await db.query('select to_regclass($1) is not null present', [`public.${table}`])
      if (!exists.rows[0].present) {
        data[table] = { present: false }
        continue
      }
      const aggregate = await db.query(`select count(*)::int row_count,
          coalesce(sum(pg_column_size(t)),0)::text row_bytes,
          coalesce(sum(hashtextextended(to_jsonb(t)::text,0)::numeric),0)::text content_fingerprint
        from public.${table} t`)
      data[table] = { present: true, ...aggregate.rows[0] }
    }

    await db.query('ROLLBACK')
    return {
      captured_at: new Date().toISOString(),
      schema: {
        relations: relations.rows,
        rls: rls.rows[0],
        foreign_keys: foreignKeys.rows[0].total,
        principal_rpcs: routines.rows,
        storage_buckets: storage.rows,
      },
      data,
    }
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

function runPrechecks(projectRef, phase) {
  console.log(`\nExecutando matriz critica (${phase})...`)
  return PRECHECKS.map(([id, npmScript]) => {
    const startedAt = new Date().toISOString()
    const run = runNpmScript(npmScript, ['--expected-project-ref', projectRef])
    const evidence = {
      id,
      npm_script: npmScript,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: run.status,
      status: run.status === 0 ? 'PASS' : 'FAIL',
      output_tail: sanitizeCliOutput(run.combined).split(/\r?\n/).slice(-20).join('\n'),
    }
    console.log(`${evidence.status} ${id}`)
    if (run.status !== 0) throw new Error(`Precheck critico falhou (${id}): ${evidence.output_tail}`)
    return evidence
  })
}

async function repairInBatches({ db, env, connectionMode, missing, batchSize, result }) {
  for (let index = 0; index < missing.length; index += batchSize) {
    const batch = missing.slice(index, index + batchSize)
    const before = await readRemoteHistory(db)
    const repair = runSupabaseCli([
      'migration', 'repair', ...batch.map((item) => item.version),
      '--status', 'applied', ...connectionArgs(connectionMode, env.dbUrl), '--yes',
    ])
    const after = await readRemoteHistory(db)
    const expected = before.length + batch.length
    const checkpointList = runSupabaseCli(['migration', 'list', ...connectionArgs(connectionMode, env.dbUrl)])
    const checkpoint = {
      batch: result.checkpoints.length + 1,
      versions: batch.map((item) => item.version),
      count_before: before.length,
      count_after: after.length,
      expected_count_after: expected,
      migration_list: sanitizeCliOutput(checkpointList.combined),
      repair_output: sanitizeCliOutput(repair.combined),
      status: after.length === expected ? 'PASS' : 'FAIL',
    }
    result.checkpoints.push(checkpoint)
    if (after.length !== expected) {
      result.status = 'FAIL_CHECKPOINT'
      result.error = `Checkpoint ${checkpoint.batch}: esperado ${expected}, recebido ${after.length}.`
      writeJson(RESULT_PATH, result)
      throw new Error(result.error)
    }
    result.versions_repaired.push(...batch.map((item) => item.version))
    result.count_repaired = result.versions_repaired.length
    writeJson(RESULT_PATH, result)
    console.log(`Checkpoint ${checkpoint.batch}: ${batch.length} versoes; remoto ${before.length} -> ${after.length}.`)
  }
}

function runSupabaseCli(cliArgs, options = {}) {
  const cli = resolve('node_modules/supabase/dist/supabase.js')
  if (!existsSync(cli)) throw new Error('Supabase CLI local nao encontrado. Execute npm install antes de continuar.')
  const child = spawnSync(process.execPath, [cli, ...cliArgs], {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  })
  if (child.error) throw child.error
  const combined = [child.stdout, child.stderr].filter(Boolean).join('\n').trim()
  if (child.status !== 0 && options.allowFailure !== true) {
    throw new Error(`Supabase CLI falhou (exit ${child.status}): ${sanitizeCliOutput(combined)}`)
  }
  return { status: child.status ?? 1, stdout: child.stdout || '', stderr: child.stderr || '', combined }
}

function runNpmScript(name, extraArgs) {
  const npmCli = process.env.npm_execpath
  if (!npmCli || !existsSync(npmCli)) throw new Error('Execute este reconciliador pelo script npm para habilitar a matriz de prechecks.')
  const child = spawnSync(process.execPath, [npmCli, 'run', name, '--', ...extraArgs], {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  })
  if (child.error) throw child.error
  return {
    status: child.status ?? 1,
    combined: [child.stdout, child.stderr].filter(Boolean).join('\n').trim(),
  }
}

function runGit(gitArgs) {
  const child = spawnSync('git', gitArgs, { cwd: process.cwd(), encoding: 'utf8', shell: false })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`Git falhou: ${sanitizeCliOutput(child.stderr || child.stdout)}`)
  return child.stdout
}

function connectionArgs(mode, dbUrl) {
  return mode === 'linked' ? ['--linked'] : ['--db-url', dbUrl]
}

function assertNoPendingMigrations(output) {
  const normalized = output.toLowerCase()
  const cleanSignals = ['remote database is up to date', 'database is up to date', 'no migrations to push']
  if (!cleanSignals.some((signal) => normalized.includes(signal))) {
    throw new Error(`db push --dry-run nao comprovou zero migrations pendentes: ${sanitizeCliOutput(output)}`)
  }
}

function parseBatchSize(value) {
  const batchSize = value === undefined ? DEFAULT_BATCH_SIZE : Number(value)
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size deve ser inteiro entre 1 e ${MAX_BATCH_SIZE}.`)
  }
  return batchSize
}

function confirmationToken(projectRef, count) {
  return `REPAIR_MIGRATION_HISTORY_HOMOLOG_${projectRef}_${count}`
}

function sanitizeCliOutput(value) {
  return sanitizeError(value)
    .replace(/(password|service_role|access_token)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/\u001b\[[0-9;]*m/g, '')
}

function stableJson(value) {
  return JSON.stringify(value)
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function printPlanSummary(plan) {
  console.log('\nBW Antecipa - P2.6.2 Migration History')
  console.log(`Ambiente/projeto: ${plan.environment}/${plan.project_ref}`)
  console.log(`Branch: ${plan.branch}`)
  console.log(`Conexao CLI: ${plan.connection_mode}`)
  console.log(`Local: ${plan.migration_count_local}`)
  console.log(`Remoto: ${plan.migration_count_remote}`)
  console.log(`Ausentes no remoto: ${plan.migration_count_missing_remote}`)
  console.log(`Somente remotas: ${plan.migration_count_remote_only}`)
  console.log(`Primeira ausente: ${plan.first_missing || 'nenhuma'}`)
  console.log(`Ultima ausente: ${plan.last_missing || 'nenhuma'}`)
}

function helpText() {
  return [
    'Uso (dry-run):',
    `  npm run homolog:financeiro:migrations:reconcile-history -- --expected-project-ref ${AUTHORIZED_PROJECT_REF}`,
    '',
    'Uso (execucao, somente apos copiar a confirmacao calculada pelo dry-run):',
    `  npm run homolog:financeiro:migrations:reconcile-history -- --execute --expected-project-ref ${AUTHORIZED_PROJECT_REF} --confirm <TOKEN_EXATO>`,
    '',
    'Opcoes:',
    '  --connection-mode auto|linked|db-url  auto usa linked apenas quando link e token estao presentes',
    `  --batch-size 1..${MAX_BATCH_SIZE}            padrao ${DEFAULT_BATCH_SIZE}`,
    '',
    'O script nunca executa SQL de migration e nunca aceita producao.',
  ].join('\n')
}
