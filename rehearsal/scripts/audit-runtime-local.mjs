import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  REPORT_DIR,
  ensureRuntimeDirectories,
  formatError,
  localPgConfig,
  withPgClient,
  writeJson,
} from './lib.mjs'
import { localAdminClient, localSupabaseStatus, snapshotHash } from './runtime-lib.mjs'

const EXPECTED = Object.freeze({ cedentes: 12, operacoes: 46, notas_fiscais: 910, documentos: 123, storage_objects: 1644, profiles: 23, auth_users: 23, fromtis_legado: 26 })
const REQUIRED_BUCKETS = ['contratos', 'documentos-cedentes', 'notas-fiscais']

async function setAuthenticatedIdentity(client, userId) {
  await client.query('set local role authenticated')
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
  await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)")
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated', aal: 'aal2' })])
}

async function rlsMatrix() {
  return withPgClient({ ...localPgConfig(), user: 'supabase_admin' }, async (client) => {
    const cedenteFixture = await client.query(`
      select ca.user_id::text, ca.cedente_id::text
        from public.cedente_acessos ca
       where ca.perfil = 'ADMIN' and ca.status = 'ATIVO' and ca.ativo is true
       order by ca.user_id limit 1
    `)
    const sacadoFixture = await client.query(`select user_id::text, regexp_replace(cnpj, '[^0-9]', '', 'g') as cnpj from public.sacados where user_id is not null order by user_id limit 1`)
    if (!cedenteFixture.rows[0] || !sacadoFixture.rows[0]) throw new Error('Fixtures RLS de Cedente/Sacado ausentes.')

    const cedente = cedenteFixture.rows[0]
    await client.query('begin')
    await setAuthenticatedIdentity(client, cedente.user_id)
    const cedenteView = await client.query(`
      select
        (select array_agg(id::text order by id) from public.cedentes) as cedentes,
        (select array_agg(distinct cedente_id::text order by cedente_id::text) from public.operacoes) as operacoes_cedentes,
        (select array_agg(distinct cedente_id::text order by cedente_id::text) from public.notas_fiscais) as nfs_cedentes
    `)
    await client.query('rollback')

    const sacado = sacadoFixture.rows[0]
    const expectedSacadoNfs = await client.query(`select count(*)::integer as total from public.notas_fiscais where regexp_replace(cnpj_destinatario, '[^0-9]', '', 'g') = $1`, [sacado.cnpj])
    await client.query('begin')
    await setAuthenticatedIdentity(client, sacado.user_id)
    const sacadoView = await client.query(`select (select count(*)::integer from public.sacados) as sacados, (select count(*)::integer from public.notas_fiscais) as nfs`)
    await client.query('rollback')

    const cedenteRow = cedenteView.rows[0]
    return {
      cedente: {
        own_id: cedente.cedente_id,
        cedentes_visiveis: cedenteRow.cedentes ?? [],
        operacoes_cedentes: cedenteRow.operacoes_cedentes ?? [],
        nfs_cedentes: cedenteRow.nfs_cedentes ?? [],
        isolated: (cedenteRow.cedentes ?? []).every((id) => id === cedente.cedente_id)
          && (cedenteRow.operacoes_cedentes ?? []).every((id) => id === cedente.cedente_id)
          && (cedenteRow.nfs_cedentes ?? []).every((id) => id === cedente.cedente_id),
      },
      sacado: {
        rows_visible: sacadoView.rows[0].sacados,
        nfs_visible: sacadoView.rows[0].nfs,
        nfs_expected: expectedSacadoNfs.rows[0].total,
        isolated: sacadoView.rows[0].sacados === 1 && sacadoView.rows[0].nfs === expectedSacadoNfs.rows[0].total,
      },
    }
  })
}

