import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REPORT_DIR,
  ensureRuntimeDirectories,
  formatError,
  localPgConfig,
  sha256,
  stableJson,
  withPgClient,
  writeJson,
} from './lib.mjs'

const CORE_EXPECTED = Object.freeze({
  fundos: 2,
  cedentes: 12,
  profiles: 23,
  auth_users: 23,
  operacoes: 46,
  notas_fiscais: 910,
  documentos: 123,
  storage_objects: 1644,
  operacoes_fromtis_legado: 26,
})

async function orderedHash(client, sql) {
  const result = await client.query(sql)
  return sha256(result.rows.map((row) => row.value).join('\n'))
}

async function setAuthenticatedIdentity(client, userId) {
  await client.query('set local role authenticated')
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
  await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)")
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({
    sub: userId,
    role: 'authenticated',
    aal: 'aal2',
  })])
}

async function rollbackTest(client, callback) {
  await client.query('begin')
  try {
    return await callback()
  } finally {
    await client.query('rollback').catch(() => undefined)
  }
}

async function testRlsRuntime() {
  const config = { ...localPgConfig(), user: 'supabase_admin' }
  return withPgClient(config, async (client) => {
    const gestorFixture = await client.query(`
      select
        uf.usuario_id::text,
        (array_agg(uf.fundo_id order by coalesce(uf.principal, false) desc, uf.fundo_id))[1]::text as fundo_mantido,
        (array_agg(uf.fundo_id order by coalesce(uf.principal, false) desc, uf.fundo_id))[2]::text as fundo_removido
      from public.usuario_fundos uf
      where uf.status = 'ativo'
      group by uf.usuario_id
      having count(distinct uf.fundo_id) >= 2
      order by uf.usuario_id
      limit 1
    `)
    const ownerFixture = await client.query(`
      select c.user_id::text as usuario_id, c.id::text as cedente_id
      from public.cedentes c
      where c.user_id is not null
      order by c.id
      limit 1
    `)
    const adminFixture = await client.query(`
      select ca.user_id::text as usuario_id, ca.cedente_id::text
      from public.cedente_acessos ca
      join public.cedentes c on c.id = ca.cedente_id
      where ca.perfil = 'ADMIN'
        and ca.status = 'ATIVO'
        and ca.ativo is true
        and ca.user_id is distinct from c.user_id
      order by ca.cedente_id, ca.user_id
      limit 1
    `)

    if (!gestorFixture.rows[0] || !ownerFixture.rows[0] || !adminFixture.rows[0]) {
      throw new Error('Fixtures legadas insuficientes para a matriz RLS do rehearsal.')
    }

    const gestor = gestorFixture.rows[0]
    const gestorIsolation = await rollbackTest(client, async () => {
      await client.query(`
        delete from public.usuario_fundos
        where usuario_id = $1 and fundo_id = $2
      `, [gestor.usuario_id, gestor.fundo_removido])
      await setAuthenticatedIdentity(client, gestor.usuario_id)
      const result = await client.query(`
        select
          (select array_agg(id::text order by id::text) from public.fundos) as fundos_visiveis,
          (select array_agg(distinct fundo_id::text order by fundo_id::text) from public.cedente_fundos) as vinculos_visiveis,
          (select array_agg(distinct fundo_id::text order by fundo_id::text) from public.notas_fiscais) as nfs_fundos_visiveis,
          (select count(*)::integer from public.operacoes) as operacoes_visiveis,
          (select count(*)::integer from public.notas_fiscais) as nfs_visiveis
      `)
      return result.rows[0]
    })

    const owner = ownerFixture.rows[0]
    const ownerResolution = await rollbackTest(client, async () => {
      await setAuthenticatedIdentity(client, owner.usuario_id)
      const result = await client.query(`
        select
          public.get_user_cedente_id()::text as cedente_resolvido,
          count(*)::integer as cedentes_visiveis
        from public.cedentes
      `)
      return result.rows[0]
    })

    const admin = adminFixture.rows[0]
    const adminResolution = await rollbackTest(client, async () => {
      await setAuthenticatedIdentity(client, admin.usuario_id)
      const result = await client.query(`
        select
          public.get_user_cedente_id()::text as cedente_resolvido,
          private.usuario_e_admin_cedente($1::uuid) as eh_admin
      `, [admin.cedente_id])
      return result.rows[0]
    })

    const operacionalIsolation = await rollbackTest(client, async () => {
      await client.query(`
        update public.cedente_acessos
        set perfil = 'OPERACIONAL'
        where user_id = $1 and cedente_id = $2
      `, [admin.usuario_id, admin.cedente_id])
      await setAuthenticatedIdentity(client, admin.usuario_id)
      const result = await client.query(`
        select
          public.get_user_cedente_id()::text as cedente_resolvido,
          private.usuario_e_admin_cedente($1::uuid) as eh_admin
      `, [admin.cedente_id])
      return result.rows[0]
    })

    const fundosVisiveis = gestorIsolation.fundos_visiveis ?? []
    const vinculosVisiveis = gestorIsolation.vinculos_visiveis ?? []
    const nfsFundosVisiveis = gestorIsolation.nfs_fundos_visiveis ?? []
    return {
      gestor_um_fundo: {
        fundo_esperado: gestor.fundo_mantido,
        fundos_visiveis: fundosVisiveis,
        vinculos_fundos_visiveis: vinculosVisiveis,
        nfs_fundos_visiveis: nfsFundosVisiveis,
        operacoes_visiveis: gestorIsolation.operacoes_visiveis,
        nfs_visiveis: gestorIsolation.nfs_visiveis,
        isolado: fundosVisiveis.length === 1
          && fundosVisiveis[0] === gestor.fundo_mantido
          && vinculosVisiveis.every((id) => id === gestor.fundo_mantido)
          && nfsFundosVisiveis.every((id) => id === gestor.fundo_mantido),
      },
      owner_legado: {
        esperado: owner.cedente_id,
        resolvido: ownerResolution.cedente_resolvido,
        cedentes_visiveis: ownerResolution.cedentes_visiveis,
        valido: ownerResolution.cedente_resolvido === owner.cedente_id,
      },
      admin_canonico: {
        esperado: admin.cedente_id,
        resolvido: adminResolution.cedente_resolvido,
        eh_admin: adminResolution.eh_admin,
        valido: adminResolution.cedente_resolvido === admin.cedente_id && adminResolution.eh_admin === true,
      },
      operacional: {
        cedente_resolvido: operacionalIsolation.cedente_resolvido,
        eh_admin: operacionalIsolation.eh_admin,
        valido: operacionalIsolation.cedente_resolvido === admin.cedente_id && operacionalIsolation.eh_admin === false,
      },
    }
  })
}

