#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { buildMigrationInventory, compareMigrationHistory } from './lib.mjs'

const HOMOLOG_REF = 'fhgkmggthxikfpogrvaa'
const CLI_PATH = resolve('node_modules/supabase/dist/supabase.js')
const outputPath = resolve('docs/financeiro/homolog-postflight-p2-6-4.json')

if (!process.version.startsWith('v22.')) throw new Error(`Node 22 obrigatorio; recebido ${process.version}.`)
const dbUrl = loadHomologDbUrl()
const dryRun = run(process.execPath, [CLI_PATH, 'db', 'push', '--dry-run', '--db-url', dbUrl, '--yes'], true)
const dryRunEmpty = dryRun.status === 0 && /up to date|no migrations to push/i.test(dryRun.combined)

const client = new pg.Client({ connectionString: dbUrl, application_name: 'bw_antecipa_p264_postflight_read_only', statement_timeout: 240_000, query_timeout: 240_000, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query('BEGIN READ ONLY')
  const inventory = buildMigrationInventory()
  const historyRows = await client.query('select version::text,name::text from supabase_migrations.schema_migrations order by version')
  const history = compareMigrationHistory(inventory, historyRows.rows)
  const acl = await client.query(`select grantee,kind,count(*)::integer as privileges
    from (
      select grantee,'table'::text kind from information_schema.table_privileges
       where table_schema='public' and grantee in ('PUBLIC','anon','authenticated','service_role')
      union all
      select grantee,'routine'::text kind from information_schema.routine_privileges
       where routine_schema='public' and grantee in ('PUBLIC','anon','authenticated','service_role')
    ) q group by grantee,kind order by grantee,kind`)
  const defaultAcl = await client.query(`select r.rolname as owner,n.nspname as schema,d.defaclobjtype,coalesce(d.defaclacl::text,'') as acl
    from pg_default_acl d join pg_roles r on r.oid=d.defaclrole left join pg_namespace n on n.oid=d.defaclnamespace
    where n.nspname='public' or n.nspname is null order by 1,2,3`)
  const policies = await client.query(`select schemaname as schema,tablename as relation,policyname as name,cmd,roles,qual,with_check
    from pg_policies where (schemaname='public' and tablename in ('devedores_solidarios','logs_auditoria','eventos_dominio'))
      or (schemaname='storage' and tablename='objects' and policyname like 'storage_contratos_gestor_%')
    order by 1,2,3`)
  const { rows: [checks] } = await client.query(`select
    (select count(*)::bigint from public.notas_fiscais where valor_bruto <= 0) = 0 as nf_compativel,
    (select count(*)::bigint from public.remessas_cnab r where r.integracao_fundo_versao_id is not null and not exists (select 1 from public.integracao_fundo_versoes v where v.id=r.integracao_fundo_versao_id)) = 0 as remessas_sem_orfas,
    (select relrowsecurity from pg_class where oid='public.devedores_solidarios'::regclass) as devedores_rls,
    not has_function_privilege('anon','public.aprovar_operacao_atomica(uuid,numeric)','EXECUTE') as anon_sem_aprovacao,
    not has_function_privilege('authenticated','public.aprovar_operacao_atomica(uuid,numeric)','EXECUTE') as authenticated_sem_aprovacao,
    not has_function_privilege('service_role','public.aprovar_operacao_atomica_financeiro_v1(uuid,numeric)','EXECUTE') as service_sem_motor_interno,
    not has_function_privilege('service_role','public.bloquear_aprovacao_financeira_direta()','EXECUTE') as service_sem_trigger_interno,
    not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('storage_contratos_gestor_insert','storage_contratos_gestor_update')) as storage_legado_ausente`)
  const pass = history.aligned && dryRunEmpty && Object.values(checks).every(Boolean)
  const result = {
    schema: 'bw-antecipa-p2-6-4-homolog-postflight-v1',
    status: pass ? 'PASS' : 'FAIL',
    captured_at: new Date().toISOString(),
    environment: { project_ref: HOMOLOG_REF, transaction: 'READ ONLY', production_mutated: false },
    migration_history: history,
    db_push_dry_run: { status: dryRunEmpty ? 'PASS' : 'FAIL', output: sanitize(dryRun.combined) },
    checks,
    acl_summary: acl.rows,
    default_acl: defaultAcl.rows,
    canonical_policies: policies.rows,
  }
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  if (!pass) throw new Error(`Postflight P2.6.4 falhou: ${JSON.stringify({ history, dryRunEmpty, checks })}`)
  console.log(JSON.stringify({ status: result.status, migration_history: history, db_push_dry_run: result.db_push_dry_run.status, output: outputPath }, null, 2))
} finally {
  await client.query('ROLLBACK').catch(() => undefined)
  await client.end()
}

function loadHomologDbUrl() {
  const env = new Map()
  for (const line of readFileSync(resolve('.env.homolog'), 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (match) env.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ''))
  }
  const value = env.get('SUPABASE_DB_URL') || env.get('DATABASE_URL')
  if (!value) throw new Error('URL de homologacao ausente.')
  const url = new URL(value)
  const ref = decodeURIComponent(url.username).match(/^postgres[.]([a-z0-9]+)$/i)?.[1]
    || url.hostname.match(/^db[.]([a-z0-9]+)[.]supabase[.]co$/i)?.[1]
  if (ref !== HOMOLOG_REF) throw new Error('Projeto remoto diferente da homologacao autorizada.')
  return value
}

function run(command, args, allowFailure = false) {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  delete env.DATABASE_URL
  delete env.SUPABASE_DB_URL
  delete env.SUPABASE_ACCESS_TOKEN
  const child = spawnSync(command, args, { cwd: process.cwd(), env, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024, timeout: 900_000 })
  if (child.error) throw child.error
  const combined = [child.stdout, child.stderr].filter(Boolean).join('\n').trim()
  if ((child.status ?? 1) !== 0 && !allowFailure) throw new Error(`${command} falhou: ${sanitize(combined)}`)
  return { status: child.status ?? 1, stdout: child.stdout || '', stderr: child.stderr || '', combined }
}

function sanitize(value) {
  return String(value).replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[DATABASE_URL_REDACTED]').replace(/\u001b\[[0-9;]*m/g, '')
}
