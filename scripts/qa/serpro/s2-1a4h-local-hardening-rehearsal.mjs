#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import { Client } from 'pg'
import {
  configureDisposableToml,
  redactCommandOutput,
  sanitizedLocalEnvironment,
} from '../../perf9e/clean-room-lib.mjs'

const ROOT = process.cwd()
const CLI = resolve(ROOT, 'node_modules/supabase/dist/supabase.js')
const HARDENING_MIGRATION = '20261028173558_s2_1a4h_serpro_audit_budget_hardening.sql'
const HISTORICAL_LOCAL_ARTIFACTS = [
  ['supabase/migrations/20260925212843_c5_r2_organizational_operations_view.sql', '0557ecf'],
  ['supabase/migrations/20260928130825_c5_r2_reader_dashboard_reports.sql', '0557ecf'],
  ['supabase/migrations/20260928143646_c5_r2_reader_portfolio_surfaces.sql', '0557ecf'],
  ['supabase/migrations/20260928185439_p16_liberar_nf_de_operacao_cancelada.sql', '6a8a38e'],
]
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const evidenceRoot = resolve(
  process.env.LOCALAPPDATA || tmpdir(),
  'bw-antecipa-evidence',
  's2-1a4h-serpro-audit-budget-20261028',
  runId,
)
const stackRoot = resolve(evidenceRoot, 'stack')
const copiedSupabase = resolve(stackRoot, 'supabase')
const portBase = 41000 + (Number(process.pid) % 40) * 10
const ports = {
  apiPort: portBase + 1,
  dbPort: portBase + 2,
  shadowPort: portBase,
  studioPort: portBase + 3,
  mailPort: portBase + 4,
  analyticsPort: portBase + 7,
}
const projectId = `bw_antecipa_s21a4h_${process.pid}_${Date.now()}`
const connection = {
  host: '127.0.0.1',
  port: ports.dbPort,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
  application_name: 's2_1a4h_local_hardening',
}

const ids = {
  gestorA: 'b1100000-0000-4000-8000-000000000001',
  gestorB: 'b1100000-0000-4000-8000-000000000002',
  sessionA: 'b1110000-0000-4000-8000-000000000001',
  factorA: 'b1120000-0000-4000-8000-000000000001',
  fundoA: 'b1200000-0000-4000-8000-000000000001',
  fundoB: 'b1200000-0000-4000-8000-000000000002',
  cedenteUser: 'b1100000-0000-4000-8000-000000000003',
  cedente: 'b1300000-0000-4000-8000-000000000001',
  vinculoA: 'b1400000-0000-4000-8000-000000000001',
  noteA: 'b1500000-0000-4000-8000-000000000001',
  noteB: 'b1500000-0000-4000-8000-000000000002',
  noteC: 'b1500000-0000-4000-8000-000000000003',
  generic1: 'b1500000-0000-4000-8000-000000000011',
  generic2: 'b1500000-0000-4000-8000-000000000012',
  generic3: 'b1500000-0000-4000-8000-000000000013',
  generic4: 'b1500000-0000-4000-8000-000000000014',
}
const keys = {
  A: '35261014224864000100550020000021901123456788',
  B: '35261014224864000100550020000021911123456793',
  C: '35261014224864000100550020000021921123456804',
  generic1: '35261014224864000100550020000021941123456825',
  generic2: '35261014224864000100550020000021951123456830',
  generic3: '35261014224864000100550020000021961123456846',
  generic4: '35261014224864000100550020000021971123456851',
}

const evidence = {
  format: 'BW_ANTECIPA_S2_1A4H_LOCAL_HARDENING_V1',
  startedAt: new Date().toISOString(),
  node: process.version,
  target: 'single-local-disposable-supabase-stack',
  remoteConnectionUsed: false,
  remoteMutationExecuted: false,
  providerCalls: 0,
  commands: [],
  migration: null,
  atomicAudit: null,
  staleBudget: null,
  budgetConcurrency: null,
  acl: null,
  genericQueue: null,
  cleanup: null,
  success: false,
}

