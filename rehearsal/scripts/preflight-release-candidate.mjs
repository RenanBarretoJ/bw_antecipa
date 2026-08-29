import path from 'node:path'
import {
  REPORT_DIR,
  ensureRuntimeDirectories,
  formatError,
  localPgConfig,
  withPgClient,
  writeJson,
} from './lib.mjs'
import { collectReleaseCandidateInventory } from './release-candidate-inventory.mjs'
import { validateProductionManifest } from './production-manifest.mjs'

const EXPECTED_COUNTS = Object.freeze({ cedentes: 12, operacoes: 46, notas_fiscais: 910, documentos: 123, storage_objects: 1644, auth_users: 23, profiles: 23, fromtis_historico: 26 })

function versionOf(file) {
  return file.match(/^([0-9]+)_/u)?.[1] ?? file.replace(/\.sql$/u, '')
}

export async function runReleaseCandidatePreflight() {
  const manifestResult = validateProductionManifest()
  const inventory = await collectReleaseCandidateInventory()
  const database = await withPgClient(localPgConfig(), async (client) => {
    const counts = await client.query(`
      select jsonb_build_object(
        'cedentes',(select count(*) from public.cedentes),
        'operacoes',(select count(*) from public.operacoes),
        'notas_fiscais',(select count(*) from public.notas_fiscais),
        'documentos',(select count(*) from public.documentos),
        'storage_objects',(select count(*) from storage.objects),
        'auth_users',(select count(*) from auth.users),
        'profiles',(select count(*) from public.profiles),
        'fromtis_historico',(select count(*) from public.operacoes where remessa_fromtis_id is not null or remessa_fromtis_retorno is not null)
      ) as value
    `)
    const versions = await client.query(`select version from supabase_migrations.schema_migrations order by version`)
    return { counts: counts.rows[0].value, versions: new Set(versions.rows.map(({ version }) => version)) }
  })
  const expectedApplied = [
    ...manifestResult.manifest.baseline_existing,
    ...manifestResult.manifest.pre_upgrade_bridges,
    ...manifestResult.manifest.upgrade_order,
  ].map(({ file }) => versionOf(file))
  const missingMigrations = expectedApplied.filter((version) => !database.versions.has(version))
  const countFailures = Object.entries(EXPECTED_COUNTS).flatMap(([metric, expected]) => Number(database.counts[metric]) === expected ? [] : [{ metric, expected, actual: Number(database.counts[metric]) }])
  const configurationBlockers = inventory.funds.flatMap((fund) => {
    const blockers = []
    if (Number(fund.politicas_publicadas) < 1) blockers.push('politica_publicada_ausente')
    if (Number(fund.templates_publicados) < 2) blockers.push('templates_obrigatorios_ausentes')
    if (Number(fund.cnab_publicado) < 1) blockers.push('cnab_publicado_ausente')
    if (Number(fund.integracoes_publicadas) < 1) blockers.push('integracao_publicada_ausente')
    return blockers.map((blocker) => ({ fundo_id: fund.id, blocker }))
  })
  const cedenteBlockers = inventory.cedentes_sem_fundo
    .filter(({ decisao }) => decisao === 'DECISAO_OPERACIONAL_PENDENTE')
    .map(({ id }) => ({ cedente_id: id, blocker: 'decisao_fundo_pendente' }))
  return {
    generated_at: new Date().toISOString(),
    environment: 'rehearsal/local',
    production_access: 'none',
    production_manifest_hash: manifestResult.manifest_hash,
    counts: database.counts,
    missing_migrations: missingMigrations,
    hard_failures: [...countFailures, ...missingMigrations.map((version) => ({ migration_version: version }))],
    operational_blockers: [...configurationBlockers, ...cedenteBlockers],
    migrations_ready: missingMigrations.length === 0,
    historical_baseline_ready: countFailures.length === 0,
    cutover_ready: missingMigrations.length === 0 && countFailures.length === 0 && configurationBlockers.length === 0 && cedenteBlockers.length === 0,
  }
}

async function main() {
  ensureRuntimeDirectories()
  const outputArgument = process.argv.find((argument) => argument.startsWith('--output='))
  const output = path.join(REPORT_DIR, path.basename(outputArgument?.slice('--output='.length) || 'P3_PREFLIGHT.json'))
  const allowOperationalBlockers = process.argv.includes('--allow-operational-blockers')
  const report = await runReleaseCandidatePreflight()
  writeJson(output, report)
  console.log(`Manifesto aplicado integralmente: ${report.migrations_ready ? 'sim' : 'nao'}`)
  console.log(`Baseline historico: ${report.historical_baseline_ready ? 'preservado' : 'divergente'}`)
  console.log(`Bloqueios operacionais: ${report.operational_blockers.length}`)
  if (report.hard_failures.length > 0 || (!allowOperationalBlockers && report.operational_blockers.length > 0)) process.exitCode = 2
}

main().catch((error) => {
  console.error(`Preflight P3 falhou: ${formatError(error)}`)
  process.exitCode = 1
})
