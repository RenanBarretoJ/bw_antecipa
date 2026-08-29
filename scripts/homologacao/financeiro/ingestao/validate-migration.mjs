import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import pg from 'pg'
import { assertHomologEnvironment, loadHomologEnv, parseArgs } from '../../rlx-golden/helpers.mjs'

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const client = new pg.Client({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } })
const migrationFile = args.file || '20260813191143_p2_2_ingestao_financeira_versionada_rlx.sql'
if (basename(migrationFile) !== migrationFile || !/^\d{14}_[a-z0-9_]+\.sql$/i.test(migrationFile)) {
  throw new Error('Nome de migration invalido.')
}
const path = resolve(process.cwd(), 'supabase/migrations', migrationFile)
const sql = readFileSync(path, 'utf8').replace(/^BEGIN;\s*/, '').replace(/\s*COMMIT;\s*$/, '')

try {
  await client.connect()
  await client.query('BEGIN')
  await client.query(sql)
  const isCapabilities = migrationFile.includes('p2_2_1_integracoes_capabilities')
  const isSinqiaFinancial = migrationFile.includes('p2_2_2_sinqia_financeiro_envios')
  const result = await client.query(isSinqiaFinancial ? `select
    private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'CESSAO_ENVIO') as cessao,
    private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'ESTOQUE') as estoque,
    private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'AQUISICOES') as aquisicoes,
    private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'LIQUIDACOES') as liquidacoes,
    not private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'CARTEIRA') as sem_carteira,
    to_regprocedure('private.validar_publicacao_sinqia_p2_2_2()') is not null as validador,
    exists (
      select 1 from pg_trigger
      where tgrelid = 'public.integracao_fundo_versoes'::regclass
        and tgname = 'integracao_p2_2_2_validar_publicacao'
        and not tgisinternal
    ) as trigger_publicacao`
    : isCapabilities ? `select
    to_regclass('public.integracao_fundo_versao_capacidades') is not null as capabilities,
    to_regprocedure('public.resolver_integracao_por_capability(uuid,text,text)') is not null as resolver,
    exists(select 1 from pg_indexes where schemaname='public' and indexname='uq_integracao_capability_fonte_ativa') as fonte_unica,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='importacoes_financeiras' and column_name='integracao_fundo_versao_id') as linhagem,
    not exists (
      select 1 from public.integracao_fundo_versao_capacidades c
      join public.integracao_fundo_versoes v on v.id=c.integracao_fundo_versao_id
      join public.integracoes_fundo i on i.id=v.integracao_fundo_id
      where i.provider_key='SINQIA' and i.system_name='Portal FIDC'
        and c.capability <> 'CESSAO_ENVIO'
    ) as backfill_seguro`
    : `select
    to_regclass('public.importacoes_financeiras') is not null as importacoes,
    to_regprocedure('public.publicar_importacao_financeira(uuid,uuid)') is not null as publicar,
    to_regprocedure('public.registrar_importacao_financeira_sem_movimento(uuid,text,date,text,text,text,text,uuid)') is not null as sem_movimento,
    to_regprocedure('public.iniciar_ciclo_importacao_financeira(uuid,date,text,uuid)') is not null as lock_ciclo`)
  console.log(JSON.stringify({ migrationFile, ...result.rows[0] }))
} finally {
  await client.query('ROLLBACK').catch(() => undefined)
  await client.end().catch(() => undefined)
}