let started = false
let admin

try {
  assertLocalOnly()
  prepareDisposableStack()
  const start = runCli([
    'start', '--workdir', stackRoot,
    '--exclude', 'gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor',
  ])
  evidence.commands.push(start)
  assert.equal(start.exitCode, 0, `supabase start falhou: ${tail(start.stderr || start.stdout)}`)
  started = true

  admin = new Client(connection)
  await admin.connect()
  await verifyMigration(admin)
  await seedFixture(admin)
  await proveAtomicCreatedRollback(admin)
  await proveStaleBudgetAndConcurrency(admin)
  await proveAclAndQueuePreservation(admin)
  evidence.success = true
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  if (admin) await admin.end().catch(() => undefined)
  if (started) {
    const stop = runCli(['stop', '--no-backup', '--workdir', stackRoot])
    evidence.commands.push(stop)
    evidence.cleanup = { stackStopped: stop.exitCode === 0, exitCode: stop.exitCode }
  } else {
    evidence.cleanup = { stackStopped: true, exitCode: 0, reason: 'stack_not_started' }
  }
  evidence.finishedAt = new Date().toISOString()
  evidence.payloadSha256 = sha256(JSON.stringify(evidence))
  mkdirSync(evidenceRoot, { recursive: true })
  const reportPath = resolve(evidenceRoot, 'S2_1A4H_LOCAL_HARDENING_REHEARSAL.json')
  writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  if (existsSync(stackRoot)) {
    const expected = resolve(
      process.env.LOCALAPPDATA || tmpdir(),
      'bw-antecipa-evidence',
      's2-1a4h-serpro-audit-budget-20261028',
    )
    assert.ok(resolve(stackRoot).startsWith(expected), 'recusa remover stack fora da raiz dedicada')
    rmSync(stackRoot, { recursive: true, force: true })
  }
  console.log(`S2_1A4H_LOCAL_HARDENING_REHEARSAL=${evidence.success ? 'PASS' : 'FAIL'}`)
  console.log(`REPORT=${reportPath}`)
  if (evidence.error) console.error(evidence.error)
}

function assertLocalOnly() {
  assert.equal(process.version.startsWith('v22.'), true, 'Node 22 obrigatorio')
  assert.ok(existsSync(CLI), 'Supabase CLI local ausente')
  assert.equal(connection.host, '127.0.0.1')
  for (const key of Object.keys(process.env)) {
    if (/^(DATABASE_URL|DIRECT_URL|POSTGRES_URL|SUPABASE_DB_URL)$/i.test(key) && process.env[key]) {
      throw new Error(`variavel de banco recusada: ${key}`)
    }
  }
}

function prepareDisposableStack() {
  assert.ok(!existsSync(stackRoot), 'stack descartavel deve iniciar ausente')
  mkdirSync(stackRoot, { recursive: true })
  cpSync(resolve(ROOT, 'supabase'), copiedSupabase, {
    recursive: true,
    filter: source => !source.includes(`${separator()}supabase${separator()}.temp`),
  })

  const tracked = spawnSync(
    'git',
    ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'supabase/migrations'],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true },
  )
  assert.equal(tracked.status, 0, 'catalogo de migrations rastreadas indisponivel')
  for (const path of tracked.stdout.split(/\r?\n/u).filter(Boolean)) {
    const canonical = spawnSync('git', ['show', `HEAD:${path}`], {
      cwd: ROOT,
      encoding: null,
      windowsHide: true,
    })
    assert.equal(canonical.status, 0, `migration canonica nao recuperada: ${path}`)
    writeFileSync(resolve(stackRoot, path), canonical.stdout)
  }

  // A unica migration nova ainda nao esta em HEAD nesta prova pre-commit.
  cpSync(
    resolve(ROOT, 'supabase/migrations', HARDENING_MIGRATION),
    resolve(copiedSupabase, 'migrations', HARDENING_MIGRATION),
  )

  for (const [path, revision] of HISTORICAL_LOCAL_ARTIFACTS) {
    const recovered = spawnSync('git', ['show', `${revision}:${path}`], {
      cwd: ROOT,
      encoding: null,
      windowsHide: true,
    })
    assert.equal(recovered.status, 0, `artefato historico ausente: ${path}`)
    writeFileSync(resolve(stackRoot, path), recovered.stdout)
  }

  const configPath = resolve(copiedSupabase, 'config.toml')
  writeFileSync(
    configPath,
    configureDisposableToml(readFileSync(configPath, 'utf8'), { projectId, ...ports }),
    'utf8',
  )
}

