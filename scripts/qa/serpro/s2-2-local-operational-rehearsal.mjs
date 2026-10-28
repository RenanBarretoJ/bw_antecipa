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
const containedSql = process.argv.includes('--contained-sql')
const CLI = resolve(ROOT, 'node_modules/supabase/dist/supabase.js')
const MIGRATION = '20261028195850_s2_2_serpro_operational_queue_history.sql'
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
  's2-2-serpro-operational-local-20261028',
  runId,
)
const stackRoot = resolve(evidenceRoot, 'stack')
const copiedSupabase = resolve(stackRoot, 'supabase')
const portBase = 43000 + (Number(process.pid) % 40) * 10
const ports = {
  apiPort: portBase + 1,
  dbPort: portBase + 2,
  shadowPort: portBase,
  studioPort: portBase + 3,
  mailPort: portBase + 4,
  analyticsPort: portBase + 7,
}
const projectId = `bw_antecipa_s22_${process.pid}_${Date.now()}`
const connection = {
  host: containedSql ? 's22-db' : '127.0.0.1',
  port: containedSql ? 5432 : ports.dbPort,
  database: 'postgres',
  user: 'postgres',
  password: containedSql ? process.env.S22_SYNTHETIC_PG_PASSWORD : 'postgres',
  application_name: 's2_2_local_operational',
}

const ids = {
  gestorA: 'c2100000-0000-4000-8000-000000000001',
  gestorB: 'c2100000-0000-4000-8000-000000000002',
  superAdmin: 'c2100000-0000-4000-8000-000000000003',
  cedenteUser: 'c2100000-0000-4000-8000-000000000004',
  consultor: 'c2100000-0000-4000-8000-000000000005',
  sacado: 'c2100000-0000-4000-8000-000000000006',
  gestorInvalidMfa: 'c2100000-0000-4000-8000-000000000007',
  sessionGestorA: 'c2110000-0000-4000-8000-000000000001',
  sessionGestorB: 'c2110000-0000-4000-8000-000000000002',
  sessionSuperAdmin: 'c2110000-0000-4000-8000-000000000003',
  sessionCedente: 'c2110000-0000-4000-8000-000000000004',
  sessionConsultor: 'c2110000-0000-4000-8000-000000000005',
  sessionSacado: 'c2110000-0000-4000-8000-000000000006',
  sessionInvalidMfa: 'c2110000-0000-4000-8000-000000000007',
  fundoA: 'c2200000-0000-4000-8000-000000000001',
  fundoB: 'c2200000-0000-4000-8000-000000000002',
  cedente: 'c2300000-0000-4000-8000-000000000001',
  vinculoA: 'c2400000-0000-4000-8000-000000000001',
  vinculoB: 'c2400000-0000-4000-8000-000000000002',
  noteHistorical: 'c2500000-0000-4000-8000-000000000001',
  noteCedente: 'c2500000-0000-4000-8000-000000000002',
  noteConsultor: 'c2500000-0000-4000-8000-000000000003',
  noteGestor: 'c2500000-0000-4000-8000-000000000004',
  noteFundB: 'c2500000-0000-4000-8000-000000000005',
  noteNfse: 'c2500000-0000-4000-8000-000000000006',
  noteInvalidKey: 'c2500000-0000-4000-8000-000000000007',
}

const evidence = {
  format: 'BW_ANTECIPA_S2_2_LOCAL_OPERATIONAL_REHEARSAL_V1',
  startedAt: new Date().toISOString(),
  node: process.version,
  target: 'single-local-disposable-supabase-db',
  remoteConnectionUsed: false,
  remoteMutationExecuted: false,
  providerCalls: 0,
  rawProviderPayloadPersisted: false,
  commands: [],
  assertions: {},
  cleanup: null,
  success: false,
}

let started = false
let networkCreated = false
let admin

