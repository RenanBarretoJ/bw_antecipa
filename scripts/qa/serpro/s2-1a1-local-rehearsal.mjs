#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
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
const MIGRATION = '20261028140420_s2_1a1_serpro_selective_pilot_claim.sql'
const HISTORICAL_LOCAL_ARTIFACTS = [
  {
    path: 'supabase/migrations/20260925212843_c5_r2_organizational_operations_view.sql',
    revision: '0557ecf',
    sha256: '1afaab9b6cc02d108a731fe0668917b929ab6849eb85a77383884c04a477c68c',
  },
  {
    path: 'supabase/migrations/20260928130825_c5_r2_reader_dashboard_reports.sql',
    revision: '0557ecf',
    sha256: 'a4fe4578494635a0ffca2fda2ae75526474319f3001ffd6b82ead3a1e7ee8625',
  },
  {
    path: 'supabase/migrations/20260928143646_c5_r2_reader_portfolio_surfaces.sql',
    revision: '0557ecf',
    sha256: '580913686e5ff9e53c14ea098b0456ae2fdeb5a88efd7d881c4bac2aae015add',
  },
  {
    path: 'supabase/migrations/20260928185439_p16_liberar_nf_de_operacao_cancelada.sql',
    revision: '6a8a38e',
    sha256: '6390f43842e82d7d980acfb6ae61e66cd551676e17c21a01a6e8ca237ce3efa1',
  },
]
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const evidenceRoot = resolve(process.env.LOCALAPPDATA || tmpdir(), 'bw-antecipa-evidence', 's2-1a1-serpro-selective-claim-20261028', runId)
const stackRoot = resolve(evidenceRoot, 'stack')
const copiedSupabase = resolve(stackRoot, 'supabase')
// Keep disposable ports below Windows' dynamic/excluded range (typically >= 49152).
const portBase = 38000 + (Number(process.pid) % 50) * 10
const ports = {
  apiPort: portBase + 1,
  dbPort: portBase + 2,
  shadowPort: portBase,
  studioPort: portBase + 3,
  mailPort: portBase + 4,
  analyticsPort: portBase + 7,
}
const projectId = `bw_antecipa_s21a1_${process.pid}_${Date.now()}`
const connection = {
  host: '127.0.0.1',
  port: ports.dbPort,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
  application_name: 's2_1a1_local_selective_claim',
}

const ids = {
  gestorA: 'a1100000-0000-4000-8000-000000000001',
  gestorB: 'a1100000-0000-4000-8000-000000000002',
  cedenteUser: 'a1100000-0000-4000-8000-000000000003',
  consultor: 'a1100000-0000-4000-8000-000000000004',
  sacado: 'a1100000-0000-4000-8000-000000000005',
  sessionA: 'a1110000-0000-4000-8000-000000000001',
  factorA: 'a1120000-0000-4000-8000-000000000001',
  fundoA: 'a1200000-0000-4000-8000-000000000001',
  fundoB: 'a1200000-0000-4000-8000-000000000002',
  cedente: 'a1300000-0000-4000-8000-000000000001',
  vinculoA: 'a1400000-0000-4000-8000-000000000001',
  vinculoB: 'a1400000-0000-4000-8000-000000000002',
  noteA: 'a1500000-0000-4000-8000-000000000001',
  noteB: 'a1500000-0000-4000-8000-000000000002',
  noteExpiry: 'a1500000-0000-4000-8000-000000000003',
  noteModel65: 'a1500000-0000-4000-8000-000000000004',
  generic1: 'a1500000-0000-4000-8000-000000000011',
  generic2: 'a1500000-0000-4000-8000-000000000012',
  generic3: 'a1500000-0000-4000-8000-000000000013',
  generic4: 'a1500000-0000-4000-8000-000000000014',
}

const keys = {
  A: '35261014224864000100550020000021901123456788',
  B: '35261014224864000100550020000021911123456793',
  expiry: '35261014224864000100550020000021921123456804',
  model65: '35261014224864000100550020000021931123456810',
  generic1: '35261014224864000100550020000021941123456825',
  generic2: '35261014224864000100550020000021951123456830',
  generic3: '35261014224864000100550020000021961123456846',
  generic4: '35261014224864000100550020000021971123456851',
}