async function verifyMigration(db) {
  const version = HARDENING_MIGRATION.slice(0, 14)
  const applied = await db.query(`
    SELECT count(*)::integer count
      FROM supabase_migrations.schema_migrations
     WHERE version = $1
  `, [version])
  assert.equal(applied.rows[0].count, 1)
  const source = readFileSync(resolve(ROOT, 'supabase/migrations', HARDENING_MIGRATION))
  evidence.migration = { version, appliedExactlyOnce: true, sha256: sha256(source) }
}

async function seedFixture(db) {
  await db.query(`
    INSERT INTO auth.users (id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES
      ('${ids.gestorA}','s21a4h-gestor-a@example.invalid','{}','{"nome_completo":"S2.1A.4H Gestor A"}',now(),now()),
      ('${ids.gestorB}','s21a4h-gestor-b@example.invalid','{}','{"nome_completo":"S2.1A.4H Gestor B"}',now(),now()),
      ('${ids.cedenteUser}','s21a4h-cedente@example.invalid','{}','{"nome_completo":"S2.1A.4H Cedente"}',now(),now());

    INSERT INTO public.profiles (id,role,nome_completo,email,status) VALUES
      ('${ids.gestorA}','gestor','S2.1A.4H Gestor A','s21a4h-gestor-a@example.invalid','ativo'),
      ('${ids.gestorB}','gestor','S2.1A.4H Gestor B','s21a4h-gestor-b@example.invalid','ativo'),
      ('${ids.cedenteUser}','cedente','S2.1A.4H Cedente','s21a4h-cedente@example.invalid','ativo')
    ON CONFLICT (id) DO UPDATE SET role=excluded.role,status=excluded.status;

    INSERT INTO public.fundos (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
    VALUES
      ('${ids.fundoA}','Fundo S2.1A.4H A','98000000000182','Admin A','98000000000263','Gestora A','98000000000344',true),
      ('${ids.fundoB}','Fundo S2.1A.4H B','99000000000127','Admin B','99000000000208','Gestora B','99000000000399',true);
    INSERT INTO public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal)
    VALUES
      ('${ids.gestorA}','${ids.fundoA}','gestor','ativo',true),
      ('${ids.gestorB}','${ids.fundoB}','gestor','ativo',true);
    INSERT INTO public.cedentes (id,user_id,cnpj,razao_social,status,fundo_id)
    VALUES ('${ids.cedente}','${ids.cedenteUser}','14224864000100','Cedente Sintetico S2.1A.4H','ativo','${ids.fundoA}');
    INSERT INTO public.cedente_fundos (id,cedente_id,fundo_id,status)
    VALUES ('${ids.vinculoA}','${ids.cedente}','${ids.fundoA}','ativo');

    INSERT INTO auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at)
    VALUES ('${ids.factorA}','${ids.gestorA}','S2.1A.4H local','totp','verified',now(),now());
    INSERT INTO auth.sessions(id,user_id,aal,factor_id,created_at,updated_at)
    VALUES ('${ids.sessionA}','${ids.gestorA}','aal2','${ids.factorA}',now(),now());
    INSERT INTO public.sessoes_elevadas(user_id,session_id,metodo,factor_id,elevada_em,expira_em)
    VALUES ('${ids.gestorA}','${ids.sessionA}','totp','${ids.factorA}',now(),now()+interval '1 hour');
  `)

  const notes = [
    [ids.noteA, '3100', keys.A, 'a'],
    [ids.noteB, '3101', keys.B, 'b'],
    [ids.noteC, '3102', keys.C, 'c'],
    [ids.generic1, '3111', keys.generic1, '1'],
    [ids.generic2, '3112', keys.generic2, '2'],
    [ids.generic3, '3113', keys.generic3, '3'],
    [ids.generic4, '3114', keys.generic4, '4'],
  ]
  for (const [id, number, key, fingerprint] of notes) {
    await db.query(`
      INSERT INTO public.notas_fiscais (
        id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,chave_acesso,
        data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,
        cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,
        status,tipo_documento_fiscal,fiscal_proveniencia,valor_liquido_origem,vencimento_origem
      ) VALUES ($1,$2,$3,$4,$5,'2',$6,'2026-10-20','2026-11-20',
        '14224864000100','Cedente Sintetico','12345678000190','Sacado Sintetico',
        100,100,'submetida','NFE',jsonb_build_object('sha256',$7::text),NULL,NULL)
    `, [id, ids.cedente, ids.vinculoA, ids.fundoA, number, key, fingerprint.repeat(64)])
  }

  await db.query(`
    UPDATE public.nfe_fiscal_consultas
       SET capability_state='ENABLED', status='PENDENTE', proxima_tentativa_em=NULL,
           lease_token=NULL, lease_ate=NULL
     WHERE nota_fiscal_id IN (
       '${ids.noteA}','${ids.noteB}','${ids.noteC}',
       '${ids.generic1}','${ids.generic2}','${ids.generic3}','${ids.generic4}'
     );
    UPDATE public.nfe_fiscal_provider_state
       SET capability_state='ENABLED', circuit_state='CLOSED', daily_budget=10,
           calls_today=0, budget_date=current_date, consecutive_failures=0,
           circuit_open_until=NULL
     WHERE provider='SERPRO';
  `)
}