export async function collectPostUpgrade() {
  ensureRuntimeDirectories()
  const baselinePath = path.join(REPORT_DIR, 'PRE_UPGRADE.json')
  if (!fs.existsSync(baselinePath)) throw new Error('Snapshot PRE_UPGRADE ausente.')
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))

  const database = await withPgClient(localPgConfig(), async (client) => {
    const countsResult = await client.query(`
      select jsonb_build_object(
        'fundos', (select count(*)::integer from public.fundos),
        'cedentes', (select count(*)::integer from public.cedentes),
        'profiles', (select count(*)::integer from public.profiles),
        'auth_users', (select count(*)::integer from auth.users),
        'operacoes', (select count(*)::integer from public.operacoes),
        'notas_fiscais', (select count(*)::integer from public.notas_fiscais),
        'documentos', (select count(*)::integer from public.documentos),
        'storage_objects', (select count(*)::integer from storage.objects),
        'operacoes_fromtis_legado', (
          select count(*)::integer from public.operacoes
          where remessa_fromtis_id is not null or remessa_fromtis_retorno is not null
        )
      ) as counts
    `)
    const integrityResult = await client.query(`
      select jsonb_build_object(
        'operacoes_contexto_invalido', (
          select count(*)::integer
          from public.operacoes o
          left join public.cedente_fundos cf on cf.id = o.cedente_fundo_id
          where cf.id is null or cf.cedente_id <> o.cedente_id
        ),
        'nfs_contexto_invalido', (
          select count(*)::integer
          from public.notas_fiscais nf
          left join public.cedente_fundos cf on cf.id = nf.cedente_fundo_id
          where cf.id is null or cf.cedente_id <> nf.cedente_id or cf.fundo_id <> nf.fundo_id
        ),
        'operacoes_nfs_orfas', (
          select count(*)::integer
          from public.operacoes_nfs onf
          left join public.operacoes o on o.id = onf.operacao_id
          left join public.notas_fiscais nf on nf.id = onf.nota_fiscal_id
          where o.id is null or nf.id is null
        ),
        'documentos_sem_storage', (
          select count(*)::integer
          from public.documentos d
          where d.url_arquivo is not null
            and not exists (select 1 from storage.objects so where so.name = d.url_arquivo)
        ),
        'documentos_versao_duplicada', (
          select count(*)::integer from (
            select 1
            from public.documentos
            group by cedente_id, tipo, representante_id, versao
            having count(*) > 1
          ) duplicados
        ),
        'fks_public_nao_validadas', (
          select count(*)::integer
          from pg_constraint c
          join pg_namespace n on n.oid = c.connamespace
          where c.contype = 'f' and n.nspname = 'public' and not c.convalidated
        )
      ) as integrity
    `)
    const backfillResult = await client.query(`
      select jsonb_build_object(
        'cedente_fundos_total', (select count(*)::integer from public.cedente_fundos),
        'cedentes_sem_vinculo', (
          select count(*)::integer from public.cedentes c
          where not exists (select 1 from public.cedente_fundos cf where cf.cedente_id = c.id)
        ),
        'usuario_fundos_total', (select count(*)::integer from public.usuario_fundos),
        'operacoes_contextualizadas', (select count(*)::integer from public.operacoes where cedente_fundo_id is not null),
        'nfs_contextualizadas', (
          select count(*)::integer from public.notas_fiscais
          where cedente_fundo_id is not null and fundo_id is not null
        ),
        'matrizes', (select count(*)::integer from public.cedente_estabelecimentos where tipo = 'matriz'),
        'cedentes_com_matriz', (
          select count(distinct cedente_id)::integer from public.cedente_estabelecimentos where tipo = 'matriz'
        ),
        'acessos_admin', (select count(*)::integer from public.cedente_acessos where perfil = 'ADMIN' and status = 'ATIVO'),
        'acessos_operacional', (select count(*)::integer from public.cedente_acessos where perfil = 'OPERACIONAL' and status = 'ATIVO'),
        'contas_bancarias_estruturadas', (select count(*)::integer from public.cedente_estabelecimento_contas_bancarias),
        'parcelas_nf_legadas', (select count(*)::integer from public.nota_fiscal_parcelas),
        'operacoes_parcelas_legadas', (select count(*)::integer from public.operacoes_nf_parcelas),
        'operacoes_snapshot_politica', (select count(*)::integer from public.operacoes where politica_snapshot is not null),
        'operacoes_contexto_legado', (
          select count(*)::integer from public.operacoes where contexto_configuracao_status like 'legado%'
        ),
        'politicas', (select count(*)::integer from public.politicas_operacionais),
        'templates', (select count(*)::integer from public.templates_documentos),
        'configuracoes_cnab', (select count(*)::integer from public.configuracoes_cnab),
        'integracoes_fundo', (select count(*)::integer from public.integracoes_fundo)
      ) as backfills
    `)
    const migrations = await client.query(`
      select version, coalesce(name, '') as name
      from supabase_migrations.schema_migrations
      order by version
    `)
    const bucketCounts = await client.query(`
      select bucket_id, count(*)::integer as count
      from storage.objects
      group by bucket_id
      order by bucket_id
    `)
    const policies = await client.query(`
      select schemaname, tablename, policyname, permissive, roles::text, cmd,
             coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
      from pg_policies
      where schemaname in ('public', 'storage')
      order by schemaname, tablename, policyname
    `)
    const schemaFingerprint = {
      columns: await orderedHash(client, `
        select concat_ws('|', table_schema, table_name, ordinal_position, column_name,
          data_type, udt_schema, udt_name, is_nullable, coalesce(column_default, '')) as value
        from information_schema.columns
        where table_schema in ('public', 'private')
        order by table_schema, table_name, ordinal_position
      `),
      constraints: await orderedHash(client, `
        select concat_ws('|', n.nspname, c.conrelid::regclass::text, c.conname,
          c.contype, c.convalidated, pg_get_constraintdef(c.oid, true)) as value
        from pg_constraint c
        join pg_namespace n on n.oid = c.connamespace
        where n.nspname in ('public', 'private')
        order by n.nspname, c.conrelid::regclass::text, c.conname
      `),
      indexes: await orderedHash(client, `
        select concat_ws('|', schemaname, tablename, indexname, indexdef) as value
        from pg_indexes
        where schemaname in ('public', 'private')
        order by schemaname, tablename, indexname
      `),
      policies: sha256(stableJson(policies.rows)),
    }
    return {
      counts: countsResult.rows[0].counts,
      integrity: integrityResult.rows[0].integrity,
      backfills: backfillResult.rows[0].backfills,
      migrations: migrations.rows,
      bucket_counts: bucketCounts.rows,
      aggregates: {
        operacao_ids_sha256: await orderedHash(client, 'select id::text as value from public.operacoes order by id::text'),
        nota_fiscal_ids_sha256: await orderedHash(client, 'select id::text as value from public.notas_fiscais order by id::text'),
        documento_ids_sha256: await orderedHash(client, 'select id::text as value from public.documentos order by id::text'),
        profile_ids_sha256: await orderedHash(client, 'select id::text as value from public.profiles order by id::text'),
        auth_user_ids_sha256: await orderedHash(client, 'select id::text as value from auth.users order by id::text'),
        fundo_ids_sha256: await orderedHash(client, 'select id::text as value from public.fundos order by id::text'),
        storage_paths_sha256: await orderedHash(client, `
          select bucket_id || '/' || name as value from storage.objects order by bucket_id, name
        `),
      },
      schema_fingerprint: schemaFingerprint,
      legacy_global_policies: policies.rows.filter((policy) => [
        'Gestores podem gerenciar fundos',
        'Gestores podem ver fundos',
        'Gestores podem gerenciar devedores',
        'Gestores podem ver devedores',
        'taxas_gestor_all',
        'ca_gestor_all',
        'notificacoes_gestor_all',
        'sacados_gestor_all',
        'testemunhas_gestor_all',
      ].includes(policy.policyname)),
    }
  })

  const rlsRuntime = await testRlsRuntime()
  const preservation = {
    counts: Object.entries(CORE_EXPECTED).flatMap(([metric, expected]) => {
      const actual = Number(database.counts[metric])
      return actual === expected ? [] : [{ metric, expected, actual }]
    }),
    identifiers: Object.entries(baseline.aggregates).flatMap(([metric, expected]) => {
      const actual = database.aggregates[metric]
      return actual === expected ? [] : [{ metric, expected, actual }]
    }),
  }
  const integrityFailures = Object.entries(database.integrity)
    .flatMap(([metric, value]) => Number(value) === 0 ? [] : [{ metric, actual: Number(value), expected: 0 }])
  const rlsFailures = [
    ['gestor_um_fundo', rlsRuntime.gestor_um_fundo.isolado],
    ['owner_legado', rlsRuntime.owner_legado.valido],
    ['admin_canonico', rlsRuntime.admin_canonico.valido],
    ['operacional_sem_admin', rlsRuntime.operacional.valido],
  ].flatMap(([metric, valid]) => valid ? [] : [{ metric, valid }])
  if (database.legacy_global_policies.length > 0) {
    rlsFailures.push({ metric: 'policies_gestor_global_legadas', actual: database.legacy_global_policies })
  }

  const cutoverPreconditions = []
  if (Number(database.backfills.cedentes_sem_vinculo) > 0) {
    cutoverPreconditions.push(`${database.backfills.cedentes_sem_vinculo} cedentes sem cedente_fundos; vinculo exige decisao operacional.`)
  }
  if (Number(database.backfills.parcelas_nf_legadas) === 0) {
    cutoverPreconditions.push('NFs legadas nao possuem granularidade de parcelas; nao foi inventado backfill sem nDup/vDup de origem.')
  }
  if (Number(database.backfills.operacoes_snapshot_politica) === 0) {
    cutoverPreconditions.push('Operacoes legadas permanecem sem snapshot inventado e com contexto legado explicitado.')
  }
  if (Number(database.backfills.integracoes_fundo) === 0) {
    cutoverPreconditions.push('Configuracoes versionadas de integracao ausentes; 26 remessas Fromtis legadas foram preservadas.')
  }

  const deterministicPayload = {
    counts: database.counts,
    integrity: database.integrity,
    backfills: database.backfills,
    migrations: database.migrations,
    bucket_counts: database.bucket_counts,
    aggregates: database.aggregates,
    schema_fingerprint: database.schema_fingerprint,
    rls_runtime: rlsRuntime,
    cutover_preconditions: cutoverPreconditions,
  }
  const report = {
    generated_at: new Date().toISOString(),
    environment: 'local-production-rehearsal-post-upgrade',
    production_access: 'read-only-export-only',
    ...database,
    preservation,
    rls_runtime: rlsRuntime,
    cutover_preconditions: cutoverPreconditions,
    hard_failures: [...preservation.counts, ...preservation.identifiers, ...integrityFailures, ...rlsFailures],
    deterministic_hash: sha256(stableJson(deterministicPayload)),
  }
  return report
}

async function main() {
  const outputArgument = process.argv.find((argument) => argument.startsWith('--output='))
  const outputName = outputArgument?.slice('--output='.length) || 'POST_UPGRADE.json'
  const output = path.join(REPORT_DIR, path.basename(outputName))
  const report = await collectPostUpgrade()
  writeJson(output, report)
  console.log(`POST_UPGRADE gerado: ${output}`)
  console.log(`Hash deterministico: ${report.deterministic_hash}`)
  console.log(`Falhas bloqueantes: ${report.hard_failures.length}`)
  console.log(`Pre-condicoes de cutover: ${report.cutover_preconditions.length}`)
  if (report.hard_failures.length > 0) process.exitCode = 2
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(`POST_UPGRADE abortado: ${formatError(error)}`)
    process.exitCode = 1
  })
}