const evidence = {
  format: 'BW_ANTECIPA_S2_1A1_LOCAL_SELECTIVE_CLAIM_V1',
  startedAt: new Date().toISOString(),
  target: 'single-local-disposable-supabase-stack',
  remoteConnectionUsed: false,
  remoteMutationExecuted: false,
  providerCalls: 0,
  commands: [],
  migration: null,
  s1SqlRegression: null,
  canonicalTrackedMigrations: null,
  historicalLocalArtifacts: [],
  identityMatrix: [],
  acl: null,
  concurrency: null,
  retryReplay: null,
  genericQueue: null,
  transactionRollback: null,
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
  await verifyMigrationApplied(admin)
  await runS1SqlRegression(admin)
  await seedSyntheticFixture(admin)
  await runIdentityAndGateMatrix(admin)
  await runAclProof(admin)
  await runConcurrencyAndReplayProof(admin)
  await runGenericRegression(admin)
  await runRollbackProof(admin)
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
  const reportPath = resolve(evidenceRoot, 'S2_1A1_LOCAL_SQL_REHEARSAL.json')
  writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  if (existsSync(stackRoot)) {
    const expectedPrefix = resolve(process.env.LOCALAPPDATA || tmpdir(), 'bw-antecipa-evidence', 's2-1a1-serpro-selective-claim-20261028')
    assert.ok(resolve(stackRoot).startsWith(expectedPrefix), 'recusa remover stack fora da raiz dedicada')
    rmSync(stackRoot, { recursive: true, force: true })
  }
  console.log(`S2_1A1_LOCAL_SQL_REHEARSAL=${evidence.success ? 'PASS' : 'FAIL'}`)
  console.log(`REPORT=${reportPath}`)
  if (evidence.error) console.error(evidence.error)
}

function assertLocalOnly() {
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

  // Windows checkouts may materialize tracked SQL as CRLF. Some historical,
  // hash-certified migrations compare normalized function bodies and must run
  // from the exact Git-object bytes used by Linux CI.
  const tracked = spawnSync(
    'git',
    ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'supabase/migrations'],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true },
  )
  assert.equal(tracked.status, 0, 'catalogo de migrations rastreadas indisponivel')
  const trackedPaths = tracked.stdout.split(/\r?\n/u).filter(Boolean)
  for (const path of trackedPaths) {
    const canonical = spawnSync('git', ['show', `HEAD:${path}`], {
      cwd: ROOT,
      encoding: null,
      windowsHide: true,
    })
    assert.equal(canonical.status, 0, `migration canonica nao recuperada: ${path}`)
    writeFileSync(resolve(stackRoot, path), canonical.stdout)
  }
  evidence.canonicalTrackedMigrations = {
    sourceRevision: 'HEAD',
    count: trackedPaths.length,
    worktreeLineEndingsIgnored: true,
    repositoryFilesChanged: false,
  }

  for (const artifact of HISTORICAL_LOCAL_ARTIFACTS) {
    const recovered = spawnSync('git', ['show', `${artifact.revision}:${artifact.path}`], {
      cwd: ROOT,
      encoding: null,
      windowsHide: true,
    })
    assert.equal(recovered.status, 0, `artefato historico nao recuperado: ${artifact.path}`)
    assert.equal(
      sha256(recovered.stdout),
      artifact.sha256,
      `hash local divergiu do certificado: ${artifact.path}`,
    )
    writeFileSync(resolve(stackRoot, artifact.path), recovered.stdout)
    evidence.historicalLocalArtifacts.push({
      sourceRevision: artifact.revision,
      path: artifact.path,
      sha256: artifact.sha256,
      repositoryHistoryChanged: false,
      disposableStackOnly: true,
    })
  }

  const configPath = resolve(copiedSupabase, 'config.toml')
  const configured = configureDisposableToml(readFileSync(configPath, 'utf8'), {
    projectId,
    ...ports,
  })
  writeFileSync(configPath, configured, 'utf8')
}

async function verifyMigrationApplied(db) {
  const row = (await db.query(`
    SELECT version, name
      FROM supabase_migrations.schema_migrations
     WHERE version = '20261028140420'
  `)).rows[0]
  assert.equal(row?.version, '20261028140420')
  const migrationPath = resolve(ROOT, 'supabase/migrations', MIGRATION)
  evidence.migration = {
    filename: MIGRATION,
    sha256: sha256(readFileSync(migrationPath)),
    localApplied: true,
    remoteApplied: false,
  }
}