async function proveAtomicCreatedRollback(db) {
  const consultaA = await consultaFor(db, ids.noteA)
  const service = await openServiceClient('atomic_success')
  let authorizationA
  try {
    authorizationA = await authorize(service, consultaA, keys.A, 'a'.repeat(64))
  } finally {
    await service.end()
  }
  const successful = (await db.query(`
    SELECT a.id,
           count(l.id)::integer audit_count,
           bool_and(l.dados_depois->>'authorization_id'=a.id::text) correlated
      FROM private.nfe_fiscal_pilot_authorizations a
      LEFT JOIN public.logs_auditoria l
        ON l.tipo_evento='SERPRO_PILOT_AUTHORIZATION_CREATED'
       AND l.entidade_id=a.consulta_id
     WHERE a.id=$1
     GROUP BY a.id
  `, [authorizationA])).rows[0]
  assert.equal(successful.audit_count, 1)
  assert.equal(successful.correlated, true)

  await db.query(`
    CREATE OR REPLACE FUNCTION public.s2_1a4h_reject_created_audit()
    RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
    BEGIN
      IF NEW.tipo_evento='SERPRO_PILOT_AUTHORIZATION_CREATED' THEN
        RAISE EXCEPTION 'synthetic audit failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER s2_1a4h_reject_created_audit
    BEFORE INSERT ON public.logs_auditoria
    FOR EACH ROW EXECUTE FUNCTION public.s2_1a4h_reject_created_audit();
  `)

  const consultaB = await consultaFor(db, ids.noteB)
  const failing = await openServiceClient('atomic_failure')
  let caught
  try {
    await authorize(failing, consultaB, keys.B, 'b'.repeat(64))
  } catch (error) {
    caught = error
  } finally {
    await failing.end()
  }
  assert.equal(caught?.code, 'P0001')
  const orphan = await db.query(`
    SELECT
      (SELECT count(*)::integer FROM private.nfe_fiscal_pilot_authorizations WHERE consulta_id=$1) authorizations,
      (SELECT count(*)::integer FROM public.logs_auditoria WHERE entidade_id=$1 AND tipo_evento='SERPRO_PILOT_AUTHORIZATION_CREATED') audits
  `, [consultaB.id])
  assert.deepEqual(orphan.rows[0], { authorizations: 0, audits: 0 })

  await db.query(`
    DROP TRIGGER s2_1a4h_reject_created_audit ON public.logs_auditoria;
    DROP FUNCTION public.s2_1a4h_reject_created_audit();
  `)
  evidence.atomicAudit = {
    successCreatedExactlyOnce: true,
    authorizationCorrelated: true,
    syntheticAuditFailureSqlstate: caught.code,
    orphanAuthorizationsAfterFailure: orphan.rows[0].authorizations,
    orphanCreatedAuditsAfterFailure: orphan.rows[0].audits,
  }
}

