import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REPORT_DIR,
  SNAPSHOT_DIR,
  REPOSITORY_ROOT,
  assertLocalTarget,
  ensureRuntimeDirectories,
  fileSha256,
  formatError,
  localPgConfig,
  run,
  sha256,
  withPgClient,
  writeJson,
} from '../scripts/lib.mjs'

const EXPECTED = Object.freeze({
  cedentes: 12,
  operacoes: 46,
  notas_fiscais: 910,
  documentos: 123,
  storage_objects: 1644,
  auth_users: 23,
  profiles: 23,
  operacoes_fromtis_legado: 26,
})

const REQUIRED_ARTIFACTS = Object.freeze([
  'production-public.dump',
  'production-storage-metadata.sql',
  'production-migration-history.sql',
  'production-auth-sanitized.sql',
])

const BASELINE_PATH = path.join(REPORT_DIR, 'baseline-current.json')
const REPORT_PATH = path.join(REPORT_DIR, 'P4_7_ROLLBACK_DRILL.json')
const BASELINE_SCRIPT = path.join(REPOSITORY_ROOT, 'rehearsal', 'scripts', 'baseline-local.mjs')
const RESTORE_SCRIPT = path.join(REPOSITORY_ROOT, 'rehearsal', 'scripts', 'restore-local.mjs')

function localAdminPgConfig() {
  const config = localPgConfig()
  return { ...config, user: 'supabase_admin' }
}

function elapsedSeconds(start) {
  return Number(((performance.now() - start) / 1000).toFixed(3))
}

export function assertExpectedCounts(counts) {
  const mismatches = Object.entries(EXPECTED).flatMap(([key, expected]) => {
    const actual = counts?.[key]
    return Number(actual) === expected ? [] : [{ metric: key, expected, actual }]
  })
  if (mismatches.length) throw new Error(`Invariantes de volume divergentes: ${mismatches.map(({ metric }) => metric).join(', ')}.`)
  return true
}

function readBaseline() {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  assertExpectedCounts(baseline.counts)
  if (baseline.divergences?.length) throw new Error('Baseline local possui divergencias conhecidas.')
  return baseline
}

function runBaseline() {
  run(process.execPath, [BASELINE_SCRIPT])
  return readBaseline()
}