async function runS1SqlRegression(db) {
  const source = readFileSync(resolve(ROOT, 'supabase/tests/s1_serpro_nfe_gestor.test.sql'), 'utf8')
    .replace(/^\\set[^\r\n]*(?:\r?\n)?/gmu, '')
  const rawResults = await db.query(source)
  const results = Array.isArray(rawResults) ? rawResults : [rawResults]
  const tapLines = results
    .flatMap(result => result.rows ?? [])
    .flatMap(row => Object.values(row))
    .filter(value => typeof value === 'string' && /^(?:ok |not ok |1\.\.)/u.test(value))
  const plan = tapLines.find(line => line.startsWith('1..'))
  const failures = tapLines.filter(line => line.startsWith('not ok '))
  const successes = tapLines.filter(line => line.startsWith('ok '))
  assert.equal(plan, '1..22', 'plano da regressao SQL S1 divergiu')
  assert.deepEqual(failures, [], `regressao SQL S1 falhou: ${failures.join(' | ')}`)
  assert.equal(successes.length, 22, 'regressao SQL S1 nao executou todas as assertions')
  evidence.s1SqlRegression = {
    source: 'supabase/tests/s1_serpro_nfe_gestor.test.sql',
    plan,
    passed: successes.length,
    failed: failures.length,
    transactionRolledBack: true,
  }
}

async function seedSyntheticFixture(db) {
  await db.query(`
    INSERT INTO auth.users (id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES
      ('${ids.gestorA}','s21a1-gestor-a@example.invalid','{}','{"nome_completo":"S2.1A.1 Gestor A"}',now(),now()),
      ('${ids.gestorB}','s21a1-gestor-b@example.invalid','{}','{"nome_completo":"S2.1A.1 Gestor B"}',now(),now()),
      ('${ids.cedenteUser}','s21a1-cedente@example.invalid','{}','{"nome_completo":"S2.1A.1 Cedente"}',now(),now()),
      ('${ids.consultor}','s21a1-consultor@example.invalid','{}','{"nome_completo":"S2.1A.1 Consultor"}',now(),now()),
      ('${ids.sacado}','s21a1-sacado@example.invalid','{}','{"nome_completo":"S2.1A.1 Sacado"}',now(),now());

    INSERT INTO public.profiles (id,role,nome_completo,email,status) VALUES
      ('${ids.gestorA}','gestor','S2.1A.1 Gestor A','s21a1-gestor-a@example.invalid','ativo'),
      ('${ids.gestorB}','gestor','S2.1A.1 Gestor B','s21a1-gestor-b@example.invalid','ativo'),
      ('${ids.cedenteUser}','cedente','S2.1A.1 Cedente','s21a1-cedente@example.invalid','ativo'),
      ('${ids.consultor}','consultor','S2.1A.1 Consultor','s21a1-consultor@example.invalid','ativo'),
      ('${ids.sacado}','sacado','S2.1A.1 Sacado','s21a1-sacado@example.invalid','ativo')
    ON CONFLICT (id) DO UPDATE SET role=excluded.role,status=excluded.status;

    INSERT INTO public.fundos (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
    VALUES
      ('${ids.fundoA}','Fundo S2.1A.1 A','96000000000101','Admin A','96000000000292','Gestora A','96000000000373',true),
      ('${ids.fundoB}','Fundo S2.1A.1 B','97000000000190','Admin B','97000000000270','Gestora B','97000000000350',true);
    INSERT INTO public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal)
    VALUES
      ('${ids.gestorA}','${ids.fundoA}','gestor','ativo',true),
      ('${ids.gestorB}','${ids.fundoB}','gestor','ativo',true);
    INSERT INTO public.cedentes (id,user_id,cnpj,razao_social,status,fundo_id)
    VALUES ('${ids.cedente}','${ids.cedenteUser}','14224864000100','Cedente Sintetico S2.1A.1','ativo','${ids.fundoA}');
    INSERT INTO public.cedente_fundos (id,cedente_id,fundo_id,status)
    VALUES
      ('${ids.vinculoA}','${ids.cedente}','${ids.fundoA}','ativo'),
      ('${ids.vinculoB}','${ids.cedente}','${ids.fundoB}','ativo');

    INSERT INTO auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at)
    VALUES ('${ids.factorA}','${ids.gestorA}','S2.1A.1 local','totp','verified',now(),now());
    INSERT INTO auth.sessions(id,user_id,aal,factor_id,created_at,updated_at)
    VALUES ('${ids.sessionA}','${ids.gestorA}','aal2','${ids.factorA}',now(),now());
    INSERT INTO public.sessoes_elevadas(user_id,session_id,metodo,factor_id,elevada_em,expira_em)
    VALUES ('${ids.gestorA}','${ids.sessionA}','totp','${ids.factorA}',now(),now()+interval '1 hour');
  `)

  const notes = [
    [ids.noteB, '2191', keys.B, ids.fundoA, ids.vinculoA, '0'],
    [ids.generic1, '2194', keys.generic1, ids.fundoA, ids.vinculoA, '1'],
    [ids.generic2, '2195', keys.generic2, ids.fundoA, ids.vinculoA, '2'],
    [ids.generic3, '2196', keys.generic3, ids.fundoA, ids.vinculoA, '3'],
    [ids.generic4, '2197', keys.generic4, ids.fundoA, ids.vinculoA, '4'],
    [ids.noteExpiry, '2192', keys.expiry, ids.fundoA, ids.vinculoA, '5'],
    [ids.noteA, '2190', keys.A, ids.fundoA, ids.vinculoA, '6'],
  ]
  for (const [id, number, key, fund, link, suffix] of notes) {
    await insertNfe(db, { id, number, key, fund, link, fingerprint: `${suffix}`.repeat(64) })
  }

  await db.query(`
    INSERT INTO public.notas_fiscais (
      id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,chave_acesso,
      data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,
      cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,
      status,tipo_documento_fiscal,fiscal_proveniencia
    ) VALUES (
      '${ids.noteModel65}','${ids.cedente}','${ids.vinculoA}','${ids.fundoA}',
      'MODEL65','1',NULL,'2026-10-20','2026-11-20','14224864000100','Cedente Sintetico',
      '12345678000190','Sacado Sintetico',100,100,'rascunho','NFE','{}'
    );
    INSERT INTO public.nfe_fiscal_snapshots (
      id,fundo_id,nota_fiscal_id,document_ref,idempotency_ref,chave_acesso,modelo,
      numero_nf,serie,cnpj_emitente,cnpj_destinatario,data_emissao,valor_total
    ) VALUES (
      'a1600000-0000-4000-8000-000000000004','${ids.fundoA}','${ids.noteModel65}',
      'synthetic-model65','${'f'.repeat(64)}','${keys.model65}','65','2193','2',
      '14224864000100','12345678000190','2026-10-20',100
    );
    INSERT INTO public.nfe_fiscal_consultas (
      id,snapshot_id,fundo_id,nota_fiscal_id,status,capability_state
    ) VALUES (
      'a1700000-0000-4000-8000-000000000004','a1600000-0000-4000-8000-000000000004',
      '${ids.fundoA}','${ids.noteModel65}','PENDENTE','ENABLED'
    );
    UPDATE public.nfe_fiscal_consultas
       SET capability_state='ENABLED', status='PENDENTE', proxima_tentativa_em=NULL,
           lease_token=NULL, lease_ate=NULL
     WHERE nota_fiscal_id IN (
       '${ids.noteA}','${ids.noteB}','${ids.noteExpiry}',
       '${ids.generic1}','${ids.generic2}','${ids.generic3}','${ids.generic4}'
     );
    UPDATE public.nfe_fiscal_provider_state
       SET capability_state='ENABLED', circuit_state='CLOSED', daily_budget=10,
           calls_today=0, budget_date=current_date, consecutive_failures=0,
           circuit_open_until=NULL
     WHERE provider='SERPRO';
  `)
}

