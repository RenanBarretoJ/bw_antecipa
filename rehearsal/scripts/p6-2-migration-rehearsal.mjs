import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REPORT_DIR,
  REPOSITORY_ROOT,
  ensureRuntimeDirectories,
  formatError,
  localPgConfig,
  runPgTool,
  sha256,
  stableJson,
  withPgClient,
  writeJson,
} from './lib.mjs'

const MIGRATION_VERSION = '20260914135436'
const MIGRATION_NAME = 'p6_1_expirar_convites_novo_cedente_antes_retry'
const MIGRATION_FILE = `${MIGRATION_VERSION}_${MIGRATION_NAME}.sql`
const RUN = process.argv.find((argument) => argument.startsWith('--run='))?.split('=')[1] ?? 'manual'

function hashRows(rows) {
  return sha256(stableJson(rows))
}

async function queryRows(client, query) {
  return (await client.query(query)).rows
}

async function collectProtectedState(client) {
  const cedentes = await queryRows(client, 'select id::text, status::text from public.cedentes order by id::text')
  const cedenteFundos = await queryRows(client, 'select id::text, cedente_id::text, fundo_id::text, status::text from public.cedente_fundos order by id::text')
  const usuarioFundos = await queryRows(client, 'select id::text, usuario_id::text, fundo_id::text, status::text from public.usuario_fundos order by id::text')
  const profiles = await queryRows(client, 'select id::text, role::text, status::text from public.profiles order by id::text')
  const authUsers = await queryRows(client, 'select id::text, deleted_at is not null as deleted from auth.users order by id::text')
  const convites = await queryRows(client, `
    select id::text, fundo_id::text, cedente_id::text, status::text,
           created_at::text, expires_at::text, expirado_em::text
    from public.cedente_usuario_convites
    order by id::text
  `)
  const constraints = await queryRows(client, `
    select conrelid::regclass::text as table_name, conname, convalidated
    from pg_constraint
    where contype = 'f' and connamespace in ('public'::regnamespace, 'private'::regnamespace)
    order by conrelid::regclass::text, conname
  `)

  return {
    counts: {
      cedentes: cedentes.length,
      cedente_fundos: cedenteFundos.length,
      usuario_fundos: usuarioFundos.length,
      profiles: profiles.length,
      auth_users: authUsers.length,
      convites: convites.length,
    },
    hashes: {
      cedentes: hashRows(cedentes),
      cedente_fundos: hashRows(cedenteFundos),
      usuario_fundos: hashRows(usuarioFundos),
      profiles: hashRows(profiles),
      auth_users: hashRows(authUsers),
      convites: hashRows(convites),
      foreign_keys: hashRows(constraints),
    },
    invalid_foreign_keys: constraints.filter((constraint) => !constraint.convalidated).length,
  }
}