async function collectSnapshot(client) {
  const result = await client.query(`
    select jsonb_build_object(
      'cedentes', (select count(*)::integer from public.cedentes),
      'operacoes', (select count(*)::integer from public.operacoes),
      'notas_fiscais', (select count(*)::integer from public.notas_fiscais),
      'documentos', (select count(*)::integer from public.documentos),
      'storage_objects', (select count(*)::integer from storage.objects),
      'profiles', (select count(*)::integer from public.profiles),
      'auth_users', (select count(*)::integer from auth.users),
      'fromtis_legado', (select count(*)::integer from public.operacoes where remessa_fromtis_id is not null or remessa_fromtis_retorno is not null),
      'operacao_ids', (select encode(extensions.digest(string_agg(id::text, ',' order by id::text), 'sha256'), 'hex') from public.operacoes),
      'nf_ids', (select encode(extensions.digest(string_agg(id::text, ',' order by id::text), 'sha256'), 'hex') from public.notas_fiscais),
      'documento_ids', (select encode(extensions.digest(string_agg(id::text, ',' order by id::text), 'sha256'), 'hex') from public.documentos),
      'storage_paths', (select encode(extensions.digest(string_agg(bucket_id || '/' || name, ',' order by bucket_id, name), 'sha256'), 'hex') from storage.objects)
    ) as snapshot
  `)
  return result.rows[0].snapshot
}

async function storageCompatibility() {
  const admin = localAdminClient(localSupabaseStatus())
  const results = []
  for (const bucket of REQUIRED_BUCKETS) {
    const fixture = `rehearsal-runtime/${crypto.randomUUID()}.txt`
    const upload = await admin.storage.from(bucket).upload(fixture, new TextEncoder().encode('fixture local de rehearsal'), { contentType: 'text/plain', upsert: false })
    let signed = null
    let downloaded = null
    let cleanup = null
    if (!upload.error) {
      const signedResult = await admin.storage.from(bucket).createSignedUrl(fixture, 60)
      signed = !signedResult.error && Boolean(signedResult.data?.signedUrl)
      const downloadResult = await admin.storage.from(bucket).download(fixture)
      downloaded = !downloadResult.error && Boolean(downloadResult.data)
      const cleanupResult = await admin.storage.from(bucket).remove([fixture])
      cleanup = !cleanupResult.error
    }
    results.push({ bucket, upload: !upload.error, signed_url: signed, download: downloaded, cleanup })
  }
  return results
}

