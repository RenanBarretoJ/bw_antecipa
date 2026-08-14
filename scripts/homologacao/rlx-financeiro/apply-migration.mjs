import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import pg from 'pg'
import { assertHomologEnvironment, assertMutation, loadHomologEnv, parseArgs } from '../rlx-golden/helpers.mjs'

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
if (!assertMutation(args, 'APPLY_P22', env.projectRef)) {
  console.log(`Preview seguro. Para aplicar: --execute --confirm APPLY_P22_RLX_GOLDEN_HOMOLOG_${env.projectRef}`)
  process.exit(0)
}

const client = new pg.Client({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } })
const migrationFile = args.file || '20260813191143_p2_2_ingestao_financeira_versionada_rlx.sql'
if (basename(migrationFile) !== migrationFile || !/^\d{14}_[a-z0-9_]+\.sql$/i.test(migrationFile)) {
  throw new Error('Nome de migration invalido.')
}
const path = resolve(process.cwd(), 'supabase/migrations', migrationFile)
try {
  await client.connect()
  const isComplement = migrationFile.includes('complemento_linhagem_sem_movimento')
  const isCycleLock = migrationFile.includes('lock_ciclo_financeiro')
  const isViewRefresh = migrationFile.includes('refresh_views_linhagem')
  const isRlsHardening = migrationFile.includes('hardening_rls_indices')
  const isHybridScope = migrationFile.includes('escopo_hibrido')
  const isSuperAdminHelper = migrationFile.includes('helper_rls_super_admin')
  const isCapabilities = migrationFile.includes('p2_2_1_integracoes_capabilities')
  const isSinqiaFinancialConfig = migrationFile.includes('p2_2_2_cnpj_financeiro_derivado_fundo')
  const isSinqiaFinancial = migrationFile.includes('p2_2_2_sinqia_financeiro_envios') && !isSinqiaFinancialConfig
  const sinqiaBefore = isCapabilities ? await client.query(`
    select
      (select count(*)::integer from public.integracoes_fundo i
        where lower(i.provedor) in ('fromtis','sinqia')) as integracoes,
      (select count(*)::integer from public.integracao_fundo_versoes v
        join public.integracoes_fundo i on i.id=v.integracao_fundo_id
        where lower(i.provedor) in ('fromtis','sinqia')) as versoes,
      (select count(*)::integer from public.credenciais_integracao c
        join public.integracoes_fundo i on i.id=c.integracao_fundo_id
        where lower(i.provedor) in ('fromtis','sinqia')) as credenciais
  `) : null
  const existing = await client.query(isSinqiaFinancialConfig
    ? "select to_regprocedure('private.cnpj_fundo_da_integracao(uuid)') is not null as applied"
    : isSinqiaFinancial
    ? `select
        to_regprocedure('private.validar_publicacao_sinqia_p2_2_2()') is not null
        and private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'ESTOQUE')
        and private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'AQUISICOES')
        and private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'LIQUIDACOES')
        and not private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'CARTEIRA')
        and exists (
          select 1 from pg_trigger
          where tgrelid = 'public.integracao_fundo_versoes'::regclass
            and tgname = 'integracao_p2_2_2_validar_publicacao'
            and not tgisinternal
        ) as applied`
    : isSuperAdminHelper
    ? "select to_regprocedure('private.rlx_usuario_e_super_admin()') is not null as applied"
    : isCapabilities
    ? "select to_regclass('public.integracao_fundo_versao_capacidades') is not null and to_regprocedure('public.resolver_integracao_por_capability(uuid,text,text)') is not null as applied"
    : isHybridScope
    ? "select not exists(select 1 from pg_policies where schemaname='public' and policyname='rlx_estoque_super_admin_select') as applied"
    : isRlsHardening
    ? "select exists(select 1 from pg_class where oid='public.rlx_estoque_atual'::regclass and reloptions @> array['security_invoker=true']) and to_regclass('public.rlx_estoque_chave_nfe_lookup_idx') is not null as applied"
    : isViewRefresh
    ? "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='rlx_estoque_atual' and column_name='external_title_key') as applied"
    : isCycleLock
    ? "select to_regprocedure('public.iniciar_ciclo_importacao_financeira_rlx(uuid,date,text,uuid)') is not null as applied"
    : isComplement
      ? "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='rlx_importacoes_financeiras' and column_name='declaracao_sem_movimento') as applied"
      : "select to_regclass('public.rlx_importacoes_financeiras') is not null as applied")
  if (existing.rows[0]?.applied) throw new Error(`A migration ${migrationFile} ja esta aplicada; nenhuma instrucao foi repetida.`)
  await client.query(readFileSync(path, 'utf8'))
  const verified = await client.query(isSinqiaFinancialConfig
    ? `select
        to_regprocedure('private.cnpj_fundo_da_integracao(uuid)') is not null
        and not exists (
          select 1
          from public.integracao_fundo_versoes v
          where v.status='rascunho'
            and private.cnpj_fundo_da_integracao(v.integracao_fundo_id) ~ '^[0-9]{14}$'
            and exists (
              select 1 from public.integracao_fundo_versao_capacidades c
              where c.integracao_fundo_versao_id=v.id
                and c.capability in ('ESTOQUE','AQUISICOES','LIQUIDACOES')
            )
            and v.configuracao_nao_sensivel #>> '{relatorios_financeiros,cnpj_fundo}'
                is distinct from private.cnpj_fundo_da_integracao(v.integracao_fundo_id)
        ) as ok`
    : isSinqiaFinancial
    ? `select
        to_regprocedure('private.validar_publicacao_sinqia_p2_2_2()') is not null
        and private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'CESSAO_ENVIO')
        and private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'ESTOQUE')
        and private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'AQUISICOES')
        and private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'LIQUIDACOES')
        and not private.integracao_adapter_capability_suportada('sinqia_portal_fidc', 'CARTEIRA')
        and exists (
          select 1 from pg_trigger
          where tgrelid = 'public.integracao_fundo_versoes'::regclass
            and tgname = 'integracao_p2_2_2_validar_publicacao'
            and not tgisinternal
        ) as ok`
    : isSuperAdminHelper
    ? "select to_regprocedure('private.rlx_usuario_e_super_admin()') is not null as ok"
    : isCapabilities
    ? "select to_regclass('public.integracao_fundo_versao_capacidades') is not null and to_regprocedure('public.resolver_integracao_por_capability(uuid,text,text)') is not null and exists(select 1 from pg_indexes where schemaname='public' and indexname='uq_integracao_capability_fonte_ativa') as ok"
    : isHybridScope
    ? "select not exists(select 1 from pg_policies where schemaname='public' and policyname='rlx_estoque_super_admin_select') as ok"
    : isRlsHardening
    ? "select exists(select 1 from pg_class where oid='public.rlx_estoque_atual'::regclass and reloptions @> array['security_invoker=true']) and to_regclass('public.rlx_estoque_chave_nfe_lookup_idx') is not null as ok"
    : isViewRefresh
    ? "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='rlx_estoque_atual' and column_name='external_title_key') as ok"
    : isCycleLock
    ? "select to_regprocedure('public.iniciar_ciclo_importacao_financeira_rlx(uuid,date,text,uuid)') is not null as ok"
    : isComplement
      ? "select to_regprocedure('public.registrar_importacao_financeira_sem_movimento(uuid,text,date,text,text,text,text,uuid)') is not null as ok"
      : "select to_regclass('public.rlx_importacoes_financeiras') is not null as ok")
  if (!verified.rows[0]?.ok) throw new Error('A migration terminou sem criar a tabela de controle.')
  if (isCapabilities) {
    const preserved = await client.query(`
      select
        (select count(*)::integer from public.integracoes_fundo i
          where i.provider_key='SINQIA' and i.system_name='Portal FIDC') as integracoes,
        (select count(*)::integer from public.integracao_fundo_versoes v
          join public.integracoes_fundo i on i.id=v.integracao_fundo_id
          where i.provider_key='SINQIA' and i.system_name='Portal FIDC') as versoes,
        (select count(*)::integer from public.credenciais_integracao c
          join public.integracoes_fundo i on i.id=c.integracao_fundo_id
          where i.provider_key='SINQIA' and i.system_name='Portal FIDC') as credenciais,
        not exists (
          select 1 from public.integracao_fundo_versao_capacidades c
          join public.integracao_fundo_versoes v on v.id=c.integracao_fundo_versao_id
          join public.integracoes_fundo i on i.id=v.integracao_fundo_id
          where i.provider_key='SINQIA' and i.system_name='Portal FIDC'
            and c.capability <> 'CESSAO_ENVIO'
        ) as somente_cessao
    `)
    const before = sinqiaBefore.rows[0]
    const after = preserved.rows[0]
    if (before.integracoes !== after.integracoes || before.versoes !== after.versoes || before.credenciais !== after.credenciais) {
      throw new Error('Backfill alterou a quantidade de integracoes, versoes ou credenciais Sinqia existentes.')
    }
    if (!after.somente_cessao) throw new Error('Backfill atribuiu capability financeira indevidamente ao Portal FIDC existente.')
  }
  console.log(`Migration ${migrationFile} aplicada e verificada em homologacao.`)
} finally {
  await client.end().catch(() => undefined)
}