async function proveStaleBudgetAndConcurrency(db) {
  const consultaB = await consultaFor(db, ids.noteB)
  await db.query(`
    UPDATE public.nfe_fiscal_provider_state
       SET daily_budget=1,calls_today=999,budget_date=current_date-1,
           capability_state='ENABLED',circuit_state='CLOSED'
     WHERE provider='SERPRO'
  `)
  const service = await openServiceClient('stale_budget')
  let authorizationB
  try {
    authorizationB = await authorize(service, consultaB, keys.B, 'c'.repeat(64))
  } finally {
    await service.end()
  }
  assert.ok(authorizationB)

  const genericIds = [ids.generic1, ids.generic2, ids.generic3, ids.generic4]
  const queueBefore = await queueState(db, genericIds)
  const left = await openServiceClient('claim_left')
  const right = await openServiceClient('claim_right')
  let claims
  try {
    claims = await Promise.all([left, right].map(client => claim(client, {
      authorizationId: authorizationB,
      consultaId: consultaB.id,
      noteId: ids.noteB,
      key: keys.B,
      nonce: 'c'.repeat(64),
    })))
  } finally {
    await Promise.all([left.end(), right.end()])
  }
  assert.deepEqual(claims.map(rows => rows.length).sort(), [0, 1])
  const provider = (await db.query(`
    SELECT calls_today,budget_date=current_date budget_is_today
      FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO'
  `)).rows[0]
  assert.deepEqual(provider, { calls_today: 1, budget_is_today: true })

  const consultaC = await consultaFor(db, ids.noteC)
  const exhausted = await openServiceClient('budget_exhausted')
  let caught
  try {
    await authorize(exhausted, consultaC, keys.C, 'd'.repeat(64))
  } catch (error) {
    caught = error
  } finally {
    await exhausted.end()
  }
  assert.equal(caught?.code, '55000')
  const rejectedState = await db.query(`
    SELECT
      (SELECT count(*)::integer FROM private.nfe_fiscal_pilot_authorizations WHERE consulta_id=$1) authorizations,
      (SELECT count(*)::integer FROM public.logs_auditoria WHERE entidade_id=$1 AND tipo_evento='SERPRO_PILOT_AUTHORIZATION_CREATED') audits
  `, [consultaC.id])
  assert.deepEqual(rejectedState.rows[0], { authorizations: 0, audits: 0 })

  const queueAfter = await queueState(db, genericIds)
  assert.deepEqual(queueAfter, queueBefore)
  evidence.staleBudget = {
    previousDateCalls: 999,
    effectiveCallsBeforeClaim: 0,
    authorizationAllowed: true,
    callsAfterClaim: provider.calls_today,
    budgetDateRolledForwardOnClaim: provider.budget_is_today,
    exhaustedAuthorizationRejected: true,
    rejectedAuthorizationRows: rejectedState.rows[0].authorizations,
    rejectedCreatedAudits: rejectedState.rows[0].audits,
  }
  evidence.budgetConcurrency = {
    concurrentClaims: 2,
    successfulClaims: 1,
    rejectedClaims: 1,
    budgetReservations: provider.calls_today,
  }
  evidence.genericQueue = { before: queueBefore, after: queueAfter, unchanged: true }
}

