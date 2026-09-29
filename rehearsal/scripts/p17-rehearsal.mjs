#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { Client } from 'pg'
import { runP17Scenarios } from './p17-scenarios.mjs'

const releaseRoot = process.cwd()
const baselineRoot = resolve(process.env.P17_BASELINE_ROOT || '../bw_antecipa_c2_1_r2_prod_docker_baseline')
const cli = resolve(releaseRoot, 'node_modules/supabase/dist/supabase.js')
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const workdir = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'p17-rehearsal', runId)
const sourceSupabase = resolve(baselineRoot, 'supabase')
const targetSupabase = resolve(workdir, 'supabase')
const dbUrl = 'postgresql://postgres:postgres@127.0.0.1:58322/postgres'
const projectId = `bw_antecipa_p17_${runId.replace(/[^0-9]/g, '').slice(0, 14)}`
const migrationFiles = [
  '20260928120000_c2_1_r2_taxa_consultor_validacao_gestor.sql',
  '20260928183000_c2_1_r2_taxa_consultor_livre.sql',
  '20260928193000_c2_1_r2_gestor_mantem_taxa_livre.sql',
  '20260929141740_p17_360_dias_corridos.sql',
]

const expectedProductionPreflight = {
  aprovar_operacao_atomica_financeiro_v1: { bodyMd5Lf: 'f5939f1165404ab089ccbba60f2ec604', securityDefiner: true, volatility: 'v', parallel: 'u', strict: false },
  aprovar_operacao_com_risco_atomica: { bodyMd5Lf: '7f09ac85a806a42499b85f415278c363', securityDefiner: true, volatility: 'v', parallel: 'u', strict: false },
  operacao_status_reserva_nf: { bodyMd5Lf: '450a04a7425829928bb59cc0e204e910', securityDefiner: false, volatility: 'i', parallel: 's', strict: true },
}

const evidence = {
  metadata: {
    format: 'p17-production-like-docker-rehearsal-v1',
    startedAt: new Date().toISOString(),
    target: 'local-disposable-docker',
    baselineSha: '83ece9c676a4f39ff130a8885847735c8b1da17d',
    p16BaselineCommit: '6a8a38e',
    productionProjectRef: 'wwsndnuvnjuabpbjwlck',
    remoteConnectionUsed: false,
    remoteMutationExecuted: false,
    syntheticDataOnly: true,
    projectId,
    workdir,
  },
  commands: [],
  preflight: null,
  migrations: [],
  pgTap: [],
  concurrency: null,
  postflight: null,
  success: false,
}

let started = false
let client

