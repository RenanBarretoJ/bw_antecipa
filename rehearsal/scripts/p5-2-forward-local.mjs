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
  sha256,
  stableJson,
  withPgClient,
  writeJson,
} from './lib.mjs'
import {
  BLOCKED_HOMOLOG_MIGRATIONS,
  P5_2_FORWARD_MIGRATION,
} from './production-manifest.mjs'

const LOCAL_DB_CONTAINER = 'supabase_db_bw-antecipa-prod-rehearsal'
const CONTAINER_MIGRATION = '/tmp/bw-antecipa-p5-2.sql'
const MIGRATIONS_DIR = path.join(REPOSITORY_ROOT, 'supabase', 'migrations')
const P3_1_PATCH = '20260827213304_p3_1_vincular_cedentes_dlz.sql'
const EXPECTED_COUNTS = Object.freeze({
  fundos: 2,
  cedentes: 12,
  operacoes: 46,
  notas_fiscais: 910,
  documentos: 123,
  storage_objects: 1644,
  auth_users: 23,
  profiles: 23,
  fromtis_historico: 26,
})

function argument(name, fallback = null) {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

function migrationVersion(fileName) {
  const match = fileName.match(/^([0-9]+)_/u)
  if (!match) throw new Error(`Migration sem versao numerica: ${fileName}.`)
  return match[1]
}

function migrationName(fileName) {
  return fileName.replace(/^[0-9]+_/u, '').replace(/\.sql$/u, '')
}

function applyMigrationFile(fileName) {
  const filePath = path.join(MIGRATIONS_DIR, fileName)
  if (!fs.existsSync(filePath)) throw new Error(`Migration ausente: ${fileName}.`)
  const normalizedPath = path.join(TMP_DIR, 'p5-2-migration-lf.sql')
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
      '--file', CONTAINER_MIGRATION,
    ])
  } finally {
    run('docker', ['exec', LOCAL_DB_CONTAINER, 'rm', '-f', CONTAINER_MIGRATION])
    fs.rmSync(normalizedPath, { force: true })
  }
}

async function recordMigration(client, fileName) {
  await client.query(`
    insert into supabase_migrations.schema_migrations(version, statements, name)
    values ($1, array[]::text[], $2)
    on conflict (version) do nothing
  `, [migrationVersion(fileName), migrationName(fileName)])
}

async function applyAndRecord(fileName) {
  applyMigrationFile(fileName)
  await withPgClient(localPgConfig(), (client) => recordMigration(client, fileName))
}

async function readState() {
  return withPgClient(localPgConfig(), async (client) => {
    const result = await client.query(`
      with reset_functions as (
        select
          p.oid::regprocedure::text as signature,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname like 'reset_operacional_fundo_homolog%'
      ), integridade as (
        select
          (select count(*) from public.operacoes o
            left join public.cedente_fundos cf on cf.id=o.cedente_fundo_id
           where o.cedente_fundo_id is null or cf.id is null or cf.cedente_id<>o.cedente_id)
          + (select count(*) from public.notas_fiscais n
            left join public.cedente_fundos cf on cf.id=n.cedente_fundo_id
           where n.cedente_fundo_id is null or n.fundo_id is null or cf.id is null
              or cf.cedente_id<>n.cedente_id or cf.fundo_id<>n.fundo_id)
          + (select count(*) from public.operacoes_nfs x
            left join public.operacoes o on o.id=x.operacao_id
            left join public.notas_fiscais n on n.id=x.nota_fiscal_id
           where o.id is null or n.id is null)
          + (select count(*) from auth.users u
            left join public.profiles p on p.id=u.id
           where u.deleted_at is null and p.id is null)
          + (select count(*) from public.profiles p
            left join auth.users u on u.id=p.id where u.id is null)
          + (select count(*) from pg_constraint c
            join pg_namespace n on n.oid=c.connamespace
           where n.nspname='public' and c.contype='f' and not c.convalidated)
          as total
      )
      select jsonb_build_object(
        'migration_count', (select count(*) from supabase_migrations.schema_migrations),
        'blocked_history_count', (
          select count(*) from supabase_migrations.schema_migrations
          where version = any($1::text[])
        ),
        'p3_1_present', exists(
          select 1 from supabase_migrations.schema_migrations where version=$2
        ),
        'p5_2_present', exists(
          select 1 from supabase_migrations.schema_migrations where version=$3
        ),
        'reset_functions', coalesce((select jsonb_agg(to_jsonb(r) order by signature) from reset_functions r), '[]'::jsonb),
        'counts', jsonb_build_object(
          'fundos', (select count(*) from public.fundos),
          'cedentes', (select count(*) from public.cedentes),
          'operacoes', (select count(*) from public.operacoes),
          'notas_fiscais', (select count(*) from public.notas_fiscais),
          'documentos', (select count(*) from public.documentos),
          'storage_objects', (select count(*) from storage.objects),
          'auth_users', (select count(*) from auth.users),
          'profiles', (select count(*) from public.profiles),
          'fromtis_historico', (
            select count(*) from public.operacoes
            where remessa_fromtis_id is not null or remessa_fromtis_retorno is not null
          )
        ),
        'integrity_failures', (select total from integridade),
        'dlz_readiness', case when
          exists(select 1 from public.fundos where id='7a114257-7816-468e-adf4-d796b93364df'::uuid and ativo is true)
          and (select count(distinct cedente_id) from public.cedente_fundos where fundo_id='7a114257-7816-468e-adf4-d796b93364df'::uuid and status='ativo')=12
          and exists(select 1 from public.politica_operacional_versoes where id='d1311000-0000-4000-8000-000000000002'::uuid and status='publicada')
          and exists(select 1 from public.configuracao_cnab_versoes where id='d1312000-0000-4000-8000-000000000002'::uuid and status='publicada')
          and exists(select 1 from public.integracao_fundo_versoes where id='d1313000-0000-4000-8000-000000000002'::uuid and status='publicada')
          then 'READY' else 'NOT_READY' end
      ) as state
    `, [
      BLOCKED_HOMOLOG_MIGRATIONS.map(({ file }) => migrationVersion(file)),
      migrationVersion(P3_1_PATCH),
      migrationVersion(P5_2_FORWARD_MIGRATION),
    ])
    return result.rows[0].state
  })
}