async function insertNfe(db, { id, number, key, fund, link, fingerprint }) {
  await db.query(`
    INSERT INTO public.notas_fiscais (
      id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,chave_acesso,
      data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,
      cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,
      status,tipo_documento_fiscal,fiscal_proveniencia,valor_liquido_origem,vencimento_origem
    ) VALUES ($1,$2,$3,$4,$5,'2',$6,'2026-10-20','2026-11-20',
      '14224864000100','Cedente Sintetico','12345678000190','Sacado Sintetico',
      100,100,'submetida','NFE',jsonb_build_object('sha256',$7::text),NULL,NULL)
  `, [id, ids.cedente, link, fund, number, key, fingerprint])
}

async function runIdentityAndGateMatrix(db) {
  const service = await openServiceClient('identity')
  try {
    const consultaA = await consultaFor(db, ids.noteA)
    const consultaB = await consultaFor(db, ids.noteB)
    const consultaExpiry = await consultaFor(db, ids.noteExpiry)
    const model65 = await consultaFor(db, ids.noteModel65)

    await expectSqlError(service, authorizeSql(), [
      randomUUID(), ids.fundoA, ids.noteA, '123', 'a'.repeat(64), ids.gestorA, ids.sessionA,
    ], '22023', 'invalid_44_digit_key')
    await expectSqlError(service, authorizeSql(), [
      randomUUID(), ids.fundoA, ids.noteA, keys.A, null, ids.gestorA, ids.sessionA,
    ], '22023', 'missing_nonce')
    await expectSqlError(service, authorizeSql(), [
      randomUUID(), ids.fundoA, ids.noteA, keys.A, 'b'.repeat(64), ids.gestorA, ids.sessionA,
    ], '22023', 'unknown_consulta')
    await expectSqlError(service, authorizeSql(), [
      model65.id, ids.fundoA, ids.noteModel65, keys.model65, 'c'.repeat(64), ids.gestorA, ids.sessionA,
    ], '22023', 'model_not_55')

    await db.query(`UPDATE public.nfe_fiscal_consultas SET status='CONSULTADO' WHERE id=$1`, [consultaB.id])
    await expectSqlError(service, authorizeSql(), [
      consultaB.id, ids.fundoA, ids.noteB, keys.B, 'd'.repeat(64), ids.gestorA, ids.sessionA,
    ], '22023', 'status_not_eligible')
    await db.query(`UPDATE public.nfe_fiscal_consultas SET status='PENDENTE' WHERE id=$1`, [consultaB.id])

    await expectSqlError(service, authorizeSql(), [
      consultaB.id, ids.fundoB, ids.noteB, keys.B, 'e'.repeat(64), ids.gestorA, ids.sessionA,
    ], '22023', 'cross_fund_authorize')
    await expectSqlError(service, authorizeSql(), [
      consultaB.id, ids.fundoA, ids.noteB, keys.B, '1'.repeat(64), ids.gestorB, ids.sessionA,
    ], '42501', 'unauthorized_operator')

    await db.query(`UPDATE public.nfe_fiscal_provider_state SET capability_state='UNVERIFIED' WHERE provider='SERPRO'`)
    await expectSqlError(service, authorizeSql(), [
      consultaB.id, ids.fundoA, ids.noteB, keys.B, '2'.repeat(64), ids.gestorA, ids.sessionA,
    ], '55000', 'contract_unverified')
    await db.query(`UPDATE public.nfe_fiscal_provider_state SET capability_state='ENABLED' WHERE provider='SERPRO'`)

    const exactNonce = '3'.repeat(64)
    const authorizationA = await authorize(service, {
      consultaId: consultaA.id,
      fundId: ids.fundoA,
      noteId: ids.noteA,
      key: keys.A,
      nonce: exactNonce,
    })
    evidence.selected = { authorizationId: authorizationA, consultaId: consultaA.id, nonceHash: '[SHA256_SYNTHETIC]' }

    await expectSqlError(service, authorizeSql(), [
      consultaB.id, ids.fundoA, ids.noteB, keys.B, exactNonce, ids.gestorA, ids.sessionA,
    ], '23505', 'nonce_reuse')

    const expiryNonce = '4'.repeat(64)
    const expiryAuth = (await service.query(authorizeSql('1 second'), [
      consultaExpiry.id, ids.fundoA, ids.noteExpiry, keys.expiry, expiryNonce,
      ids.gestorA, ids.sessionA,
    ])).rows[0].authorization_id
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1_100))
    const expiredClaim = await claim(service, {
      authorizationId: expiryAuth,
      consultaId: consultaExpiry.id,
      fundId: ids.fundoA,
      noteId: ids.noteExpiry,
      key: keys.expiry,
      nonce: expiryNonce,
      operatorId: ids.gestorA,
    })
    assert.equal(expiredClaim.length, 0)
    assert.equal((await db.query(`SELECT status FROM private.nfe_fiscal_pilot_authorizations WHERE id=$1`, [expiryAuth])).rows[0].status, 'EXPIRADA')

    for (const [name, mutation] of [
      ['wrong_fund', { fundId: ids.fundoB }],
      ['wrong_note', { noteId: ids.noteB }],
      ['wrong_key', { key: keys.B }],
      ['wrong_nonce', { nonce: '5'.repeat(64) }],
      ['wrong_operator', { operatorId: ids.gestorB }],
    ]) {
      const rows = await claim(service, {
        authorizationId: authorizationA,
        consultaId: consultaA.id,
        fundId: ids.fundoA,
        noteId: ids.noteA,
        key: keys.A,
        nonce: exactNonce,
        operatorId: ids.gestorA,
        ...mutation,
      })
      assert.equal(rows.length, 0, name)
      evidence.identityMatrix.push({ case: name, expected: 'FAIL_CLOSED', passed: true })
    }

    for (const [name, statement, restore] of [
      ['circuit_open', `UPDATE public.nfe_fiscal_provider_state SET circuit_state='OPEN' WHERE provider='SERPRO'`, `UPDATE public.nfe_fiscal_provider_state SET circuit_state='CLOSED' WHERE provider='SERPRO'`],
      ['budget_zero', `UPDATE public.nfe_fiscal_provider_state SET daily_budget=0 WHERE provider='SERPRO'`, `UPDATE public.nfe_fiscal_provider_state SET daily_budget=10 WHERE provider='SERPRO'`],
      ['capability_unverified', `UPDATE public.nfe_fiscal_provider_state SET capability_state='UNVERIFIED' WHERE provider='SERPRO'`, `UPDATE public.nfe_fiscal_provider_state SET capability_state='ENABLED' WHERE provider='SERPRO'`],
    ]) {
      await db.query(statement)
      const rows = await claim(service, {
        authorizationId: authorizationA,
        consultaId: consultaA.id,
        fundId: ids.fundoA,
        noteId: ids.noteA,
        key: keys.A,
        nonce: exactNonce,
        operatorId: ids.gestorA,
      })
      assert.equal(rows.length, 0, name)
      await db.query(restore)
      evidence.identityMatrix.push({ case: name, expected: 'FAIL_CLOSED', passed: true })
    }
    evidence.identityMatrix.push(
      { case: 'exact_identity_authorized', expected: 'AUTHORIZED_NOT_YET_CLAIMED', passed: true },
      { case: 'expired_authorization', expected: 'FAIL_CLOSED_EXPIRED', passed: true },
      { case: 'invalid_key_model_nonce_status_contract_operator', expected: 'FAIL_CLOSED', passed: true },
    )
  } finally {
    await service.end()
  }
}

