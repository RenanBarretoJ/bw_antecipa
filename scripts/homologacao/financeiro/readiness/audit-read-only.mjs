import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertHomologEnvironment, connectDb, loadHomologEnv, parseArgs } from '../../rlx-golden/helpers.mjs'
import { buildMigrationInventory, check, compareMigrationHistory, sanitizeError, scanActiveStructuralRlx } from './lib.mjs'

loadHomologEnv()
const env = assertHomologEnvironment(parseArgs())
const db = await connectDb(env, 'p261_readiness_read_only')
const inventory = buildMigrationInventory()
const checks = []
const evidence = {
  schema: 'bw-antecipa-p2-6-1-read-only-v1',
  target: { ambiente: env.appEnv, project_ref: env.projectRef, production_mutated: false },
  migrations: null,
  schema_state: {},
  checks,
}

try {
  await db.query('BEGIN READ ONLY')
  const history = await db.query('select version,name from supabase_migrations.schema_migrations order by version')
  evidence.migrations = compareMigrationHistory(inventory, history.rows)
  checks.push(check('MIGRATION_HISTORY', 'migrations', evidence.migrations.aligned, {
    local: evidence.migrations.local_total,
    remoto: evidence.migrations.remote_total,
    ausentes: evidence.migrations.missing_remote.length,
    excedentes: evidence.migrations.extra_remote.length,
    nomes_divergentes: evidence.migrations.name_mismatches.length,
  }))

  const structural = await db.query(`select n.nspname schema_name,c.relkind,c.relname
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('r','p','v','m') and c.relname like 'rlx\\_%' escape '\\'
    order by 1,2,3`)
  const routines = await db.query(`select n.nspname schema_name,p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname like 'rlx\\_%' escape '\\'
    order by 1,2`)
  const activeCodeRlx = scanActiveStructuralRlx()
  evidence.schema_state.rlx = { relations: structural.rows, routines: routines.rows, active_code_references: activeCodeRlx }
  checks.push(check('STRUCTURAL_RLX_ZERO', 'schema', structural.rowCount === 0 && routines.rowCount === 0 && activeCodeRlx.length === 0, evidence.schema_state.rlx))

  const generic = await db.query(`select to_regclass(name) is not null present,name from unnest(array[
    'public.importacoes_financeiras','public.matching_execucoes','public.conciliacao_execucoes',
    'public.posicao_logistica_execucoes','public.exposicao_execucoes','public.risco_execucoes',
    'public.risco_motivos','public.risco_revisoes']) name`)
  evidence.schema_state.generic_domain = generic.rows
  checks.push(check('GENERIC_DOMAIN', 'schema', generic.rows.every((row) => row.present), generic.rows))

  const rls = await db.query(`select c.relname,c.relrowsecurity,c.relforcerowsecurity,
      count(p.policyname)::int policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    left join pg_policies p on p.schemaname=n.nspname and p.tablename=c.relname
    where n.nspname='public' and c.relname=any($1)
    group by c.relname,c.relrowsecurity,c.relforcerowsecurity order by c.relname`, [[
      'importacoes_financeiras','importacao_linhas','matching_execucoes','matching_resultados',
      'conciliacao_execucoes','conciliacao_resultados','posicao_logistica_execucoes',
      'posicao_logistica_resultados','exposicao_execucoes','exposicao_overlay_itens',
      'risco_execucoes','risco_motivos','risco_revisoes',
    ]])
  evidence.schema_state.rls = rls.rows
  checks.push(check('RLS_FINANCEIRO', 'seguranca', rls.rows.length === 13 && rls.rows.every((row) => row.relrowsecurity && row.policies > 0), rls.rows))

  const riskFunctions = await db.query(`select p.oid::regprocedure::text signature,p.prosecdef,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
      has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
    from pg_proc p where p.oid=any($1::regprocedure[]) order by 1`, [[
      'public.persistir_risco_execucao(jsonb)',
      'public.simular_memoria_financeira_operacao(uuid,numeric)',
      'public.decidir_revisao_risco(uuid,text,text,uuid)',
      'public.aprovar_operacao_com_risco_atomica(uuid,numeric,uuid,text)',
    ]])
  evidence.schema_state.risk_functions = riskFunctions.rows
  checks.push(check('RISK_RPC_GRANTS', 'seguranca', riskFunctions.rows.length === 4 && riskFunctions.rows.every((row) => row.prosecdef && !row.anon_execute), riskFunctions.rows))

  const bypass = await db.query(`select
    has_function_privilege('authenticated','public.aprovar_operacao_atomica(uuid,numeric)'::regprocedure,'EXECUTE') old_two,
    case when to_regprocedure('public.aprovar_operacao_atomica(uuid,numeric,numeric)') is null then false
      else has_function_privilege('authenticated','public.aprovar_operacao_atomica(uuid,numeric,numeric)'::regprocedure,'EXECUTE') end old_three`)
  checks.push(check('OLD_APPROVAL_BYPASS', 'bypass', !bypass.rows[0].old_two && !bypass.rows[0].old_three, bypass.rows[0]))

  const storage = await db.query(`select id,name,public,file_size_limit,allowed_mime_types from storage.buckets order by id`)
  const storagePolicies = await db.query(`select policyname,cmd,roles,qual from pg_policies where schemaname='storage' and tablename='objects' order by policyname`)
  evidence.schema_state.storage = { buckets: storage.rows, policies: storagePolicies.rows.map((row) => ({ ...row, qual: row.qual ? '[PRESENT]' : null })) }
  checks.push(check('STORAGE_PRIVATE', 'storage', storage.rows.length > 0 && storage.rows.every((row) => row.public === false), evidence.schema_state.storage))

  const cronRoute = readFileSync(resolve('src/app/api/cron/financeiro/route.ts'), 'utf8')
  const cronServer = readFileSync(resolve('src/lib/financeiro/ingestao/cron.server.ts'), 'utf8')
  const cronOk = cronRoute.includes('CRON_SECRET') && cronServer.includes('resolverIntegracaoPorCapability') && cronRoute.includes('ehDiaUtilAnbima')
  checks.push(check('CRON_CANONICAL', 'cron', cronOk, { route: '/api/cron/financeiro', secret: cronRoute.includes('CRON_SECRET'), capability: cronServer.includes('resolverIntegracaoPorCapability'), anbima: cronRoute.includes('ehDiaUtilAnbima') }))

  const parser = readFileSync(resolve('src/lib/financeiro/ingestao/parser.ts'), 'utf8')
  const provider = readFileSync(resolve('src/lib/financeiro/ingestao/provider.ts'), 'utf8')
  const fallbacks = [...parser.matchAll(/process[.]env[.](RLX_[A-Z0-9_]+)/g), ...provider.matchAll(/process[.]env[.](RLX_[A-Z0-9_]+)/g)].map((item) => item[1])
  checks.push(check('ENV_CANONICAL', 'configuracao', fallbacks.length === 0, { fallbacks_legados: [...new Set(fallbacks)] }, { blocker: false, pending: fallbacks.length > 0, observacao: 'Fallbacks legados devem ter plano de retirada; nao bloqueiam o core nesta fase.' }))

  const golden = await db.query(`select
      (select count(*)::int from public.risco_execucoes where regra_versao='GATE_RISCO_V1') risco_execucoes,
      (select count(*)::int from public.exposicao_execucoes) exposicao_execucoes,
      (select count(*)::int from public.posicao_logistica_execucoes) logistica_execucoes,
      (select count(*)::int from public.matching_execucoes) matching_execucoes`)
  evidence.schema_state.golden = golden.rows[0]
  checks.push(check('GOLDEN_STATE_PRESENT', 'golden', Object.values(golden.rows[0]).every((value) => value > 0), golden.rows[0]))

  await db.query('ROLLBACK')
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  checks.push(check('READ_ONLY_AUDIT_EXECUTION', 'execucao', false, sanitizeError(error)))
} finally {
  await db.end().catch(() => undefined)
}

evidence.summary = {
  pass: checks.filter((item) => item.status === 'PASS').length,
  fail: checks.filter((item) => item.status === 'FAIL').length,
  pending: checks.filter((item) => item.status === 'PENDENTE').length,
  blockers: checks.filter((item) => item.blocker && item.status !== 'PASS').map((item) => item.check_id),
}
const target = resolve('docs/financeiro/production-readiness-p2-6-1-read-only.json')
writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ target, summary: evidence.summary, migrations: evidence.migrations && { local: evidence.migrations.local_total, remote: evidence.migrations.remote_total, missing: evidence.migrations.missing_remote.length } }, null, 2))
if (evidence.summary.blockers.length) process.exitCode = 2
