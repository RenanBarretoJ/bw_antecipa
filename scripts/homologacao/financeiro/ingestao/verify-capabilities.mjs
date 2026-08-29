import {
  assertHomologEnvironment,
  connectDb,
  loadHomologEnv,
  parseArgs,
} from '../../rlx-golden/helpers.mjs'

const args = parseArgs()
loadHomologEnv()
const env = assertHomologEnvironment(args)
const db = await connectDb(env, 'p221_capabilities_verify')
const failures = []

function check(condition, label, details = undefined) {
  if (!condition) failures.push({ label, details })
}

try {
  console.log('\nBW Antecipa - verificacao READ-ONLY P2.2.1')
  console.log(`Projeto homolog: ${env.projectRef}`)
  await db.query('BEGIN READ ONLY')

  const schema = await db.query(`select
    to_regclass('public.integracao_fundo_versao_capacidades') is not null as capabilities,
    to_regprocedure('public.resolver_integracao_por_capability(uuid,text,text)') is not null as resolver,
    exists(select 1 from pg_indexes where schemaname='public' and indexname='uq_integracao_capability_fonte_ativa') as fonte_unica,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='importacoes_financeiras' and column_name='integracao_fundo_versao_id') as linhagem`)
  check(Object.values(schema.rows[0]).every(Boolean), 'schema, resolver, unicidade e linhagem existem', schema.rows[0])

  const duplicates = await db.query(`
    select fundo_id,ambiente,capability,count(*)::integer total
    from public.integracao_fundo_versao_capacidades
    where disponivel_desde is not null and disponivel_ate is null
    group by fundo_id,ambiente,capability having count(*) > 1
  `)
  check(duplicates.rowCount === 0, 'nenhuma capability possui duas fontes ativas', duplicates.rows)

  const invalidMembership = await db.query(`
    select c.id from public.integracao_fundo_versao_capacidades c
    join public.integracao_fundo_versoes v on v.id=c.integracao_fundo_versao_id
    join public.integracoes_fundo i on i.id=v.integracao_fundo_id
    where c.fundo_id<>i.fundo_id or c.ambiente<>v.ambiente
  `)
  check(invalidMembership.rowCount === 0, 'memberships pertencem ao fundo e ambiente da versao', invalidMembership.rows)

  const sinqia = await db.query(`
    select v.id,v.versao,v.status,c.capability
    from public.integracao_fundo_versao_capacidades c
    join public.integracao_fundo_versoes v on v.id=c.integracao_fundo_versao_id
    join public.integracoes_fundo i on i.id=v.integracao_fundo_id
    where i.provider_key='SINQIA' and i.system_name='Portal FIDC'
    order by v.versao,c.capability
  `)
  const supportedSinqiaCapabilities = new Set(['CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'])
  check(
    !sinqia.rows.some((row) => !supportedSinqiaCapabilities.has(row.capability)),
    'Portal FIDC/Sinqia possui somente capabilities comprovadas e nao habilita CARTEIRA',
    sinqia.rows,
  )

  const grants = await db.query(`
    select grantee,privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='integracao_fundo_versao_capacidades'
      and grantee in ('anon','authenticated')
  `)
  check(grants.rowCount === 0, 'tabela de capabilities nao foi exposta a anon/authenticated', grants.rows)

  const unsafeLineage = await db.query(`
    select id,origem from public.importacoes_financeiras
    where integracao_fundo_versao_id is not null and origem <> 'CRON'
  `)
  check(unsafeLineage.rowCount === 0, 'somente CRON registra linhagem de integracao automatica', unsafeLineage.rows)

  await db.query('ROLLBACK')
  if (failures.length) {
    console.error(`P2.2.1 verify falhou em ${failures.length} verificacao(oes):`)
    for (const failure of failures) console.error(`- ${failure.label}: ${JSON.stringify(failure.details)}`)
    process.exitCode = 1
  } else {
    console.log('P2.2.1 verify aprovado: schema, isolamento, backfill e linhagem consistentes.')
  }
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  console.error(`P2.2.1 verify falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await db.end().catch(() => undefined)
}