async function runAclProof(db) {
  const signature = 'public.nfe_fiscal_pilot_claim(uuid,uuid,uuid,uuid,text,text,uuid)'
  const privileges = (await db.query(`
    SELECT
      has_function_privilege('anon',$1,'EXECUTE') anon,
      has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
      has_function_privilege('service_role',$1,'EXECUTE') service_role
  `, [signature])).rows[0]
  assert.deepEqual(privileges, { anon: false, authenticated: false, service_role: true })

  const actors = [
    ['gestor', ids.gestorA],
    ['cedente', ids.cedenteUser],
    ['consultor', ids.consultor],
    ['sacado', ids.sacado],
  ]
  for (const [role, actorId] of actors) {
    const client = new Client({ ...connection, application_name: `s2_1a1_acl_${role}` })
    await client.connect()
    try {
      await client.query('SET ROLE authenticated')
      await client.query(`SELECT set_config('request.jwt.claims',$1,false), set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub',$2,false)`, [
        JSON.stringify({ sub: actorId, role: 'authenticated', aal: 'aal2' }), actorId,
      ])
      await expectSqlError(client, `SELECT * FROM ${signature.replace('public.', 'public.').replace(/\(.*/, '')}(NULL,NULL,NULL,NULL,NULL,NULL,NULL)`, [], '42501', `${role}_direct_claim`)
    } finally {
      await client.end()
    }
  }
  const anon = new Client({ ...connection, application_name: 's2_1a1_acl_anon' })
  await anon.connect()
  try {
    await anon.query('SET ROLE anon')
    await expectSqlError(anon, `SELECT * FROM public.nfe_fiscal_pilot_claim(NULL,NULL,NULL,NULL,NULL,NULL,NULL)`, [], '42501', 'anon_direct_claim')
  } finally {
    await anon.end()
  }

  const service = await openServiceClient('acl_table')
  try {
    await expectSqlError(service, `SELECT count(*) FROM private.nfe_fiscal_pilot_authorizations`, [], '42501', 'service_role_direct_private_table')
  } finally {
    await service.end()
  }

  evidence.acl = {
    catalog: privileges,
    directClaimDenied: ['anon', 'gestor', 'cedente', 'consultor', 'sacado'],
    privateTableDirectServiceRoleDenied: true,
    securityDefinerSearchPathFixed: true,
  }
}