if (containedSql) {
  assert.equal(process.version.startsWith('v22.'), true)
  assert.ok(existsSync('/.dockerenv'), 'CONTAINER_REQUIRED')
  assert.equal(process.env.S22_CONTAINED_RUNNER, 'true')
  assert.ok(connection.password?.length >= 32, 'SYNTHETIC_PASSWORD_REQUIRED')
  try {
    admin = new Client(connection)
    await admin.connect()
    await verifyMigration(admin)
    await seedActorsAndFunds(admin)
    await proveAutomaticImportAndCutover(admin)
    await proveManualAuthorizationAndIdempotency(admin)
    await proveHistoryFailureAndCriticalPreservation(admin)
    await proveThroughputAndAcl(admin)
    await proveCrashAndDeletion(admin)
    evidence.success = true
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error)
    evidence.errorCode = error?.code
    evidence.errorLocation = error?.stack?.split('\n').slice(1, 4)
    process.exitCode = 1
  } finally {
    if (admin) await admin.end().catch(() => undefined)
    evidence.finishedAt = new Date().toISOString()
    console.log(JSON.stringify(evidence))
  }
} else {
try {
  assertLocalOnly()
  prepareDisposableStack()
  const network = spawnSync('docker', ['network', 'create', '--driver', 'bridge',
    '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', projectId], { encoding: 'utf8', windowsHide: true })
  assert.equal(network.status, 0, `rede local nao criada: ${network.stderr}`)
  networkCreated = true
  const start = runCli([
    'start', '--workdir', stackRoot, '--network-id', projectId,
    '--exclude', 'gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor',
  ])
  evidence.commands.push(start)
  assert.equal(start.exitCode, 0, `supabase start falhou: ${tail(start.stderr || start.stdout)}`)
  started = true
  const inspection = spawnSync('docker', ['inspect', `supabase_db_${projectId}`], { encoding: 'utf8', windowsHide: true })
  assert.equal(inspection.status, 0)
  const bindings = JSON.parse(inspection.stdout)[0].NetworkSettings.Ports['5432/tcp']
  assert.ok(bindings.length > 0 && bindings.every(binding => binding.HostIp === '127.0.0.1'), 'banco deve publicar apenas loopback')
  evidence.assertions.loopbackOnly = bindings

  admin = new Client(connection)
  await admin.connect()
  await verifyMigration(admin)
  await seedActorsAndFunds(admin)
  await proveAutomaticImportAndCutover(admin)
  await proveManualAuthorizationAndIdempotency(admin)
  await proveHistoryFailureAndCriticalPreservation(admin)
  await proveThroughputAndAcl(admin)
  evidence.success = true
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error)
  evidence.errorCode = error?.code
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
  if (networkCreated) {
    const removal = spawnSync('docker', ['network', 'rm', projectId], { encoding: 'utf8', windowsHide: true })
    evidence.cleanup.networkRemoved = removal.status === 0
  }
  evidence.finishedAt = new Date().toISOString()
  evidence.payloadSha256 = sha256(JSON.stringify(evidence))
  mkdirSync(evidenceRoot, { recursive: true })
  const reportPath = resolve(evidenceRoot, 'S2_2_LOCAL_OPERATIONAL_REHEARSAL.json')
  writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  if (existsSync(stackRoot)) {
    const expected = resolve(process.env.LOCALAPPDATA || tmpdir(), 'bw-antecipa-evidence', 's2-2-serpro-operational-local-20261028')
    assert.ok(resolve(stackRoot).startsWith(expected), 'recusa remover stack fora da raiz dedicada')
    rmSync(stackRoot, { recursive: true, force: true })
  }
  console.log(`S2_2_LOCAL_OPERATIONAL_REHEARSAL=${evidence.success ? 'PASS' : 'FAIL'}`)
  console.log(`REPORT=${reportPath}`)
  if (evidence.error) console.error(evidence.error)
}
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
  // The real rehearsal proved that CLI 2.111.0 explicitly publishes 0.0.0.0
  // even on our bridge with host_binding_ipv4=127.0.0.1. Do not start another
  // stack until the provisioner itself can guarantee loopback BEFORE startup.
  // A post-start inspection is not sufficient containment.
  throw new Error('S2_2_HARD_GATE_LOOPBACK_PROVISIONER_REQUIRED')
}

function prepareDisposableStack() {
  assert.ok(!existsSync(stackRoot), 'stack descartavel deve iniciar ausente')
  mkdirSync(stackRoot, { recursive: true })
  cpSync(resolve(ROOT, 'supabase'), copiedSupabase, {
    recursive: true,
    filter: source => !source.includes(`${separator()}supabase${separator()}.temp`),
  })

  const tracked = spawnSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'supabase/migrations'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  })
  assert.equal(tracked.status, 0, 'catalogo de migrations rastreadas indisponivel')
  for (const path of tracked.stdout.split(/\r?\n/u).filter(Boolean)) {
    const canonical = spawnSync('git', ['show', `HEAD:${path}`], { cwd: ROOT, encoding: null, windowsHide: true })
    assert.equal(canonical.status, 0, `migration canonica nao recuperada: ${path}`)
    writeFileSync(resolve(stackRoot, path), canonical.stdout)
  }
  cpSync(resolve(ROOT, 'supabase/migrations', MIGRATION), resolve(copiedSupabase, 'migrations', MIGRATION))
  for (const [path, revision] of HISTORICAL_LOCAL_ARTIFACTS) {
    const recovered = spawnSync('git', ['show', `${revision}:${path}`], { cwd: ROOT, encoding: null, windowsHide: true })
    assert.equal(recovered.status, 0, `artefato historico ausente: ${path}`)
    writeFileSync(resolve(stackRoot, path), recovered.stdout)
  }
  const configPath = resolve(copiedSupabase, 'config.toml')
  writeFileSync(configPath, configureDisposableToml(readFileSync(configPath, 'utf8'), { projectId, ...ports }), 'utf8')
}

async function verifyMigration(db) {
  const version = MIGRATION.slice(0, 14)
  const row = (await db.query(`SELECT count(*)::integer count FROM supabase_migrations.schema_migrations WHERE version=$1`, [version])).rows[0]
  assert.equal(row.count, 1)
  evidence.assertions.migration = {
    version,
    appliedExactlyOnce: true,
    sha256: sha256(readFileSync(resolve(ROOT, 'supabase/migrations', MIGRATION))),
  }
}