async function proveAclAndQueuePreservation(db) {
  const signature = 'public.nfe_fiscal_pilot_authorize(uuid,uuid,uuid,text,text,uuid,uuid,timestamp with time zone)'
  const acl = (await db.query(`
    SELECT
      has_function_privilege('anon',$1,'EXECUTE') anon,
      has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
      has_function_privilege('service_role',$1,'EXECUTE') service_role,
      n.nspname schema_name,
      pg_get_userbyid(p.proowner) owner,
      p.prosecdef security_definer,
      EXISTS (
        SELECT 1 FROM unnest(p.proconfig) config
         WHERE config LIKE 'search_path=%'
           AND config LIKE '%""%'
      ) fixed_empty_search_path
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.oid=$1::regprocedure
  `, [signature])).rows[0]
  assert.deepEqual(acl, {
    anon: false,
    authenticated: false,
    service_role: true,
    schema_name: 'public',
    owner: 'postgres',
    security_definer: true,
    fixed_empty_search_path: true,
  })
  evidence.acl = acl
}

async function consultaFor(db, noteId) {
  const row = (await db.query(`
    SELECT c.id,c.snapshot_id,c.fundo_id,c.nota_fiscal_id
      FROM public.nfe_fiscal_consultas c
     WHERE c.nota_fiscal_id=$1
  `, [noteId])).rows[0]
  assert.ok(row, `consulta ausente para ${noteId}`)
  return row
}

async function openServiceClient(label) {
  const client = new Client({ ...connection, application_name: `s2_1a4h_${label}` })
  await client.connect()
  await client.query('SET ROLE service_role')
  await client.query(`
    SELECT set_config('request.jwt.claims',$1,false),
           set_config('request.jwt.claim.role','service_role',false)
  `, [JSON.stringify({ role: 'service_role' })])
  return client
}

async function authorize(client, consultation, key, nonce) {
  const row = (await client.query(`
    SELECT public.nfe_fiscal_pilot_authorize(
      $1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '3 minutes'
    ) authorization_id
  `, [
    consultation.id,
    ids.fundoA,
    consultation.nota_fiscal_id,
    key,
    nonce,
    ids.gestorA,
    ids.sessionA,
  ])).rows[0]
  assert.ok(row?.authorization_id)
  return row.authorization_id
}

async function claim(client, input) {
  return (await client.query(`
    SELECT * FROM public.nfe_fiscal_pilot_claim($1,$2,$3,$4,$5,$6,$7)
  `, [
    input.authorizationId,
    input.consultaId,
    ids.fundoA,
    input.noteId,
    input.key,
    input.nonce,
    ids.gestorA,
  ])).rows
}

async function queueState(db, noteIds) {
  return (await db.query(`
    SELECT nota_fiscal_id,status,tentativas,lease_token,lease_ate,ultima_chamada_em
      FROM public.nfe_fiscal_consultas
     WHERE nota_fiscal_id = ANY($1::uuid[])
     ORDER BY nota_fiscal_id
  `, [noteIds])).rows
}

function runCli(args) {
  const startedAt = Date.now()
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: sanitizedLocalEnvironment(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 1_200_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  return {
    executable: `${basename(process.execPath)} supabase`,
    args,
    exitCode: result.status ?? (result.error ? 1 : 0),
    durationMs: Date.now() - startedAt,
    stdout: redactCommandOutput(result.stdout || ''),
    stderr: redactCommandOutput(result.stderr || result.error?.message || ''),
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function tail(value, max = 6000) {
  return String(value).slice(-max)
}

function separator() {
  return process.platform === 'win32' ? '\\' : '/'
}