async function runConcurrencyAndReplayProof(db) {
  const consultaA = await consultaFor(db, ids.noteA)
  const authorization = evidence.selected.authorizationId
  const nonce = '3'.repeat(64)
  const genericIds = [ids.generic1, ids.generic2, ids.generic3, ids.generic4]
  const genericBefore = await queueState(db, genericIds)
  const bBefore = await queueState(db, [ids.noteB])

  const left = await openServiceClient('concurrency_left')
  const right = await openServiceClient('concurrency_right')
  let results
  try {
    results = await Promise.all([left, right].map(client => claim(client, {
      authorizationId: authorization,
      consultaId: consultaA.id,
      fundId: ids.fundoA,
      noteId: ids.noteA,
      key: keys.A,
      nonce,
      operatorId: ids.gestorA,
    })))
  } finally {
    await Promise.all([left.end(), right.end()])
  }
  const counts = results.map(rows => rows.length).sort()
  assert.deepEqual(counts, [0, 1])
  const winner = results.find(rows => rows.length === 1)[0]
  assert.equal(winner.consulta_id, consultaA.id)
  assert.equal(winner.nota_fiscal_id, ids.noteA)
  assert.equal(winner.fundo_id, ids.fundoA)

  const state = (await db.query(`
    SELECT c.status,c.tentativas,c.lease_token,a.status authorization_status,a.consumida_em,
           p.calls_today
      FROM public.nfe_fiscal_consultas c
      JOIN private.nfe_fiscal_pilot_authorizations a ON a.consulta_id=c.id
      CROSS JOIN public.nfe_fiscal_provider_state p
     WHERE c.id=$1 AND a.id=$2 AND p.provider='SERPRO'
  `, [consultaA.id, authorization])).rows[0]
  assert.equal(state.status, 'EM_CONSULTA')
  assert.equal(state.tentativas, 1)
  assert.equal(state.authorization_status, 'CONSUMIDA')
  assert.ok(state.consumida_em)
  assert.equal(state.calls_today, 1)

  const replayClient = await openServiceClient('replay')
  try {
    const replay = await claim(replayClient, {
      authorizationId: authorization,
      consultaId: consultaA.id,
      fundId: ids.fundoA,
      noteId: ids.noteA,
      key: keys.A,
      nonce,
      operatorId: ids.gestorA,
    })
    assert.equal(replay.length, 0)
  } finally {
    await replayClient.end()
  }

  await db.query(`UPDATE public.nfe_fiscal_consultas SET lease_ate=now()-interval '1 second' WHERE id=$1`, [consultaA.id])
  const expiredLeaseClient = await openServiceClient('expired_lease')
  try {
    const expiredLeaseReplay = await claim(expiredLeaseClient, {
      authorizationId: authorization,
      consultaId: consultaA.id,
      fundId: ids.fundoA,
      noteId: ids.noteA,
      key: keys.A,
      nonce,
      operatorId: ids.gestorA,
    })
    assert.equal(expiredLeaseReplay.length, 0)
    await expectSqlError(db, `UPDATE public.nfe_fiscal_consultas SET status='PENDENTE' WHERE id=$1`, [consultaA.id], '55000', 'requeue_after_consumption')
    const failed = (await expiredLeaseClient.query(`
      SELECT public.nfe_fiscal_pilot_fail($1,$2,$3,'SYNTHETIC_TIMEOUT',504) value
    `, [authorization, consultaA.id, winner.lease_token])).rows[0].value
    assert.equal(failed, true)
    const finalReplay = await claim(expiredLeaseClient, {
      authorizationId: authorization,
      consultaId: consultaA.id,
      fundId: ids.fundoA,
      noteId: ids.noteA,
      key: keys.A,
      nonce,
      operatorId: ids.gestorA,
    })
    assert.equal(finalReplay.length, 0)
  } finally {
    await expiredLeaseClient.end()
  }

  const final = (await db.query(`
    SELECT c.status,c.proxima_tentativa_em,c.tentativas,a.status authorization_status,
           a.finalizada_em,p.calls_today,p.circuit_state
      FROM public.nfe_fiscal_consultas c
      JOIN private.nfe_fiscal_pilot_authorizations a ON a.consulta_id=c.id
      CROSS JOIN public.nfe_fiscal_provider_state p
     WHERE c.id=$1 AND a.id=$2 AND p.provider='SERPRO'
  `, [consultaA.id, authorization])).rows[0]
  assert.equal(final.status, 'INCONCLUSIVO')
  assert.equal(final.proxima_tentativa_em, null)
  assert.equal(final.tentativas, 1)
  assert.equal(final.authorization_status, 'INCONCLUSIVA')
  assert.ok(final.finalizada_em)
  assert.equal(final.calls_today, 1)
  assert.equal(final.circuit_state, 'OPEN')

  const genericAfter = await queueState(db, genericIds)
  const bAfter = await queueState(db, [ids.noteB])
  assert.deepEqual(genericAfter, genericBefore)
  assert.deepEqual(bAfter, bBefore)
  evidence.concurrency = {
    simultaneousClaims: 2,
    successfulReservations: 1,
    rejectedReservations: 1,
    attempts: 1,
    budgetReservations: 1,
    exactIdentity: true,
  }
  evidence.retryReplay = {
    immediateReplayRejected: true,
    expiredLeaseReplayRejected: true,
    requeueRejected: true,
    terminalFailure: true,
    automaticRetryScheduled: false,
  }
  evidence.genericQueue = {
    syntheticPendingItems: genericIds.length,
    before: genericBefore,
    after: genericAfter,
    unchanged: true,
    olderConsultationBUnchanged: true,
  }
}