async function seedActorsAndFunds(db) {
  const users = [
    [ids.gestorA, 'gestor-a@example.invalid', 'Gestor A'],
    [ids.gestorB, 'gestor-b@example.invalid', 'Gestor B'],
    [ids.superAdmin, 'super-admin@example.invalid', 'Super Admin'],
    [ids.cedenteUser, 'cedente@example.invalid', 'Cedente'],
    [ids.consultor, 'consultor@example.invalid', 'Consultor'],
    [ids.sacado, 'sacado@example.invalid', 'Sacado'],
    [ids.gestorInvalidMfa, 'gestor-sem-mfa@example.invalid', 'Gestor sem MFA'],
  ]
  for (const [id, email, nome] of users) {
    await db.query(`
      INSERT INTO auth.users (id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      VALUES ($1,$2,'{}',jsonb_build_object('nome_completo',$3::text),now(),now())
    `, [id, email, nome])
    const profiles = (await db.query(`SELECT role::text,email,status::text FROM public.profiles WHERE id=$1`, [id])).rows
    assert.equal(profiles.length, 1, 'trigger Auth deve criar exatamente um profile')
    assert.equal(profiles[0].email, email)
    assert.equal(profiles[0].role, 'cedente', 'role canonica inesperada deve falhar antes do UPDATE de fixture')
  }
  const roles = [
    [ids.gestorA, 'gestor'], [ids.gestorB, 'gestor'], [ids.superAdmin, 'super_admin'],
    [ids.cedenteUser, 'cedente'], [ids.consultor, 'consultor'], [ids.sacado, 'sacado'],
    [ids.gestorInvalidMfa, 'gestor'],
  ]
  for (const [id, role] of roles) {
    await db.query(`UPDATE public.profiles SET role=$2,status='ativo' WHERE id=$1`, [id, role])
  }
  await db.query(`INSERT INTO public.usuario_papeis(usuario_id,papel,ativo,origem)
    VALUES($1,'super_admin',true,'administracao')`, [ids.superAdmin])
  await db.query(`
    INSERT INTO public.fundos (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
    VALUES
      ($1,'Fundo S2.2 A','98000000000182','Admin A','98000000000263','Gestora A','98000000000344',true),
      ($2,'Fundo S2.2 B','99000000000127','Admin B','99000000000208','Gestora B','99000000000399',true)
  `, [ids.fundoA, ids.fundoB])
  await db.query(`
    INSERT INTO public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal)
    VALUES ($3,$1,'gestor','ativo',true),($4,$2,'gestor','ativo',true),($5,$1,'gestor','ativo',false)
  `, [ids.fundoA, ids.fundoB, ids.gestorA, ids.gestorB, ids.gestorInvalidMfa])
  await db.query(`
    INSERT INTO public.cedentes (id,user_id,cnpj,razao_social,status,fundo_id)
    VALUES ($1,$2,'14224864000100','Cedente Sintetico S2.2','ativo',$3)
  `, [ids.cedente, ids.cedenteUser, ids.fundoA])
  await db.query(`
    INSERT INTO public.cedente_fundos (id,cedente_id,fundo_id,status)
    VALUES ($1,$2,$3,'ativo'),($4,$2,$5,'ativo')
  `, [ids.vinculoA, ids.cedente, ids.fundoA, ids.vinculoB, ids.fundoB])

  const validSessions = [
    [ids.gestorA, ids.sessionGestorA], [ids.gestorB, ids.sessionGestorB],
    [ids.superAdmin, ids.sessionSuperAdmin], [ids.cedenteUser, ids.sessionCedente],
    [ids.consultor, ids.sessionConsultor], [ids.sacado, ids.sessionSacado],
  ]
  for (const [userId, sessionId] of validSessions) {
    const factorId = sessionId.replace('c211', 'c212')
    await db.query(`
      INSERT INTO auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at)
      VALUES ($1,$2,'S2.2 local','totp','verified',now(),now())
    `, [factorId, userId])
    await db.query(`
      INSERT INTO auth.sessions(id,user_id,aal,factor_id,created_at,updated_at)
      VALUES ($1,$2,'aal2',$3,now(),now())
    `, [sessionId, userId, factorId])
    await db.query(`
      INSERT INTO public.sessoes_elevadas(user_id,session_id,metodo,factor_id,elevada_em,expira_em)
      VALUES ($1,$2,'totp',$3,now(),now()+interval '1 hour')
    `, [userId, sessionId, factorId])
  }
  await db.query(`
    INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at)
    VALUES ($1,$2,'aal1',now(),now())
  `, [ids.sessionInvalidMfa, ids.gestorInvalidMfa])
}