export function verifyCloneBase() {
  const manifestPath = path.join(SNAPSHOT_DIR, 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error('Manifesto do clone-base ausente.')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  for (const artifact of REQUIRED_ARTIFACTS) {
    const artifactPath = path.join(SNAPSHOT_DIR, artifact)
    if (!fs.existsSync(artifactPath)) throw new Error(`Artefato do clone-base ausente: ${artifact}.`)
    if (manifest.artifacts?.[artifact] !== fileSha256(artifactPath)) throw new Error(`Checksum divergente: ${artifact}.`)
  }
  return {
    generated_at: manifest.generated_at,
    manifest_sha256: fileSha256(manifestPath),
    artifacts: REQUIRED_ARTIFACTS.map((file) => ({ file, sha256: manifest.artifacts[file] })),
  }
}

async function criticalState() {
  return withPgClient(localPgConfig(), async (client) => {
    const counts = (await client.query(`select jsonb_build_object(
      'cedentes',(select count(*) from public.cedentes),
      'operacoes',(select count(*) from public.operacoes),
      'notas_fiscais',(select count(*) from public.notas_fiscais),
      'documentos',(select count(*) from public.documentos),
      'storage_objects',(select count(*) from storage.objects),
      'auth_users',(select count(*) from auth.users),
      'profiles',(select count(*) from public.profiles),
      'operacoes_fromtis_legado',(select count(*) from public.operacoes where remessa_fromtis_id is not null or remessa_fromtis_retorno is not null)
    ) as value`)).rows[0].value
    const integrity = (await client.query(`select jsonb_build_object(
      'operacoes_sem_cedente',(select count(*) from public.operacoes o left join public.cedentes c on c.id=o.cedente_id where c.id is null),
      'nfs_sem_cedente',(select count(*) from public.notas_fiscais n left join public.cedentes c on c.id=n.cedente_id where c.id is null),
      'documentos_com_cedente_orfao',(select count(*) from public.documentos d left join public.cedentes c on c.id=d.cedente_id where d.cedente_id is not null and c.id is null),
      'operacoes_nfs_com_operacao_orfa',(select count(*) from public.operacoes_nfs x left join public.operacoes o on o.id=x.operacao_id where o.id is null),
      'operacoes_nfs_com_nf_orfa',(select count(*) from public.operacoes_nfs x left join public.notas_fiscais n on n.id=x.nota_fiscal_id where n.id is null),
      'auth_sem_profile',(select count(*) from auth.users u left join public.profiles p on p.id=u.id where u.deleted_at is null and p.id is null),
      'profile_sem_auth',(select count(*) from public.profiles p left join auth.users u on u.id=p.id where u.id is null),
      'cedente_cnpj_duplicado',(select count(*) from (select regexp_replace(cnpj,'[^0-9]','','g') from public.cedentes group by 1 having count(*)>1) d)
    ) as value`)).rows[0].value
    assertExpectedCounts(counts)
    const failures = Object.entries(integrity).filter(([, value]) => Number(value) !== 0)
    if (failures.length) throw new Error(`Orfaos criticos detectados: ${failures.map(([key]) => key).join(', ')}.`)
    return { counts, integrity }
  })
}

async function applySyntheticMutation(correlationId) {
  return withPgClient(localAdminPgConfig(), async (client) => {
    await client.query('begin')
    try {
      const before = (await client.query('select id, to_jsonb(f)::text as value from public.fundos f order by id limit 1')).rows[0]
      if (!before) throw new Error('Fundo local para mutacao sintetica nao encontrado.')
      await client.query('create table public.p47_rollback_drill_marker(id integer primary key, correlation_id text not null, created_at timestamptz not null default clock_timestamp())')
      await client.query('insert into public.p47_rollback_drill_marker(id,correlation_id) values(1,$1)', [correlationId])
      await client.query("update public.fundos set nome=nome || ' [P4.7 DRILL]' where id=$1", [before.id])
      const after = (await client.query('select to_jsonb(f)::text as value from public.fundos f where id=$1', [before.id])).rows[0]
      await client.query('commit')
      return { fundo_id: before.id, before_sha256: sha256(before.value), mutated_sha256: sha256(after.value) }
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
}

async function assertMutationPresent() {
  return withPgClient(localPgConfig(), async (client) => {
    const result = await client.query("select to_regclass('public.p47_rollback_drill_marker') is not null as marker_exists")
    if (!result.rows[0].marker_exists) throw new Error('Mutacao sintetica nao foi persistida no clone local.')
  })
}

async function assertRestored(mutation) {
  return withPgClient(localPgConfig(), async (client) => {
    const marker = await client.query("select to_regclass('public.p47_rollback_drill_marker') is null as removed")
    if (!marker.rows[0].removed) throw new Error('Marcador sintetico permaneceu depois do restore.')
    const row = (await client.query('select to_jsonb(f)::text as value from public.fundos f where id=$1', [mutation.fundo_id])).rows[0]
    if (!row || sha256(row.value) !== mutation.before_sha256) throw new Error('Registro sintetico alterado nao retornou ao estado original.')
  })
}

async function main() {
  assertLocalTarget()
  ensureRuntimeDirectories()
  const correlationId = crypto.randomUUID()
  const startedAt = new Date().toISOString()
  const totalStarted = performance.now()
  const cloneBase = verifyCloneBase()
  const baselineBefore = runBaseline()
  const criticalBefore = await criticalState()
  let mutation
  let restoreCompleted = false
  let restoreSeconds = null

  try {
    mutation = await applySyntheticMutation(correlationId)
    if (mutation.before_sha256 === mutation.mutated_sha256) throw new Error('Mutacao sintetica nao alterou o registro de controle.')
    await assertMutationPresent()
    const baselineMutated = runBaseline()
    if (baselineMutated.deterministic_hash === baselineBefore.deterministic_hash) throw new Error('Mutacao sintetica nao alterou o hash do clone.')

    const restoreStarted = performance.now()
    run(process.execPath, [RESTORE_SCRIPT])
    restoreSeconds = elapsedSeconds(restoreStarted)
    restoreCompleted = true

    const baselineAfter = runBaseline()
    await assertRestored(mutation)
    const criticalAfter = await criticalState()
    if (baselineAfter.deterministic_hash !== baselineBefore.deterministic_hash) throw new Error('Hash do clone nao retornou ao baseline original.')

    const report = {
      schema_version: 1,
      release: 'P4_7_ROLLBACK_DRILL',
      status: 'PASS',
      target: 'local-only',
      correlation_id: correlationId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_seconds: elapsedSeconds(totalStarted),
      restore_seconds: restoreSeconds,
      clone_base: cloneBase,
      baseline: {
        before_sha256: baselineBefore.deterministic_hash,
        mutated_sha256: baselineMutated.deterministic_hash,
        restored_sha256: baselineAfter.deterministic_hash,
      },
      mutation: {
        marker_created: true,
        row_changed: true,
        marker_removed_after_restore: true,
        row_restored: true,
      },
      invariants_before: criticalBefore,
      invariants_after: criticalAfter,
      command_sequence: [
        'validate clone-base checksums',
        'capture local baseline',
        'apply synthetic local-only mutation',
        'restore local clone from snapshot',
        'recalculate baseline and critical invariants',
      ],
    }
    writeJson(REPORT_PATH, report)
    console.log(`P4.7 rollback drill PASS. Restore: ${restoreSeconds}s. Total: ${report.duration_seconds}s.`)
    console.log(`Baseline restaurada: ${baselineAfter.deterministic_hash}`)
  } catch (error) {
    if (mutation && !restoreCompleted) {
      try {
        run(process.execPath, [RESTORE_SCRIPT])
        runBaseline()
        console.error('Compensacao local executada apos falha do drill.')
      } catch (compensationError) {
        console.error(`Compensacao local falhou: ${formatError(compensationError)}`)
      }
    }
    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`P4.7 rollback drill FAIL: ${formatError(error)}`)
    process.exitCode = 1
  })
}