function validCnpj(seed) {
  const base = `98${String(seed).padStart(10, '0')}`.slice(0, 12)
  const digit = (value, weights) => {
    const sum = value.split('').reduce((total, character, index) => total + Number(character) * weights[index], 0)
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }
  const first = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const second = digit(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base}${first}${second}`
}

async function validateLifecycle(client) {
  await client.query('begin')
  try {
    const context = await client.query(`
      select p.id as usuario_id, uf.fundo_id
      from public.profiles p
      join public.usuario_fundos uf on uf.usuario_id = p.id and uf.status::text = 'ativo'
      join public.fundos f on f.id = uf.fundo_id and f.ativo is true
      where p.role::text = 'gestor' and p.status::text = 'ativo'
      order by p.id, uf.fundo_id
      limit 1
    `)
    if (context.rowCount !== 1) throw new Error('Clone sem Gestor ativo autorizado a um fundo ativo.')

    const { usuario_id: usuarioId, fundo_id: fundoId } = context.rows[0]
    const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const cnpj = validCnpj(unique.slice(-10))
    const email = `p6-2-rehearsal-${unique}@qa-bw.invalid`
    const tokenHash = createHash('sha256').update(randomUUID()).digest('hex')
    const expiredId = randomUUID()
    const correlationId = randomUUID()

    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [usuarioId])
    await client.query(`
      insert into public.cedente_usuario_convites (
        id, tipo, fundo_id, cnpj_normalizado, email_normalizado, perfil,
        token_hash, status, convidado_por, created_at, expires_at
      ) values ($1, 'NOVO_CEDENTE', $2, $3, $4, 'ADMIN', $5, 'PENDENTE', $6,
                now() - interval '2 hours', now() - interval '1 hour')
    `, [expiredId, fundoId, cnpj, email, tokenHash, usuarioId])

    const retry = await client.query(`
      select public.criar_convite_novo_cedente($1, $2, $3, $4, $5) as result
    `, [fundoId, cnpj, email, createHash('sha256').update(`${tokenHash}:retry`).digest('hex'), correlationId])
    const newInviteId = retry.rows[0]?.result?.convite_id
    if (!newInviteId) throw new Error('A funcao nao retornou o novo convite do retry.')

    const lifecycle = await client.query(`
      select id::text, status::text
      from public.cedente_usuario_convites
      where id = any($1::uuid[])
      order by status::text, id::text
    `, [[expiredId, newInviteId]])
    const statuses = lifecycle.rows.map((row) => row.status).sort()
    if (stableJson(statuses) !== stableJson(['EXPIRADO', 'PENDENTE'])) {
      throw new Error(`Lifecycle inesperado: ${statuses.join(', ')}.`)
    }

    const audit = await client.query(`
      select count(*)::integer as total
      from public.logs_auditoria
      where entidade_id = $1 and tipo_evento = 'CONVITE_NOVO_CEDENTE_EXPIRADO'
    `, [expiredId])
    if (audit.rows[0].total !== 1) throw new Error('Expiracao do convite nao gerou auditoria unica.')

    return { expired_preserved: true, retry_created: true, audit_recorded: true }
  } finally {
    await client.query('rollback')
  }
}

async function main() {
  ensureRuntimeDirectories()
  const migrationPath = path.join(REPOSITORY_ROOT, 'supabase', 'migrations', MIGRATION_FILE)
  if (!fs.existsSync(migrationPath)) throw new Error(`Migration ausente: ${MIGRATION_FILE}.`)

  const local = localPgConfig()
  const localAdmin = { ...local, user: 'supabase_admin' }
  const before = await withPgClient(localAdmin, collectProtectedState)
  runPgTool('psql', ['--set=ON_ERROR_STOP=1', `--file=/output/${MIGRATION_FILE}`], {
    connection: localAdmin,
    outputDirectory: path.dirname(migrationPath),
  })

  await withPgClient(localAdmin, async (client) => {
    await client.query(`
      insert into supabase_migrations.schema_migrations(version, statements, name)
      values ($1, array[]::text[], $2)
      on conflict (version) do nothing
    `, [MIGRATION_VERSION, MIGRATION_NAME])
  })

  const validation = await withPgClient(localAdmin, async (client) => {
    const migration = await client.query(
      'select count(*)::integer as total from supabase_migrations.schema_migrations where version = $1',
      [MIGRATION_VERSION],
    )
    const definition = await client.query(`
      select pg_get_functiondef('public.criar_convite_novo_cedente(uuid,text,text,text,uuid)'::regprocedure) as definition
    `)
    return {
      migration_registered: migration.rows[0].total === 1,
      function_sha256: sha256(definition.rows[0].definition),
      lifecycle: await validateLifecycle(client),
    }
  })

  const after = await withPgClient(localAdmin, collectProtectedState)
  const protectedDataPreserved = stableJson(before) === stableJson(after)
  if (!protectedDataPreserved) throw new Error('A migration alterou dados protegidos ou constraints do clone.')
  if (!validation.migration_registered) throw new Error('A migration nao foi registrada no clone.')

  const deterministic = {
    migration: MIGRATION_VERSION,
    before,
    after,
    validation,
    protected_data_preserved: protectedDataPreserved,
  }
  const report = {
    generated_at: new Date().toISOString(),
    run: RUN,
    ...deterministic,
    deterministic_hash: sha256(stableJson(deterministic)),
    status: 'PASS',
  }
  const output = path.join(REPORT_DIR, `p6-2-migration-rehearsal-${RUN}.json`)
  writeJson(output, report)
  console.log(`P6.1 migration rehearsal ${RUN}: PASS`)
  console.log(`Hash deterministico: ${report.deterministic_hash}`)
  console.log(`Dados protegidos preservados: ${protectedDataPreserved ? 'sim' : 'nao'}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Rehearsal P6.2 abortado: ${formatError(error)}`)
    process.exitCode = 1
  })
}