try {
  console.log('P17: starting isolated local DB')
  assertLocalOnly()
  prepareWorkdir()
  const env = sanitizedEnvironment()
  const start = runCli(['start', '--workdir', workdir, '--exclude', 'gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], env)
  evidence.commands.push(start)
  if (start.exitCode !== 0) throw new Error(`supabase start falhou: ${tail(start.stderr || start.stdout)}`)
  started = true

  client = new Client({ connectionString: dbUrl, application_name: 'c2_1_r2_prod_docker_rehearsal' })
  await client.connect()

  evidence.preflight = await collectPreflight(client)
  assertProductionEquivalentPreflight(evidence.preflight)

  const countsBefore = await collectCounts(client)
  for (const filename of migrationFiles) {
    const path = resolve(releaseRoot, 'supabase/migrations', filename)
    const sql = readFileSync(path, 'utf8')
    const [version, ...nameParts] = filename.replace(/\.sql$/, '').split('_')
    const name = nameParts.join('_')
    const startedAt = Date.now()
    console.log(`Applying ${filename}`)
    await client.query(sql)
    await client.query(
      `insert into supabase_migrations.schema_migrations(version, statements, name)
       values ($1, $2, $3)`,
      [version, [sql], name],
    )
    evidence.migrations.push({ filename, version, name, sha256: sha256(sql), durationMs: Date.now() - startedAt, applied: true })
  }

  evidence.postflight = await collectPostflight(client)
  const countsAfterMigrations = await collectCounts(client)
  evidence.postflight.countsBefore = countsBefore
  evidence.postflight.countsAfterMigrations = countsAfterMigrations
  assertPostflight(evidence.postflight)

  await client.query('create extension if not exists pgtap with schema extensions')
  await client.query('set search_path = public, extensions')

  for (const filename of ['c2_1_r2_taxa_consultor.test.sql', 'c2_1_r2_fluxo_taxa.test.sql']) {
    const path = resolve(releaseRoot, 'supabase/tests', filename)
    const sql = readFileSync(path, 'utf8').replace(/^\\set ON_ERROR_STOP on\s*/m, '')
    const result = await client.query(sql)
    const lines = collectTapLines(result)
    const failed = lines.filter((line) => /^not ok\b/i.test(line))
    const passed = lines.filter((line) => /^ok\b/i.test(line))
    const plan = lines.find((line) => /^1\.\./.test(line)) ?? null
    evidence.pgTap.push({ filename, plan, passed: passed.length, failed })
    if (failed.length) throw new Error(`${filename} falhou: ${failed.join(' | ')}`)
  }

  evidence.p17 = await runP17Scenarios(client, releaseRoot)
  evidence.concurrency = await runConcurrencyProof()
  if (!evidence.concurrency.passed) throw new Error(`Prova de concorrencia falhou: ${JSON.stringify(evidence.concurrency)}`)

  evidence.success = true
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  if (client) await client.end().catch(() => undefined)
  if (started) {
    const stop = runCli(['stop', '--no-backup', '--workdir', workdir], sanitizedEnvironment())
    evidence.commands.push(stop)
  }
  evidence.metadata.finishedAt = new Date().toISOString()
  evidence.metadata.payloadSha256 = sha256(JSON.stringify(evidence))
  mkdirSync(resolve(releaseRoot, 'rehearsal/tmp'), { recursive: true })
  const reportPath = resolve(releaseRoot, 'rehearsal/tmp/P17_DOCKER_REHEARSAL.json')
  writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(`P17_REHEARSAL=${evidence.success ? 'PASS' : 'FAIL'}`)
  console.log(`report=${reportPath}`)
  if (evidence.error) console.error(evidence.error)
}

function assertLocalOnly() {
  if (!existsSync(cli)) throw new Error('Supabase CLI local nao encontrado.')
  if (!existsSync(sourceSupabase)) throw new Error('Baseline local main+P16 nao encontrado.')
  for (const key of Object.keys(process.env)) {
    if (/^(DATABASE_URL|SUPABASE_DB_URL|REHEARSAL_PRODUCTION_DB_URL)$/i.test(key) && process.env[key]) {
      throw new Error(`Variavel remota recusada no rehearsal: ${key}`)
    }
  }
}

function prepareWorkdir() {
  if (existsSync(workdir)) throw new Error('Diretorio de rehearsal deve ser novo.')
  mkdirSync(workdir, { recursive: true })
  cpSync(sourceSupabase, targetSupabase, {
    recursive: true,
    filter: (source) => !source.includes(`${process.platform === 'win32' ? '\\' : '/'}supabase${process.platform === 'win32' ? '\\' : '/'}\.temp`),
  })
  const configPath = resolve(targetSupabase, 'config.toml')
  let config = readFileSync(configPath, 'utf8')
    .replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`)
    .replace(/^port\s*=\s*54321$/m, 'port = 58321')
    .replace(/^port\s*=\s*54322$/m, 'port = 58322')
    .replace(/^shadow_port\s*=\s*54320$/m, 'shadow_port = 58320')
    .replace(/^port\s*=\s*54329$/m, 'port = 58329')
    .replace(/^port\s*=\s*54323$/m, 'port = 58323')
    .replace(/^port\s*=\s*54324$/m, 'port = 58324')
    .replace(/^port\s*=\s*54327$/m, 'port = 58327')
  config = config.replace(/(\[db\.seed\][\s\S]*?enabled\s*=\s*)true/, '$1false')
  writeFileSync(configPath, config, 'utf8')
}

function sanitizedEnvironment() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(DATABASE_URL|SUPABASE_DB_URL|SUPABASE_ACCESS_TOKEN|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL|REHEARSAL_PRODUCTION_DB_URL)$/i.test(key)) delete env[key]
  }
  return env
}

function runCli(args, env) {
  const startedAt = Date.now()
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: releaseRoot,
    env,
    encoding: 'utf8',
    timeout: 900_000,
    windowsHide: true,
  })
  return {
    executable: basename(cli),
    args,
    exitCode: result.status ?? 1,
    durationMs: Date.now() - startedAt,
    stdout: redact(result.stdout ?? ''),
    stderr: redact(result.stderr ?? result.error?.message ?? ''),
  }
}

async function collectPreflight(db) {
  const functions = await db.query(`
    select p.proname, md5(replace(p.prosrc,E'\\r','')) body_md5_lf, p.prosecdef, p.provolatile, p.proparallel, p.proisstrict, p.proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname in ('aprovar_operacao_atomica_financeiro_v1','aprovar_operacao_com_risco_atomica'))
       or (n.nspname='private' and p.proname='operacao_status_reserva_nf')
    order by p.proname
  `)
  const columns = await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='operacoes' and column_name like '%proposta%' order by 1`)
  const migrations = await db.query(`select version,name from supabase_migrations.schema_migrations where version in ('20260928120000','20260928183000','20260928193000') order by version`)
  return { functions: functions.rows, proposalColumns: columns.rows, c21Migrations: migrations.rows }
}