async function proveAutomaticImportAndCutover(db) {
  const historicalKey = makeNfeKey(2190)
  await insertNoteAs(db, ids.noteHistorical, ids.fundoA, ids.vinculoA, historicalKey, ids.cedenteUser, 'NFE')
  const historical = (await db.query(`
    SELECT e.status,e.eligible_post_cutover,e.source,e.requested_by_user_id
      FROM public.nfe_fiscal_execucoes e WHERE e.nota_fiscal_id=$1
  `, [ids.noteHistorical])).rows
  assert.deepEqual(historical, [{
    status: 'BLOQUEADA_OFF', eligible_post_cutover: false,
    source: 'AUTOMATICA_IMPORTACAO', requested_by_user_id: ids.cedenteUser,
  }])

  await db.query(`UPDATE public.nfe_fiscal_provider_state SET cutover_at=clock_timestamp() WHERE provider='SERPRO'`)
  // Old rows must not enter the new queue through any identity UPDATE. All
  // fixture facts remain valid, only the issuance timestamp changes here.
  await db.query(`UPDATE public.notas_fiscais SET data_emissao=data_emissao-1 WHERE id=$1`, [ids.noteHistorical])
  assert.deepEqual((await db.query(`SELECT status,eligible_post_cutover FROM public.nfe_fiscal_execucoes WHERE nota_fiscal_id=$1`,
    [ids.noteHistorical])).rows, [{status:'BLOQUEADA_OFF',eligible_post_cutover:false}])
  const imports = [
    [ids.noteCedente, ids.fundoA, ids.vinculoA, makeNfeKey(2191), ids.cedenteUser],
    [ids.noteConsultor, ids.fundoA, ids.vinculoA, makeNfeKey(2192), ids.consultor],
    [ids.noteGestor, ids.fundoA, ids.vinculoA, makeNfeKey(2193), ids.gestorA],
    [ids.noteFundB, ids.fundoB, ids.vinculoB, makeNfeKey(2194), ids.gestorB],
  ]
  for (const [noteId, fundId, linkId, key, actorId] of imports) {
    await insertNoteAs(db, noteId, fundId, linkId, key, actorId, 'NFE')
  }
  await insertNoteAs(db, ids.noteNfse, ids.fundoA, ids.vinculoA,
    '12345678901234567890123456789012345678901234567890', ids.cedenteUser, 'NFSE')
  await insertNoteAs(db, ids.noteInvalidKey, ids.fundoA, ids.vinculoA, '123', ids.cedenteUser, 'NFE')

  const automatic = (await db.query(`
    SELECT nota_fiscal_id,source,status,eligible_post_cutover,requested_by_user_id
      FROM public.nfe_fiscal_execucoes
     WHERE nota_fiscal_id=ANY($1::uuid[]) ORDER BY nota_fiscal_id
  `, [imports.map(item => item[0])])).rows
  assert.equal(automatic.length, 4)
  assert.ok(automatic.every(row => row.source === 'AUTOMATICA_IMPORTACAO' && row.status === 'SOLICITADA' && row.eligible_post_cutover))
  assert.deepEqual(new Set(automatic.map(row => row.requested_by_user_id)), new Set([ids.cedenteUser, ids.consultor, ids.gestorA, ids.gestorB]))
  assert.equal(Number((await db.query(`SELECT count(*) count FROM public.nfe_fiscal_execucoes WHERE nota_fiscal_id IN ($1,$2)`, [ids.noteNfse, ids.noteInvalidKey])).rows[0].count), 0)

  await db.query(`UPDATE public.notas_fiscais SET status='submetida' WHERE id=$1`, [ids.noteCedente])
  assert.equal(Number((await db.query(`SELECT count(*) count FROM public.nfe_fiscal_execucoes WHERE nota_fiscal_id=$1`, [ids.noteCedente])).rows[0].count), 1)

  const service = await openServiceClient('off_claim')
  try {
    assert.equal((await service.query(`SELECT * FROM public.nfe_fiscal_operational_claim(15)`)).rowCount, 0)
  } finally {
    await service.end()
  }
  evidence.assertions.automaticImport = {
    actors: ['cedente', 'consultor', 'gestor'],
    oneExecutionPerImport: true,
    nfseAndInvalidKeyExcluded: true,
    laterSubmissionCreatesZero: true,
    offModeClaimsZero: true,
    preCutoverStatus: historical[0].status,
  }
}