function assertCounts(state) {
  const differences = Object.entries(EXPECTED_COUNTS).filter(
    ([key, expected]) => Number(state.counts[key]) !== expected,
  )
  if (differences.length > 0) throw new Error(`Contagens divergentes: ${JSON.stringify(differences)}.`)
  if (Number(state.integrity_failures) !== 0) throw new Error(`Integridade divergente: ${state.integrity_failures} falhas.`)
}

async function contaminate() {
  const initial = await readState()
  assertCounts(initial)
  if (Number(initial.migration_count) !== 192) {
    throw new Error(`Clone pre-contaminacao deve possuir 192 migrations; atual=${initial.migration_count}.`)
  }

  for (const { file } of BLOCKED_HOMOLOG_MIGRATIONS) await applyAndRecord(file)
  await applyAndRecord(P3_1_PATCH)

  const contaminated = await readState()
  assertCounts(contaminated)
  if (Number(contaminated.migration_count) !== 198 || Number(contaminated.blocked_history_count) !== 5 || !contaminated.p3_1_present) {
    throw new Error(`Estado contaminado incompleto: ${JSON.stringify(contaminated)}.`)
  }
  if (contaminated.reset_functions.length === 0 || !contaminated.reset_functions.some((item) => item.service_role_execute)) {
    throw new Error('Estado contaminado nao reproduziu a RPC executavel por service_role.')
  }
  console.log('Estado contaminado reproduzido: 198 migrations e reset de homologacao ativo.')
}

async function neutralize(cycle) {
  const before = await readState()
  assertCounts(before)
  if (Number(before.migration_count) !== 198 || before.dlz_readiness !== 'READY') {
    throw new Error(`Pre-condicao da forward invalida: ${JSON.stringify(before)}.`)
  }

  await applyAndRecord(P5_2_FORWARD_MIGRATION)
  const afterFirst = await readState()
  assertCounts(afterFirst)
  if (Number(afterFirst.migration_count) !== 199 || afterFirst.reset_functions.length !== 0 || !afterFirst.p5_2_present) {
    throw new Error(`Neutralizacao incompleta: ${JSON.stringify(afterFirst)}.`)
  }

  applyMigrationFile(P5_2_FORWARD_MIGRATION)
  const afterSecond = await readState()
  assertCounts(afterSecond)
  if (stableJson(afterSecond) !== stableJson(afterFirst)) {
    throw new Error('Segunda aplicacao da forward alterou o estado semantico.')
  }

  const report = {
    generated_at: new Date().toISOString(),
    environment: 'rehearsal/local-only',
    cycle,
    before,
    after_first_application: afterFirst,
    after_idempotency_application: afterSecond,
    deterministic_state_hash: sha256(stableJson(afterSecond)),
    result: 'PASS',
  }
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  writeJson(path.join(REPORT_DIR, `P5_2_FORWARD_REHEARSAL_CYCLE_${cycle}.json`), report)
  console.log(`P5.2 ciclo ${cycle}: PASS (${report.deterministic_state_hash}).`)
}

async function main() {
  assertLocalTarget()
  const stage = argument('stage')
  const cycle = argument('cycle', '1')
  if (stage === 'contaminate') return contaminate()
  if (stage === 'neutralize') return neutralize(cycle)
  throw new Error('Use --stage=contaminate ou --stage=neutralize.')
}

main().catch((error) => {
  console.error(`Rehearsal P5.2 abortado: ${formatError(error)}`)
  process.exitCode = 1
})
