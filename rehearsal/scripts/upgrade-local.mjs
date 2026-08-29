import fs from 'node:fs'
import path from 'node:path'
import {
  REPORT_DIR,
  REPOSITORY_ROOT,
  TMP_DIR,
  assertLocalTarget,
  formatError,
  localPgConfig,
  run,
  withPgClient,
  writeJson,
} from './lib.mjs'
import { validateProductionManifest } from './production-manifest.mjs'

const LOCAL_DB_CONTAINER = 'supabase_db_bw-antecipa-prod-rehearsal'
const CONTAINER_MIGRATION = '/tmp/bw-antecipa-upgrade-migration.sql'
const MIGRATIONS_DIR = path.join(REPOSITORY_ROOT, 'supabase', 'migrations')
const OMIT_P5_2_FORWARD_FOR_CONTAMINATION = process.argv.includes('--omit-p5-2-forward-for-contamination-rehearsal')
const P5_2_FORWARD_FILE = '20260829170408_p5_2_neutralizar_resets_homolog_producao.sql'
const BASELINE_EXPECTED = Object.freeze({
  cedentes: 12,
  operacoes: 46,
  notas_fiscais: 910,
  documentos: 123,
  storage_objects: 1644,
  auth_users: 23,
  profiles: 23,
  operacoes_fromtis_legado: 26,
})
function migrationVersion(fileName) {
  const match = fileName.match(/^([0-9]+)_/u)
  if (!match) throw new Error(`Migration sem versao numerica: ${fileName}.`)
  return match[1]
}

function migrationName(fileName) {
  return fileName.replace(/^[0-9]+_/u, '').replace(/\.sql$/u, '')
}

function parseFailure(error) {
  const message = formatError(error)
  return {
    sqlstate: message.match(/ERROR:\s+([0-9A-Z]{5}):/u)?.[1] ?? null,
    message,
    object: message.match(/(?:relation|function|column|constraint) ["']?([^"'\s]+)["']?/iu)?.[1] ?? null,
  }
}

async function readCoreCounts(client) {
  const result = await client.query(`
    select jsonb_build_object(
      'cedentes', (select count(*) from public.cedentes),
      'operacoes', (select count(*) from public.operacoes),
      'notas_fiscais', (select count(*) from public.notas_fiscais),
      'documentos', (select count(*) from public.documentos),
      'storage_objects', (select count(*) from storage.objects),
      'auth_users', (select count(*) from auth.users),
      'profiles', (select count(*) from public.profiles),
      'operacoes_fromtis_legado', (
        select count(*) from public.operacoes
        where remessa_fromtis_id is not null or remessa_fromtis_retorno is not null
      )
    ) as counts
  `)
  return result.rows[0].counts
}

function assertBaselineCounts(counts) {
  const divergences = Object.entries(BASELINE_EXPECTED).flatMap(([metric, expected]) => {
    const actual = Number(counts[metric])
    return actual === expected ? [] : [{ metric, expected, actual }]
  })
  if (divergences.length > 0) throw new Error(`Baseline divergente: ${JSON.stringify(divergences)}.`)
}

async function appliedVersions(client) {
  const result = await client.query('select version from supabase_migrations.schema_migrations order by version')
  return new Set(result.rows.map((row) => row.version))
}

function applyMigrationFile(filePath) {
  // O Dashboard/Management API envia SQL normalizado em LF. Reproduzir esse
  // transporte evita falso negativo em migrations que comparam trechos de
  // pg_get_functiondef e receberam o arquivo CRLF do checkout Windows.
  const normalizedPath = path.join(TMP_DIR, 'upgrade-migration-lf.sql')
  fs.mkdirSync(TMP_DIR, { recursive: true })
  fs.writeFileSync(normalizedPath, fs.readFileSync(filePath, 'utf8').replace(/\r\n?/gu, '\n'), 'utf8')
  run('docker', ['cp', normalizedPath, `${LOCAL_DB_CONTAINER}:${CONTAINER_MIGRATION}`])
  try {
    run('docker', [
      'exec', LOCAL_DB_CONTAINER,
      'psql',
      '--username=supabase_admin',
      '--dbname=postgres',
      '--set=ON_ERROR_STOP=1',
      '--set=VERBOSITY=verbose',
      '--single-transaction',
      '--command', 'SET search_path = "$user", public, extensions',
      '--file', CONTAINER_MIGRATION,
    ])
  } finally {
    run('docker', ['exec', LOCAL_DB_CONTAINER, 'rm', '-f', CONTAINER_MIGRATION])
    fs.rmSync(normalizedPath, { force: true })
  }
}