async function proveManualAuthorizationAndIdempotency(db) {
  await db.query(`
    UPDATE public.nfe_fiscal_provider_state
       SET consumption_mode='UNLIMITED_WITH_METERING', capability_state='ENABLED',
           circuit_state='CLOSED', consecutive_failures=0, circuit_open_until=NULL,
           rate_window_started_at=NULL,rate_window_calls=0
     WHERE provider='SERPRO'
  `)
  const service = await openServiceClient('initial_auto')
  let autoJobs
  try {
    autoJobs = (await service.query(`SELECT * FROM public.nfe_fiscal_operational_claim(4)`)).rows
    assert.equal(autoJobs.length, 4)
    assert.ok(autoJobs.every(job => job.nota_fiscal_id !== ids.noteHistorical))
    const identityJob=autoJobs[0]
    await db.query(`UPDATE public.notas_fiscais SET cnpj_destinatario='11222333000181' WHERE id=$1`,[identityJob.nota_fiscal_id])
    assert.equal((await service.query(`SELECT public.nfe_fiscal_operational_http_begin($1,$2,'OAUTH') value`,
      [identityJob.execution_id,identityJob.lease_token])).rows[0].value.code,'IDENTITY_MISMATCH')
    await db.query(`UPDATE public.notas_fiscais SET cnpj_destinatario='12345678000190' WHERE id=$1`,[identityJob.nota_fiscal_id])
    for (const job of autoJobs) await completeSynthetic(service, job, job.nota_fiscal_id === ids.noteCedente)
  } finally {
    await service.end()
  }

  const requestRef = 'request-manual-0000000000000001'
  const first = await callManual(ids.gestorA, ids.sessionGestorA, ids.noteCedente, requestRef)
  assert.equal(first.accepted, true)
  assert.equal(first.code, 'QUEUED')
  const replay = await callManual(ids.gestorA, ids.sessionGestorA, ids.noteCedente, requestRef)
  assert.equal(replay.code, 'IDEMPOTENT_REPLAY')
  assert.equal(replay.requestId, first.requestId)

  const concurrent = await Promise.all([
    callManual(ids.gestorA, ids.sessionGestorA, ids.noteCedente, 'request-manual-concurrent-00001'),
    callManual(ids.gestorA, ids.sessionGestorA, ids.noteCedente, 'request-manual-concurrent-00002'),
  ])
  assert.ok(concurrent.every(result => ['ALREADY_QUEUED', 'IDEMPOTENT_REPLAY'].includes(result.code)))
  assert.equal(Number((await db.query(`
    SELECT count(*) count FROM public.nfe_fiscal_execucoes
     WHERE nota_fiscal_id=$1 AND status IN ('SOLICITADA','EM_PROCESSAMENTO','INDISPONIVEL')
  `, [ids.noteCedente])).rows[0].count), 1)

  await expectManualDenied(ids.gestorA, ids.sessionGestorA, ids.noteFundB, 'cross-fund-request-00000001')
  await expectManualDenied(ids.gestorInvalidMfa, ids.sessionInvalidMfa, ids.noteCedente, 'invalid-mfa-request-000001')
  await expectManualDenied(ids.cedenteUser, ids.sessionCedente, ids.noteCedente, 'cedente-request-0000000001')
  await expectManualDenied(ids.consultor, ids.sessionConsultor, ids.noteCedente, 'consultor-request-00000001')
  await expectManualDenied(ids.sacado, ids.sessionSacado, ids.noteCedente, 'sacado-request-00000000001')
  await expectManualDenied(null, null, ids.noteCedente, 'anon-request-0000000000001')
  // Valid fixture: elevation precedes expiration, and both are in the past.
  // Preserve the canonical expira_em > elevada_em constraint unchanged.
  await db.query(`UPDATE public.sessoes_elevadas SET elevada_em=now()-interval '2 hours',expira_em=now()-interval '1 second' WHERE user_id=$1`, [ids.gestorA])
  await expectManualDenied(ids.gestorA, ids.sessionGestorA, ids.noteCedente, 'expired-session-request-001')
  await db.query(`UPDATE public.sessoes_elevadas SET elevada_em=now(),expira_em=now()+interval '1 hour' WHERE user_id=$1`, [ids.gestorA])

  const superAdmin = await callManual(ids.superAdmin, ids.sessionSuperAdmin, ids.noteFundB, 'super-admin-request-0000001')
  assert.equal(superAdmin.accepted, true)
  evidence.assertions.manualAuthorization = {
    gestorSameFund: 'PASS',
    superAdmin: 'PASS',
    denied: ['cross-fund', 'invalid-login-mfa', 'expired-session', 'cedente', 'consultor', 'sacado', 'anon'],
    sameRequestReplaySameId: true,
    simultaneousActiveJobs: 1,
    freshTotpChallengeRequired: false,
  }
}

async function proveHistoryFailureAndCriticalPreservation(db) {
  const service = await openServiceClient('history')
  try {
    const jobs = (await service.query(`SELECT * FROM public.nfe_fiscal_operational_claim(2)`)).rows
    assert.equal(jobs.length, 2)
    for (const job of jobs) await completeSynthetic(service, job, false)
  } finally {
    await service.end()
  }

  const immediate = await callManual(ids.gestorA, ids.sessionGestorA, ids.noteCedente, 'immediate-new-request-000001')
  assert.equal(immediate.accepted, true)
  assert.equal(immediate.code, 'QUEUED')
  const failureService = await openServiceClient('failure')
  try {
    const [job] = (await failureService.query(`SELECT * FROM public.nfe_fiscal_operational_claim(1)`)).rows
    assert.equal(job.execution_id, immediate.requestId)
    const failed = (await failureService.query(`
      SELECT public.nfe_fiscal_operational_record_failure($1,$2,'TOKEN_HTTP_429',429,true) value
    `, [job.execution_id, job.lease_token])).rows[0].value
    assert.equal(failed, true)
  } finally {
    await failureService.end()
  }
  const canonical = (await db.query(`
    SELECT status,severidade,checked_at FROM public.nfe_fiscal_consultas WHERE nota_fiscal_id=$1
  `, [ids.noteCedente])).rows[0]
  assert.equal(canonical.status, 'DIVERGENTE')
  assert.equal(canonical.severidade, 'VERMELHO')
  assert.ok(canonical.checked_at)

  const history = (await db.query(`
    SELECT source,status,provider_call_count,requested_by_user_id
      FROM public.nfe_fiscal_execucoes WHERE nota_fiscal_id=$1 ORDER BY requested_at,id
  `, [ids.noteCedente])).rows
  assert.equal(history.length, 3)
  assert.deepEqual(history.map(row => row.status), ['CONCLUIDA', 'CONCLUIDA', 'INDISPONIVEL'])
  assert.ok(history.filter(row => row.source === 'MANUAL_GESTOR').every(row => row.requested_by_user_id === ids.gestorA))
  const events = Number((await db.query(`SELECT count(*) count FROM public.nfe_fiscal_execucao_eventos WHERE nota_fiscal_id=$1`, [ids.noteCedente])).rows[0].count)
  assert.ok(events >= 8)
  evidence.assertions.historyAndFailure = {
    immediateNewRequestAllowed: true,
    cooldown: 'NONE',
    retry429: 'INDISPONIVEL',
    priorCanonicalEvidencePreserved: true,
    historicalCriticalEventPreserved: true,
    executionHistoryRows: history.length,
    appendOnlyEventRows: events,
  }
}