function assertProductionEquivalentPreflight(preflight) {
  if (preflight.proposalColumns.length || preflight.c21Migrations.length) throw new Error('Baseline local ja contem C2.1 parcial.')
  const byName = Object.fromEntries(preflight.functions.map((item) => [item.proname, item]))
  for (const [name, expected] of Object.entries(expectedProductionPreflight)) {
    const actual = byName[name]
    if (!actual
      || actual.body_md5_lf !== expected.bodyMd5Lf
      || actual.prosecdef !== expected.securityDefiner
      || actual.provolatile !== expected.volatility
      || actual.proparallel !== expected.parallel
      || actual.proisstrict !== expected.strict
      || !Array.isArray(actual.proconfig)
      || !actual.proconfig.includes('search_path=""')) {
      throw new Error(`Baseline local diverge de producao em ${name}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
    }
  }
}

async function collectPostflight(db) {
  const columns = await db.query(`
    select column_name,data_type,is_nullable
    from information_schema.columns
    where table_schema='public' and table_name='operacoes'
      and column_name in ('taxa_proposta_consultor','taxa_proposta_por','taxa_proposta_consultor_id','taxa_proposta_em','calculo_proposta_memoria')
    order by column_name
  `)
  const migrations = await db.query(`
    select version,name,count(*)::int occurrences
    from supabase_migrations.schema_migrations
    where version in ('20260928120000','20260928183000','20260928193000')
    group by version,name order by version
  `)
  const functions = await db.query(`
    select p.proname,pg_get_function_identity_arguments(p.oid) args,p.prosecdef,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
      md5(pg_get_functiondef(p.oid)) definition_md5
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'proteger_proposta_taxa_consultor','solicitar_operacao_antecipacao_consultor_atomica',
      'solicitar_operacao_antecipacao_cedente_atomica','aprovar_operacao_com_risco_atomica',
      'aprovar_operacao_atomica_financeiro_v1'
    ) order by p.proname,args
  `)
  const trigger = await db.query(`select tgname,tgenabled from pg_trigger where tgrelid='public.operacoes'::regclass and tgname='operacoes_proteger_proposta_taxa_consultor'`)
  const p14p16 = await db.query(`select
    private.operacao_status_reserva_nf('reprovada') reprovada_reserva,
    private.operacao_status_reserva_nf('cancelada') cancelada_reserva,
    private.operacao_status_reserva_nf('aprovada') aprovada_reserva`)
  return { columns: columns.rows, migrations: migrations.rows, functions: functions.rows, trigger: trigger.rows, p14p16: p14p16.rows[0] }
}

function assertPostflight(postflight) {
  if (postflight.columns.length !== 5) throw new Error(`Colunas C2.1 incompletas: ${postflight.columns.length}`)
  if (postflight.migrations.length !== 3 || postflight.migrations.some((item) => item.occurrences !== 1)) throw new Error('History C2.1 nao ficou exato.')
  if (postflight.trigger.length !== 1 || postflight.trigger[0].tgenabled !== 'O') throw new Error('Trigger de imutabilidade ausente ou desabilitado.')
  const consultant = postflight.functions.find((item) => item.proname === 'solicitar_operacao_antecipacao_consultor_atomica')
  const cedente = postflight.functions.find((item) => item.proname === 'solicitar_operacao_antecipacao_cedente_atomica')
  const guard = postflight.functions.find((item) => item.proname === 'proteger_proposta_taxa_consultor')
  if (!consultant?.prosecdef || consultant.anon_execute || !consultant.authenticated_execute) throw new Error('ACL do wrapper Consultor divergiu.')
  if (!cedente?.prosecdef || cedente.anon_execute || !cedente.authenticated_execute) throw new Error('ACL do wrapper Cedente divergiu.')
  if (guard?.anon_execute || guard?.authenticated_execute) throw new Error('Trigger function ficou executavel por cliente.')
  const reserve = postflight.p14p16
  if (reserve.reprovada_reserva !== false || reserve.cancelada_reserva !== false || reserve.aprovada_reserva !== true) {
    throw new Error(`P14/P16 divergiu: ${JSON.stringify(reserve)}`)
  }
  if (JSON.stringify(postflight.countsBefore) !== JSON.stringify(postflight.countsAfterMigrations)) {
    throw new Error(`Migration gerou DML inesperado: before=${JSON.stringify(postflight.countsBefore)} after=${JSON.stringify(postflight.countsAfterMigrations)}`)
  }
}

async function collectCounts(db) {
  const result = await db.query(`select
    (select count(*)::int from public.operacoes) operacoes,
    (select count(*)::int from public.notas_fiscais) notas_fiscais,
    (select count(*)::int from public.logs_auditoria) logs_auditoria,
    (select count(*)::int from public.eventos_dominio) eventos_dominio,
    (select count(*)::int from public.operacao_calculo_nfs) operacao_calculo_nfs`)
  return result.rows[0]
}

function collectTapLines(result) {
  const results = Array.isArray(result) ? result : [result]
  const lines = []
  for (const item of results) {
    for (const row of item?.rows ?? []) {
      for (const value of Object.values(row)) if (typeof value === 'string' && /^(?:ok|not ok|1\.\.)/.test(value)) lines.push(value)
    }
  }
  return lines
}

async function runConcurrencyProof() {
  const seed = new Client({ connectionString: dbUrl, application_name: 'c2_1_r2_concurrency_seed' })
  await seed.connect()
  try {
    const source = readFileSync(resolve(releaseRoot, 'supabase/tests/c2_1_r2_fluxo_taxa.test.sql'), 'utf8')
    const setup = source.match(/DO \$setup\$[\s\S]*?\$setup\$;/)?.[0]
    if (!setup) throw new Error('Setup pgTAP nao encontrado.')
    await seed.query(setup)
    await seed.query(`select set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',false)`)
    const created = await seed.query(`select public.solicitar_operacao_antecipacao_consultor_atomica(
      '23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
      '26000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001',1,
      '{"calculo_financeiro":{"metodo":"TRINTA_360","versao_motor":1}}'::jsonb,repeat('a',64),false,'dispensado',
      array['2a000000-0000-4000-8000-000000000001']::uuid[],2.50,repeat('9',64),null)`)
    const operationId = created.rows[0].solicitar_operacao_antecipacao_consultor_atomica.operacao_id
    await seed.query(`insert into public.risco_execucoes(
      id,fundo_id,operacao_id,escopo,origem,politica_operacional_versao_id,data_operacional,overlay_as_of,
      operacao_updated_at_snapshot,taxa_desconto_snapshot,aplicavel,status_tecnico,decisao,assinatura_inputs,criado_por)
      select v.id,'22000000-0000-4000-8000-000000000001'::uuid,o.id,'OPERACAO','APROVACAO_OPERACAO',
        o.politica_operacional_versao_id,current_date,now(),o.updated_at,v.taxa,false,'NAO_APLICAVEL',null,v.assinatura,
        '21000000-0000-4000-8000-000000000004'::uuid
      from public.operacoes o cross join (values
        ('2b000000-0000-4000-8000-000000000011'::uuid,2.50::numeric,repeat('a',64)),
        ('2b000000-0000-4000-8000-000000000012'::uuid,2.35::numeric,repeat('b',64))
      ) v(id,taxa,assinatura) where o.id=$1`, [operationId])

    const contenders = [
      { risk: '2b000000-0000-4000-8000-000000000011', rate: '2.50', signature: 'a'.repeat(64) },
      { risk: '2b000000-0000-4000-8000-000000000012', rate: '2.35', signature: 'b'.repeat(64) },
    ]
    const outcomes = await Promise.all(contenders.map(async (item) => {
      const db = new Client({ connectionString: dbUrl, application_name: `c2_1_r2_contender_${item.rate}` })
      await db.connect()
      try {
        await db.query(`select set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000004',false)`)
        const result = await db.query('select public.aprovar_operacao_com_risco_atomica($1,$2,$3,$4) result', [operationId, item.rate, item.risk, item.signature])
        return { rate: item.rate, outcome: 'winner', result: result.rows[0].result }
      } catch (error) {
        return { rate: item.rate, outcome: 'loser', message: error.message }
      } finally {
        await db.end()
      }
    }))
    const final = (await seed.query(`select taxa_proposta_consultor::text proposal,taxa_desconto::text final_rate,status::text,
      (select count(*)::int from public.logs_auditoria l where l.entidade_id=o.id and l.tipo_evento in ('TAXA_MANTIDA_GESTOR','TAXA_ALTERADA_GESTOR')) decisions
      from public.operacoes o where id=$1`, [operationId])).rows[0]
    const winners = outcomes.filter((item) => item.outcome === 'winner')
    const losers = outcomes.filter((item) => item.outcome === 'loser')
    const passed = winners.length === 1 && losers.length === 1 && final.proposal === '2.50' && final.final_rate === winners[0].rate && final.status === 'aprovada' && final.decisions === 1
    return { passed, outcomes, final }
  } finally {
    await seed.end()
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function redact(value) {
  return String(value).replace(/postgresql:\/\/[^\s]+/gi, '[REDACTED_DB_URL]').slice(-12000)
}

function tail(value) {
  return String(value).slice(-4000)
}