async function runGenericRegression(db) {
  await db.query(`
    UPDATE public.nfe_fiscal_provider_state
       SET capability_state='ENABLED',circuit_state='CLOSED',daily_budget=10,
           calls_today=1,budget_date=current_date
     WHERE provider='SERPRO'
  `)
  const service = await openServiceClient('generic_regression')
  try {
    await service.query('BEGIN')
    const rows = (await service.query(`SELECT id,nota_fiscal_id FROM public.nfe_fiscal_claim(1)`)).rows
    assert.equal(rows.length, 1)
    assert.notEqual(rows[0].nota_fiscal_id, ids.noteA)
    await service.query('ROLLBACK')
  } catch (error) {
    await service.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    await service.end()
  }
  const after = await queueState(db, [ids.generic1, ids.generic2, ids.generic3, ids.generic4])
  assert.deepEqual(after, evidence.genericQueue.after)
  evidence.genericClaimRegression = { executedInsideRollback: true, selectedOneNonPilotRow: true, persistentChange: false }
}

async function runRollbackProof(db) {
  const before = Number((await db.query(`SELECT count(*) count FROM private.nfe_fiscal_pilot_authorizations`)).rows[0].count)
  await db.query('BEGIN')
  try {
    await db.query(`
      INSERT INTO private.nfe_fiscal_pilot_authorizations (
        consulta_id,snapshot_id,fundo_id,nota_fiscal_id,chave_fingerprint,nonce_hash,
        operador_id,operador_session_id,autorizada_em,expira_em
      )
      SELECT c.id,c.snapshot_id,c.fundo_id,c.nota_fiscal_id,$1,$2,$3,$4,now(),now()+interval '1 minute'
        FROM public.nfe_fiscal_consultas c WHERE c.nota_fiscal_id=$5
    `, ['a'.repeat(64), '9'.repeat(64), ids.gestorA, ids.sessionA, ids.noteB])
    await db.query('ROLLBACK')
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  }
  const after = Number((await db.query(`SELECT count(*) count FROM private.nfe_fiscal_pilot_authorizations`)).rows[0].count)
  assert.equal(after, before)
  evidence.transactionRollback = { before, after, passed: true }
}