async function proveThroughputAndAcl(db) {
  await db.query(`
    UPDATE public.nfe_fiscal_provider_state
       SET rate_window_started_at=NULL,rate_window_calls=0,circuit_state='CLOSED',circuit_open_until=NULL
     WHERE provider='SERPRO'
  `)
  const bulkIds = []
  for (let index = 0; index < 16; index += 1) {
    const id = `c2600000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    bulkIds.push(id)
    await insertNoteAs(db, id, ids.fundoA, ids.vinculoA, makeNfeKey(3000 + index), ids.gestorA, 'NFE')
  }
  const service = await openServiceClient('qps')
  let first
  let second
  try {
    first = (await service.query(`SELECT * FROM public.nfe_fiscal_operational_claim(15)`)).rows
    second = (await service.query(`SELECT * FROM public.nfe_fiscal_operational_claim(15)`)).rows
  } finally {
    await service.end()
  }
  assert.equal(first.length, 15)
  assert.equal(second.length, 0)

  const signatures = [
    'public.nfe_fiscal_operational_claim(integer)',
    'public.nfe_fiscal_operational_complete(uuid,uuid,text,text,text,timestamp with time zone,integer,text,jsonb,jsonb,jsonb)',
    'public.nfe_fiscal_operational_record_failure(uuid,uuid,text,integer,boolean)',
  ]
  for (const signature of signatures) {
    const privilege = (await db.query(`
      SELECT has_function_privilege('anon',$1,'EXECUTE') anon,
             has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
             has_function_privilege('service_role',$1,'EXECUTE') service_role
    `, [signature])).rows[0]
    assert.deepEqual(privilege, { anon: false, authenticated: false, service_role: true })
  }
  const tableSecurity = (await db.query(`
    SELECT relname,relrowsecurity,relforcerowsecurity
      FROM pg_class WHERE oid IN ('public.nfe_fiscal_execucoes'::regclass,'public.nfe_fiscal_execucao_eventos'::regclass)
     ORDER BY relname
  `)).rows
  assert.ok(tableSecurity.every(row => row.relrowsecurity && row.relforcerowsecurity))
  const provider = (await db.query(`
    SELECT max_requests_per_second,rate_window_calls,total_calls,consumption_mode
      FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO'
  `)).rows[0]
  assert.equal(provider.max_requests_per_second, 15)
  assert.equal(provider.rate_window_calls, 15)
  assert.equal(Number(provider.total_calls), 6, 'claim reservations are not GET dispatches')
  evidence.assertions.throughputAndSecurity = {
    firstClaim: first.length,
    secondClaimSameWindow: second.length,
    maxQps: provider.max_requests_per_second,
    meteredCallsDynamic: Number(provider.total_calls),
    workerRpcsServiceOnly: true,
    rlsAndForceRls: true,
    historicalCountHardcoded: false,
  }
}

async function insertNoteAs(db, noteId, fundId, linkId, key, actorId, documentType) {
  await db.query('BEGIN')
  try {
    const claims = actorId ? JSON.stringify({ sub: actorId, role: 'authenticated', aal: 'aal2' }) : '{}'
    await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [claims])
    const number = key ? String(Number(key.slice(25, 34))) : `NFSE-${noteId.slice(-4)}`
    await db.query(`
      INSERT INTO public.notas_fiscais (
        id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,chave_acesso,
        data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,
        cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,
        status,tipo_documento_fiscal,fiscal_proveniencia,valor_liquido_origem,vencimento_origem
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'2026-10-28','2026-11-28',
        '14224864000100','Cedente Sintetico','12345678000190','Sacado Sintetico',
        100,100,'rascunho',$8,
        CASE WHEN $8='NFSE' THEN jsonb_build_object('sha256',$9::text,
          'strategy','danfse_v2_labels','source','PDF_TEXT_NATIVE','competencia','2026-10',
          'vencimento_documento','2026-11-28') ELSE jsonb_build_object('sha256',$9::text) END,
        CASE WHEN $8='NFSE' THEN 'DOCUMENTO_EXPLICITO' END,
        CASE WHEN $8='NFSE' THEN 'DOCUMENT' END)
    `, [noteId, ids.cedente, linkId, fundId, number, key ? key.slice(22, 25) : '1', key, documentType, sha256(noteId)])
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

async function proveCrashAndDeletion(db) {
  const jobs=(await db.query(`SELECT id execution_id,lease_token,nota_fiscal_id FROM public.nfe_fiscal_execucoes
    WHERE status='EM_PROCESSAMENTO' ORDER BY requested_at,id`)).rows
  assert.equal(jobs.length,15)
  const service=await openServiceClient('crash')
  try {
    await simulateHttp(service,jobs[0],'OAUTH',200)
    await new Promise(done=>setTimeout(done,110))
    const grant=(await service.query(`SELECT public.nfe_fiscal_operational_http_begin($1,$2,'GET_NFE') value`,
      [jobs[0].execution_id,jobs[0].lease_token])).rows[0].value
    assert.equal(grant.code,'AUTHORIZED')
    const replay=(await service.query(`SELECT public.nfe_fiscal_operational_http_begin($1,$2,'GET_NFE') value`,
      [jobs[0].execution_id,jobs[0].lease_token])).rows[0].value
    assert.equal(replay.code,'ALREADY_AUTHORIZED')
    const other=(await service.query(`SELECT public.nfe_fiscal_operational_http_begin($1,$2,'OAUTH') value`,
      [jobs[1].execution_id,jobs[1].lease_token])).rows[0].value
    assert.equal(other.code,'WAIT')
    const peers=await Promise.all([0,1,2,3].map(i=>openServiceClient('concurrent_outbound_'+i)))
    try {
      const results=await Promise.all(peers.map((peer,i)=>peer.query(`SELECT public.nfe_fiscal_operational_http_begin($1,$2,'OAUTH') value`,
        [jobs[i+1].execution_id,jobs[i+1].lease_token])))
      assert.ok(results.every(result=>result.rows[0].value.code==='WAIT'))
    } finally { await Promise.all(peers.map(peer=>peer.end())) }
    const noLateDelete=await db.query(`DELETE FROM public.notas_fiscais WHERE id=$1`,[jobs[0].nota_fiscal_id]).catch(e=>e)
    assert.equal(noLateDelete.code,'55000')
    await db.query(`UPDATE public.nfe_fiscal_execucoes SET lease_until=clock_timestamp()-interval '1 second'
      WHERE status='EM_PROCESSAMENTO'`)
    assert.equal((await service.query(`SELECT public.nfe_fiscal_operational_recover() n`)).rows[0].n,15)
    assert.equal((await service.query(`SELECT public.nfe_fiscal_operational_recover() n`)).rows[0].n,0)
    assert.equal((await service.query(`SELECT * FROM public.nfe_fiscal_operational_claim(1)`)).rows.length,0)
    const status=(await db.query(`SELECT status,error_code FROM public.nfe_fiscal_execucoes WHERE id=$1`,[jobs[0].execution_id])).rows[0]
    assert.deepEqual(status,{status:'FALHOU',error_code:'HTTP_OUTCOME_UNKNOWN'})
    const late=(await service.query(`SELECT public.nfe_fiscal_operational_complete($1,$2,'CONSULTADO','VERDE',
      'late synthetic',clock_timestamp(),200,$3,'{}','[]','[]') accepted`,
      [jobs[0].execution_id,jobs[0].lease_token,'a'.repeat(64)])).rows[0]
    assert.equal(late.accepted,false)
    const immutable=await db.query(`UPDATE public.nfe_fiscal_execucoes SET status='SOLICITADA' WHERE id=$1`,
      [jobs[0].execution_id]).catch(e=>e)
    assert.equal(immutable.code,'42501')
    assert.equal((await db.query(`SELECT count(*)::int n FROM public.nfe_fiscal_execucoes
      WHERE id=ANY($1::uuid[]) AND status='INDISPONIVEL'`,[jobs.slice(1).map(j=>j.execution_id)])).rows[0].n,14)
    const meter=(await db.query(`SELECT oauth_dispatch_count,get_dispatch_count,http_response_count,circuit_state
      FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO'`)).rows[0]
    assert.equal(Number(meter.oauth_dispatch_count),7)
    assert.equal(Number(meter.get_dispatch_count),7)
    assert.equal(Number(meter.http_response_count),13)
    assert.equal(meter.circuit_state,'OPEN')
    assert.equal((await db.query(`SELECT bool_and(b.authorized_at>=a.observed_at+interval '100 milliseconds') valid
      FROM private.nfe_fiscal_http_attempts a JOIN private.nfe_fiscal_http_attempts b ON b.authorized_at>a.authorized_at
      WHERE NOT EXISTS(SELECT 1 FROM private.nfe_fiscal_http_attempts m
        WHERE m.authorized_at>a.authorized_at AND m.authorized_at<b.authorized_at)`)).rows[0].valid,true)
    assert.equal((await db.query(`SELECT has_function_privilege('service_role','public.nfe_fiscal_claim(integer)','EXECUTE') allowed`)).rows[0].allowed,false)
    // Deleting an OFF draft remains possible without destroying its fiscal audit.
    await db.query(`DELETE FROM public.notas_fiscais WHERE id=$1`,[ids.noteHistorical])
    assert.equal((await db.query(`SELECT count(*)::int n FROM public.nfe_fiscal_execucoes WHERE nota_fiscal_id=$1`,[ids.noteHistorical])).rows[0].n,1)
    const reimportId='c2600000-0000-4000-8000-999999999999'
    await insertNoteAs(db,reimportId,ids.fundoA,ids.vinculoA,makeNfeKey(2190),ids.cedenteUser,'NFE')
    assert.deepEqual((await db.query(`SELECT status,eligible_post_cutover FROM public.nfe_fiscal_execucoes WHERE nota_fiscal_id=$1`,
      [reimportId])).rows,[{status:'BLOQUEADA_OFF',eligible_post_cutover:false}])
    evidence.assertions.crashRecovery={expired:15,safeUnsentRetry:14,uncertainTerminal:1,
      noAutomaticRepeatOfUncertainHttp:true,lateCompletionRejected:true,recoveryReplayNoop:true,
      terminalEvidenceImmutable:true,originalDraftDeletionKeepsAudit:true,activeDeletionDenied:true,
      globalHttpSerialized:true,concurrentWorkersBlocked:4,minSpacingMs:100,oauthAndGetCountedSeparately:true,
      historicalIdentityUpdateNeverEnqueues:true,reimportOfHistoricalKeyExcluded:true,meter}
  } finally { await service.end() }
}