async function recordMigration(client, fileName) {
  const version = migrationVersion(fileName)
  const name = migrationName(fileName)
  if (!/^[0-9]+$/u.test(version) || !/^[a-zA-Z0-9_]+$/u.test(name)) throw new Error('Nome de migration inseguro.')
  await client.query(`
    insert into supabase_migrations.schema_migrations(version, statements, name)
    values ($1, array[]::text[], $2)
    on conflict (version) do nothing
  `, [version, name])
}

async function main() {
  assertLocalTarget()
  const { manifest, manifest_hash: manifestHash } = validateProductionManifest()
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  const baselinePath = path.join(REPORT_DIR, 'baseline-current.json')
  if (!fs.existsSync(baselinePath)) throw new Error('Baseline local ausente. Execute rehearsal:verify-determinism.')
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  if (baseline.divergences?.length !== 0) throw new Error('Baseline local possui divergencias e nao pode ser migrado.')
  fs.copyFileSync(baselinePath, path.join(REPORT_DIR, 'PRE_UPGRADE.json'))

  const clientConfig = localPgConfig()
  const initial = await withPgClient(clientConfig, async (client) => {
    const counts = await readCoreCounts(client)
    assertBaselineCounts(counts)
    return { counts, applied: await appliedVersions(client) }
  })

  const report = {
    started_at: new Date().toISOString(),
    target: 'local-only:127.0.0.1:55322',
    pre_upgrade_hash: baseline.deterministic_hash,
    baseline_counts: initial.counts,
    production_manifest_hash: manifestHash,
    already_applied: [],
    blocked_homolog_only: [],
    omitted_for_contamination_rehearsal: [],
    pre_upgrade_bridges: [],
    applied: [],
    first_failure: null,
  }

  for (const { file: fileName } of manifest.pre_upgrade_bridges) {
    const version = migrationVersion(fileName)
    if (initial.applied.has(version)) continue
    console.log(`Aplicando bridge pre-upgrade ${fileName}...`)
    try {
      applyMigrationFile(path.join(MIGRATIONS_DIR, fileName))
      const counts = await withPgClient(clientConfig, async (client) => {
        await recordMigration(client, fileName)
        const current = await readCoreCounts(client)
        assertBaselineCounts(current)
        return current
      })
      initial.applied.add(version)
      report.pre_upgrade_bridges.push({ file: fileName, version, counts })
    } catch (error) {
      report.first_failure = { file: fileName, version, stage: 'pre_upgrade_bridge', ...parseFailure(error) }
      report.finished_at = new Date().toISOString()
      writeJson(path.join(REPORT_DIR, 'upgrade-attempt-current.json'), report)
      console.error(`Falha na bridge pre-upgrade: ${fileName}`)
      console.error(`SQLSTATE: ${report.first_failure.sqlstate ?? 'nao-capturado'}`)
      console.error(report.first_failure.message)
      process.exitCode = 2
      return
    }
  }

  report.blocked_homolog_only = manifest.blocked_homolog_only.map(({ file, reason }) => ({ file, reason }))

  for (const { file: fileName } of manifest.upgrade_order) {
    if (OMIT_P5_2_FORWARD_FOR_CONTAMINATION && fileName === P5_2_FORWARD_FILE) {
      report.omitted_for_contamination_rehearsal.push(fileName)
      continue
    }
    const version = migrationVersion(fileName)
    if (initial.applied.has(version)) {
      report.already_applied.push(fileName)
      continue
    }
    console.log(`Aplicando ${fileName}...`)
    try {
      applyMigrationFile(path.join(MIGRATIONS_DIR, fileName))
      const counts = await withPgClient(clientConfig, async (client) => {
        await recordMigration(client, fileName)
        const current = await readCoreCounts(client)
        assertBaselineCounts(current)
        return current
      })
      report.applied.push({ file: fileName, version, counts })
    } catch (error) {
      report.first_failure = { file: fileName, version, ...parseFailure(error) }
      report.finished_at = new Date().toISOString()
      writeJson(path.join(REPORT_DIR, 'upgrade-attempt-current.json'), report)
      console.error(`Primeira falha: ${fileName}`)
      console.error(`SQLSTATE: ${report.first_failure.sqlstate ?? 'nao-capturado'}`)
      console.error(report.first_failure.message)
      process.exitCode = 2
      return
    }
  }

  report.finished_at = new Date().toISOString()
  writeJson(path.join(REPORT_DIR, 'upgrade-attempt-current.json'), report)
  console.log(`Cadeia concluida: ${report.applied.length} migrations aplicadas.`)
}

main().catch((error) => {
  console.error(`Upgrade local abortado: ${formatError(error)}`)
  process.exitCode = 1
})