async function main() {
  ensureRuntimeDirectories()
  const prePath = path.join(REPORT_DIR, 'PRE_RUNTIME.json')
  if (!fs.existsSync(prePath)) throw new Error('PRE_RUNTIME ausente. Execute rehearsal:runtime:prepare.')
  const pre = JSON.parse(fs.readFileSync(prePath, 'utf8'))

  const database = await withPgClient(localPgConfig(), async (client) => {
    const snapshotBeforeFixtures = await collectSnapshot(client)
    const operationRows = await client.query(`
      select o.id::text, o.status::text,
             (cf.id is not null and cf.cedente_id = o.cedente_id) as contexto_valido,
             count(onf.nota_fiscal_id)::integer as nfs
        from public.operacoes o
        left join public.cedente_fundos cf on cf.id = o.cedente_fundo_id
        left join public.operacoes_nfs onf on onf.operacao_id = o.id
       group by o.id, o.status, cf.id, cf.cedente_id
       order by o.id
    `)
    const operationStatus = await client.query(`
      select status::text, count(*)::integer as total
        from public.operacoes group by status order by status::text
    `)
    const nfRows = await client.query(`
      select nf.id::text,
             (cf.id is not null and cf.cedente_id = nf.cedente_id and cf.fundo_id = nf.fundo_id) as contexto_valido,
             (nf.estabelecimento_id is null or ce.id is not null) as estabelecimento_compativel,
             length(regexp_replace(coalesce(nf.chave_acesso, ''), '[^0-9]', '', 'g')) as chave_digitos
        from public.notas_fiscais nf
        left join public.cedente_fundos cf on cf.id = nf.cedente_fundo_id
        left join public.cedente_estabelecimentos ce on ce.id = nf.estabelecimento_id
       order by nf.id
    `)
    const linkedCedentes = await client.query(`
      select
        count(*) filter (where exists (select 1 from public.cedente_fundos cf where cf.cedente_id = c.id and cf.status = 'ativo'))::integer as vinculados,
        count(*) filter (where not exists (select 1 from public.cedente_fundos cf where cf.cedente_id = c.id and cf.status = 'ativo'))::integer as sem_fundo
      from public.cedentes c
    `)
    const legacy = await client.query(`
      select count(*)::integer as total,
             count(*) filter (where remessa_fromtis_id is not null)::integer as com_remessa,
             count(*) filter (where remessa_fromtis_retorno is not null)::integer as com_retorno
        from public.operacoes
       where remessa_fromtis_id is not null or remessa_fromtis_retorno is not null
    `)
    const bucketRows = await client.query(`
      select b.id, count(o.id)::integer as metadata
        from storage.buckets b left join storage.objects o on o.bucket_id = b.id
       where b.id = any($1::text[]) group by b.id order by b.id
    `, [REQUIRED_BUCKETS])
    const cutover = await client.query(`
      select f.id::text,
        exists(select 1 from public.politicas_operacionais po join public.politica_operacional_versoes pov on pov.politica_operacional_id = po.id where po.fundo_id = f.id and pov.status = 'publicada') as politica_publicada,
        (select count(*)::integer from public.templates_documentos td where td.fundo_id = f.id) as templates,
        exists(select 1 from public.configuracoes_cnab cc where cc.fundo_id = f.id) as cnab,
        exists(select 1 from public.integracoes_fundo i where i.fundo_id = f.id) as integracao
      from public.fundos f order by f.id
    `)
    return {
      snapshot_before_fixtures: snapshotBeforeFixtures,
      operations: operationRows.rows,
      operation_status: operationStatus.rows,
      nfs: nfRows.rows,
      cedentes: linkedCedentes.rows[0],
      fromtis: legacy.rows[0],
      buckets: bucketRows.rows,
      cutover: cutover.rows,
    }
  })

  const storage = await storageCompatibility()
  const rls = await rlsMatrix()
  const post = await withPgClient(localPgConfig(), collectSnapshot)
  const operationFailures = database.operations.filter((row) => !row.contexto_valido)
  const nfFailures = database.nfs.filter((row) => !row.contexto_valido || !row.estabelecimento_compativel)
  const nonStandardKeys = database.nfs.filter((row) => row.chave_digitos !== 44).length
  const countFailures = Object.entries(EXPECTED).flatMap(([key, expected]) => Number(post[key]) === expected ? [] : [{ key, expected, actual: Number(post[key]) }])
  const report = {
    generated_at: new Date().toISOString(),
    environment: 'rehearsal/local',
    production_access: 'none',
    operations: {
      expected: 46,
      loadable: database.operations.length - operationFailures.length,
      failures: operationFailures.length,
      by_status: database.operation_status,
    },
    notas_fiscais: {
      expected: 910,
      loadable: database.nfs.length - nfFailures.length,
      failures: nfFailures.length,
      non_standard_access_keys: nonStandardKeys,
    },
    cedentes: database.cedentes,
    fromtis_legacy: database.fromtis,
    storage: { metadata: database.buckets, runtime_fixtures: storage },
    cutover_inventory: database.cutover,
    rls,
    pre_runtime_hash: pre.snapshot_hash,
    post_runtime_hash: snapshotHash(post),
    synthetic_residual: snapshotHash(database.snapshot_before_fixtures) === snapshotHash(post) ? 0 : 1,
    count_failures: countFailures,
    hard_failures: [
      ...operationFailures.map(() => 'operacao_contexto_invalido'),
      ...nfFailures.map(() => 'nf_contexto_invalido'),
      ...countFailures.map((failure) => `contagem_${failure.key}`),
      ...storage.filter((item) => !item.upload || !item.signed_url || !item.download || !item.cleanup).map((item) => `storage_${item.bucket}`),
      ...(!rls.cedente.isolated ? ['rls_cedente'] : []),
      ...(!rls.sacado.isolated ? ['rls_sacado'] : []),
    ],
  }
  writeJson(path.join(REPORT_DIR, 'POST_RUNTIME_DATA.json'), report)
  console.log(`Operacoes carregaveis: ${report.operations.loadable}/${report.operations.expected}`)
  console.log(`NFs preservadas: ${report.notas_fiscais.loadable}/${report.notas_fiscais.expected}`)
  console.log(`Storage buckets compativeis: ${storage.filter((item) => item.upload && item.signed_url && item.download && item.cleanup).length}/${REQUIRED_BUCKETS.length}`)
  console.log(`Massa sintetica residual: ${report.synthetic_residual}`)
  if (report.hard_failures.length > 0) process.exitCode = 2
}

main().catch((error) => {
  console.error(`Auditoria de runtime falhou: ${formatError(error)}`)
  process.exitCode = 1
})