async function completeSynthetic(client, job, includeCriticalEvent) {
  await simulateHttp(client, job, 'OAUTH', 200)
  await simulateHttp(client, job, 'GET_NFE', 200)
  const events = includeCriticalEvent ? [{
    codigo: '110111', descricao: 'Cancelamento sintético confirmado', protocolo: 'SYNTHETIC-PROTOCOL',
    fato_em: '2026-10-28T18:00:00Z', registrado: true, severidade: 'VERMELHO', fingerprint: 'f'.repeat(64),
  }] : []
  const row = (await client.query(`
    SELECT public.nfe_fiscal_operational_complete(
      $1,$2,'INCONCLUSIVO','AMARELO','Cobertura parcial sintetica',
      '2026-10-28T18:00:00Z',200,$3,$4::jsonb,'[]'::jsonb,$5::jsonb
    ) value
  `, [job.execution_id, job.lease_token, 'a'.repeat(64), JSON.stringify({ protocolStatus: '100' }), JSON.stringify(events)])).rows[0]
  assert.equal(row.value, true)
}

async function simulateHttp(client, job, phase, status) {
  let grant
  for (let i=0;i<100;i++) {
    grant=(await client.query(`SELECT public.nfe_fiscal_operational_http_begin($1,$2,$3) value`,
      [job.execution_id,job.lease_token,phase])).rows[0].value
    if (grant.code!=='WAIT') break
    await new Promise(done=>setTimeout(done,100))
  }
  assert.equal(grant.code,'AUTHORIZED')
  assert.equal((await client.query(`SELECT public.nfe_fiscal_operational_http_observed($1,$2,$3) value`,
    [grant.ticket,job.lease_token,status])).rows[0].value,true)
}