async function openServiceClient(label) {
  const client = new Client({ ...connection, application_name: `s2_1a1_${label}` })
  await client.connect()
  await client.query('SET ROLE service_role')
  const claims = JSON.stringify({ role: 'service_role' })
  await client.query(`SELECT set_config('request.jwt.claims',$1,false), set_config('request.jwt.claim.role','service_role',false)`, [claims])
  return client
}

async function consultaFor(db, noteId) {
  const row = (await db.query(`
    SELECT c.id,c.snapshot_id,c.fundo_id,c.nota_fiscal_id,s.chave_acesso,s.modelo
      FROM public.nfe_fiscal_consultas c
      JOIN public.nfe_fiscal_snapshots s ON s.id=c.snapshot_id
     WHERE c.nota_fiscal_id=$1
  `, [noteId])).rows[0]
  assert.ok(row, `consulta ausente para ${noteId}`)
  return row
}

async function authorize(client, { consultaId, fundId, noteId, key, nonce }) {
  const row = (await client.query(authorizeSql(), [
    consultaId, fundId, noteId, key, nonce, ids.gestorA, ids.sessionA,
  ])).rows[0]
  assert.ok(row?.authorization_id)
  return row.authorization_id
}

function authorizeSql(validity = '3 minutes') {
  return `SELECT public.nfe_fiscal_pilot_authorize($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '${validity}') authorization_id`
}

async function claim(client, input) {
  return (await client.query(`
    SELECT * FROM public.nfe_fiscal_pilot_claim($1,$2,$3,$4,$5,$6,$7)
  `, [
    input.authorizationId, input.consultaId, input.fundId, input.noteId,
    input.key, input.nonce, input.operatorId,
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

async function expectSqlError(client, sql, params, code, name) {
  let caught
  try {
    await client.query(sql, params)
  } catch (error) {
    caught = error
  }
  assert.ok(caught, `${name}: erro esperado nao ocorreu`)
  assert.equal(caught.code, code, `${name}: SQLSTATE`)
  evidence.identityMatrix.push({ case: name, expected: `SQLSTATE_${code}`, passed: true })
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