async function callManual(userId, sessionId, noteId, requestReference) {
  const client = new Client({ ...connection, application_name: `s2_2_manual_${userId || 'anon'}` })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL ROLE ${userId ? 'authenticated' : 'anon'}`)
    const claims = userId
      ? JSON.stringify({ sub: userId, role: 'authenticated', aal: 'aal2', session_id: sessionId })
      : JSON.stringify({ role: 'anon' })
    await client.query(`SELECT set_config('request.jwt.claims',$1,true)`, [claims])
    const result = (await client.query(`SELECT public.solicitar_reconsulta_nfe_fiscal_operacional($1,$2) value`, [noteId, requestReference])).rows[0].value
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }
}

async function expectManualDenied(userId, sessionId, noteId, requestReference) {
  let caught
  try {
    await callManual(userId, sessionId, noteId, requestReference)
  } catch (error) {
    caught = error
  }
  assert.ok(caught, `${requestReference}: negacao esperada`)
  assert.equal(caught.code, '42501')
}

async function openServiceClient(label) {
  const client = new Client({ ...connection, application_name: `s2_2_${label}` })
  await client.connect()
  await client.query('SET ROLE service_role')
  const claims = JSON.stringify({ role: 'service_role' })
  await client.query(`SELECT set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.role','service_role',false)`, [claims])
  return client
}

function makeNfeKey(number) {
  const base = `3526101422486400010055002${String(number).padStart(9, '0')}1${String(number + 90000000).slice(-8)}`
  assert.equal(base.length, 43)
  let sum = 0
  let weight = 2
  for (let index = base.length - 1; index >= 0; index -= 1) {
    sum += Number(base[index]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const remainder = sum % 11
  const digit = remainder === 0 || remainder === 1 ? 0 : 11 - remainder
  return `${base}${digit}`
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
