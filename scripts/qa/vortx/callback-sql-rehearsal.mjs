import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { runCallbackAdminChecks } from './callback-admin-checks.mjs'
import { runCallbackDiagnosticChecks } from './callback-diagnostic-checks.mjs'
import { runCallbackCaptureChecks } from './callback-capture-checks.mjs'

// Synthetic, focused SQL contract rehearsal; not hosted Auth/Storage E2E.
const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-callback-20261019', `sql-${Date.now()}`)
mkdirSync(output, { recursive: true })
const sha = value => createHash('sha256').update(value).digest('hex')
const paths = ['supabase/migrations/20261019180624_vortx_report_requests_preview.sql', 'supabase/migrations/20261019201346_vortx_report_callback_inbox.sql', 'supabase/migrations/20261019203424_vortx_callback_admin_ui.sql', 'supabase/migrations/20261019211756_vortx_report_audit_event_types.sql', 'supabase/migrations/20261020134509_vortx_callback_rejected_diagnostics.sql']
paths.push('supabase/migrations/20261020165910_vortx_callback_single_capture_preview.sql')
const migrations = paths.map(path => ({ path, sql: readFileSync(resolve(root, path), 'utf8') }))
const canonical = JSON.parse(readFileSync(new URL('./__fixtures__/report-auth-canonical.json', import.meta.url), 'utf8')).functions
const auditConstraint = JSON.parse(readFileSync(new URL('./__fixtures__/callback-audit-constraint.json', import.meta.url), 'utf8'))
assert.equal(canonical.length, 5)
function docker(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 60000 })
  assert.equal(r.status, 0, `DOCKER_${args[0]}_FAILED`); return r.stdout.trim()
}
const inventory = () => ({ containers: docker(['ps', '-aq']).split(/\s+/).filter(Boolean).sort(), networks: docker(['network', 'ls', '-q']).split(/\s+/).filter(Boolean).sort() })
const before = inventory()
const report = { scope: 'LOCAL_SYNTHETIC_FOCUSED_SQL', auditConstraintSha256: sha(auditConstraint.expression), migrations: migrations.map(m => ({ path: m.path, sha256: sha(m.sql) })),
  canonicalFunctions: canonical.map(f => ({ name: f.name, sha256: sha(f.definition) })), stacks: [], error: null, DOCKER_TEST_ENV_CLEANUP: false }
const bootstrap = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema private; grant usage on schema public,auth,private to authenticated;
create table public.profiles(id uuid primary key,status text not null);
create table public.usuario_papeis(usuario_id uuid,papel text,ativo boolean);
create table public.fundos(id uuid primary key,ativo boolean);
create table public.usuario_fundos(usuario_id uuid,fundo_id uuid,status text);
create table auth.sessions(id uuid primary key,user_id uuid,aal text,not_after timestamptz);
create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);
create table public.sessoes_elevadas(user_id uuid,session_id uuid,elevada_em timestamptz,expira_em timestamptz,revogada_em timestamptz,metodo text,factor_id text);
create table public.autorizacoes_acoes_sensiveis(id uuid primary key,user_id uuid,session_id uuid,action_type text,nonce_hash text,consumida_em timestamptz,revogada_em timestamptz,expira_em timestamptz);
create table public.integracoes_fundo(id uuid primary key,fundo_id uuid,status text,provider_key text);
create table public.integracao_fundo_versoes(id uuid primary key,integracao_fundo_id uuid,ambiente text,status text,adapter_key text,configuracao_nao_sensivel jsonb);
create table public.integracao_fundo_versao_capacidades(integracao_fundo_versao_id uuid,fundo_id uuid,ambiente text,capability text,disponivel_desde timestamptz,disponivel_ate timestamptz);
create table public.seguranca_eventos(id uuid primary key default gen_random_uuid(),tipo_evento text not null CONSTRAINT seguranca_eventos_tipo_check CHECK (${auditConstraint.expression}),ator_usuario_id uuid references profiles(id),ator_tipo text not null default 'usuario' check(ator_tipo in ('usuario','sistema','cron','integracao')),origem text not null default 'app',severidade text not null default 'info' check(severidade in ('info','warning','critical')),entidade_tipo text,entidade_id uuid,dados jsonb not null default '{}' check(jsonb_typeof(dados)='object'));
`
try {
  for (let iteration = 1; iteration <= 2; iteration++) {
    const scope = `bw-vortx-callback-${Date.now()}-${iteration}`
    const stack = { iteration, checks: [], cleanup: false }; report.stacks.push(stack)
    let container = false, network = false, db
    const check = name => stack.checks.push(name)
    try {
      docker(['network', 'create', '--label', `bw.qa.scope=${scope}`, '--opt', 'com.docker.network.bridge.enable_icc=false', scope]); network = true
      const password = randomBytes(32).toString('hex')
      docker(['run', '-d', '--name', scope, '--label', `bw.qa.scope=${scope}`, '--network', scope, '-p', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data', '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:17-alpine']); container = true
      const mapping = docker(['port', scope, '5432/tcp']); assert.match(mapping, /^127\.0\.0\.1:\d+$/)
      const config = { host: '127.0.0.1', port: Number(mapping.split(':')[1]), user: 'postgres', password, database: 'postgres', connectionTimeoutMillis: 3000, query_timeout: 15000 }
      for (let attempt = 0; attempt < 40; attempt++) {
        db = new pg.Client(config)
        try { await db.connect(); break } catch { await db.end().catch(() => {}); db = null; await new Promise(r => setTimeout(r, 500)) }
      }
      assert(db, 'LOCAL_POSTGRES_UNAVAILABLE'); await db.query(bootstrap)
      for (const f of canonical) await db.query(f.definition)
      await db.query(migrations[0].sql)
      const preserved = async () => (await db.query(`select n.nspname,p.proname,pg_get_functiondef(p.oid) as definition,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','private','public') and p.proname not like 'vortx_%' and p.proname not like 'admin_vortx_callback_%' order by n.nspname,p.proname,p.oid`)).rows
      // Also preserve private request reservation/transition/access functions, not only public wrappers.
      const requestInternals = async () => (await db.query(`select proname,pg_get_functiondef(oid) as definition,proacl::text from pg_proc where pronamespace='private'::regnamespace and proname like 'vortx_relatorio_%' order by proname`)).rows
      const baseline = { canonical: await preserved(), requestInternals: await requestInternals() }
      if (process.env.VORTX_CALLBACK_REHEARSE_PAYLOAD) {
        const payload = JSON.parse(readFileSync(process.env.VORTX_CALLBACK_REHEARSE_PAYLOAD, 'utf8'))
        assert.equal(payload.project, 'phdckowbexkkvuwnzeaf')
        assert(payload.entries.every(e => migrations.some(m => m.path === e.path && sha(m.sql) === e.sha256)))
        assert.equal(sha(payload.query), payload.querySha256)
        await db.query('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])')
        await db.query(payload.query)
        check('managed_api_payload_hash_guards_transaction_history_and_business_preservation')
      } else {
        await db.query(migrations[1].sql)
        await db.query(migrations[2].sql)
      }
      assert.deepEqual(await preserved(), baseline.canonical); assert.deepEqual(await requestInternals(), baseline.requestInternals)
      stack.preservedFunctionsSha256 = sha(JSON.stringify(baseline)); check('migration_applies_without_editing_existing_functions_or_grants')
      const fund = randomUUID(), otherFund = randomUUID(), version = randomUUID(), integration = randomUUID(), otherVersion = randomUUID(), otherIntegration = randomUUID()
      const wallet = 'qa-wallet-synthetic'
      await db.query('insert into fundos values($1,true),($2,true)', [fund, otherFund])
      await db.query("insert into integracoes_fundo values($1,$2,'ativa','VORTX'),($3,$4,'ativa','VORTX')", [integration, fund, otherIntegration, otherFund])
      for (const [v, i] of [[version, integration], [otherVersion, otherIntegration]]) await db.query("insert into integracao_fundo_versoes values($1,$2,'producao','publicada','vortx_vrs',$3)", [v, i, { codigo_carteira: wallet }])
      for (const capability of ['ESTOQUE', 'AQUISICOES', 'LIQUIDACOES']) await db.query("insert into integracao_fundo_versao_capacidades values($1,$2,'producao',$3,now()-interval '1 day',null)", [version, fund, capability])
      async function actor({ superAdmin = true, bound = fund } = {}) {
        const a = { id: randomUUID(), session: randomUUID(), factor: randomUUID() }
        await db.query("insert into profiles values($1,'ativo')", [a.id])
        if (superAdmin) await db.query("insert into usuario_papeis values($1,'super_admin',true)", [a.id])
        if (bound) await db.query("insert into usuario_fundos values($1,$2,'ativo')", [a.id, bound])
        await db.query("insert into auth.sessions values($1,$2,'aal2',null)", [a.session, a.id])
        await db.query("insert into auth.mfa_factors values($1,$2,'verified')", [a.factor, a.id])
        await db.query("insert into sessoes_elevadas values($1,$2,now(),now()+interval '1 hour',null,'totp',$3)", [a.id, a.session, a.factor]); return a
      }
      const admin = await actor(), ordinary = await actor({ superAdmin: false }), cross = await actor({ bound: otherFund }), unbound = await actor({ bound: null })
      async function begin(c, role, a = null, claims = {}) {
        assert(['authenticated', 'anon', 'service_role'].includes(role))
        await c.query('begin'); await c.query(`set local role ${role}`)
        await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: a?.id, session_id: a?.session, aal: 'aal2', role, ...claims })])
      }
      async function as(role, sql, params = [], a = null, claims = {}, client = db) {
        await begin(client, role, a, claims)
        try { const r = await client.query(sql, params); await client.query('commit'); return r } catch (error) { await client.query('rollback'); throw error }
      }
      const worker = (sql, params = [], client = db) => as('service_role', sql, params, null, {}, client)
      const user = (sql, params = [], a = admin, claims = {}) => as('authenticated', sql, params, a, claims)
      const configure = 'select vortx_configurar_callback($1,$2,$3) as r'
      const authorize = 'select vortx_autorizar_callback($1,$2) as r'
      const receive = 'select vortx_receber_callback($1,$2,$3,$4,$5,$6,$7) as r'
      const secretHash = sha(randomBytes(32)), newerHash = sha(randomBytes(32))
      const deniedAudit = { code: '23514', constraint: 'seguranca_eventos_tipo_check' }
      await assert.rejects(worker(configure, [fund, version, secretHash]), deniedAudit)
      const rollbackNonce = sha(randomUUID())
      await db.query("insert into autorizacoes_acoes_sensiveis values($1,$2,$3,'configurar_credencial_vortx_vrs',$4,null,null,now()+interval '2 minutes')", [randomUUID(), admin.id, admin.session, rollbackNonce])
      await assert.rejects(user('select admin_vortx_callback_mutar($1,$2,$3,0,$4,$5)', [fund, version, 'gerar', secretHash, rollbackNonce]), deniedAudit)
      assert.equal((await db.query('select count(*)::int n from private.vortx_callback_endpoints')).rows[0].n, 0)
      assert.equal((await db.query('select consumida_em from autorizacoes_acoes_sensiveis where nonce_hash=$1', [rollbackNonce])).rows[0].consumida_em, null)
      check('real_audit_constraint_reproduces_23514_and_rolls_back_endpoint_and_nonce')
      const legacyTypes = [...auditConstraint.expression.matchAll(/'([^']+)'::text/g)].map(m => m[1])
      assert(legacyTypes.length >= 40)
      for (const type of legacyTypes) await db.query('insert into seguranca_eventos(tipo_evento,dados) values($1,$2)', [type, { synthetic: true }])
      const auditsBefore = (await db.query('select * from seguranca_eventos')).rows
      if (process.env.VORTX_CALLBACK_AUDIT_REHEARSE_PAYLOAD) {
        const payload = JSON.parse(readFileSync(process.env.VORTX_CALLBACK_AUDIT_REHEARSE_PAYLOAD, 'utf8'))
        assert.equal(payload.project, auditConstraint.project)
        assert.equal(payload.entry.path, migrations[3].path)
        assert.equal(payload.entry.sha256, sha(migrations[3].sql))
        assert.equal(payload.querySha256, sha(payload.query))
        await db.query('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])')
        // These three sources really ran earlier in this disposable stack.
        for (const migration of migrations.slice(0, 3)) {
          const [, version, name] = migration.path.match(/\/(\d+)_(.+)\.sql$/)
          await db.query('insert into supabase_migrations.schema_migrations values($1,$2,$3)', [version, name, [migration.sql]])
        }
        await db.query(payload.query)
        assert.equal((await db.query('select name from supabase_migrations.schema_migrations where version=$1', [payload.entry.version])).rows[0].name, payload.entry.name)
        check('exact_managed_payload_preserves_rows_functions_grants_policies_and_records_actual_execution')
      } else await db.query(migrations[3].sql)
      const constraintAfter = (await db.query("select pg_get_constraintdef(oid) definition,convalidated from pg_constraint where conrelid='seguranca_eventos'::regclass and conname='seguranca_eventos_tipo_check'")).rows[0]
      assert.equal(constraintAfter.convalidated, true)
      await db.query(migrations[3].sql)
      assert.deepEqual((await db.query("select pg_get_constraintdef(oid) definition,convalidated from pg_constraint where conrelid='seguranca_eventos'::regclass and conname='seguranca_eventos_tipo_check'")).rows[0], constraintAfter)
      assert.deepEqual((await db.query('select * from seguranca_eventos')).rows, auditsBefore)
      for (const type of legacyTypes) await db.query('insert into seguranca_eventos(tipo_evento,dados) values($1,$2)', [type, { synthetic: true, after: true }])
      await assert.rejects(db.query("insert into seguranca_eventos(tipo_evento,dados) values('QA_UNKNOWN_AUDIT_EVENT','{}')"), deniedAudit)
      check('audit_fix_validated_idempotent_preserves_history_and_rejects_unknown_events')
      await db.query(migrations[4].sql)
      const endpoint = (await worker(configure, [fund, version, secretHash])).rows[0].r.id
      check('worker_registration_derived_from_published_active_integration')
      await runCallbackDiagnosticChecks({ db, fund, integration, endpoint, secretHash, worker, as, check })
      const oldFunctions = (await db.query("select oid,pg_get_functiondef(oid) as definition,proacl::text from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace,'auth'::regnamespace) order by oid")).rows
      await db.query(migrations[5].sql)
      await runCallbackCaptureChecks({ db, config, fund, otherFund, integration, endpoint, worker, as, check })
      assert.deepEqual((await db.query('select oid,pg_get_functiondef(oid) as definition,proacl::text from pg_proc where oid=ANY($1::oid[]) order by oid', [oldFunctions.map(f => f.oid)])).rows, oldFunctions)
      check('capture_migration_preserves_every_existing_function_and_function_grant')
      await assert.rejects(worker(configure, [otherFund, otherVersion, sha('cross')]), { code: '42501' })
      await assert.rejects(worker(configure, [otherFund, version, sha('cross')]), { code: '42501' })
      const hom = randomUUID()
      await db.query("insert into integracao_fundo_versoes values($1,$2,'homologacao','publicada','vortx_vrs',$3)", [hom, integration, { codigo_carteira: wallet }])
      await assert.rejects(worker(configure, [fund, hom, sha('cross')]), { code: '42501' })
      check('one_wallet_cannot_be_silently_rebound_to_other_fund_integration_or_environment')
      for (const role of ['anon', 'authenticated']) for (const [sql, params] of [[configure, [fund, version, secretHash]], [authorize, [endpoint, secretHash]], ['select vortx_revogar_callback($1)', [endpoint]]]) await assert.rejects(as(role, sql, params, admin), { code: '42501' })
      await assert.rejects(as('service_role', authorize, [endpoint, secretHash], null, { role: 'authenticated' }), { code: '42501' })
      check('public_rpc_grants_and_worker_claim_checked')
      assert.equal((await worker(authorize, [endpoint, secretHash])).rows[0].r.status, 'AUTHORIZED')
      assert.equal((await worker(authorize, [endpoint, sha('wrong')])).rows[0].r.status, 'UNAUTHORIZED')
      check('invalid_secret_denied')
      let serial = 0
      async function reserve() {
        serial++
        const nonce = sha(randomUUID()), lease = randomBytes(32).toString('hex')
        await db.query("insert into autorizacoes_acoes_sensiveis values($1,$2,$3,'testar_conexao_vortx_vrs',$4,null,null,now()+interval '2 minutes')", [randomUUID(), admin.id, admin.session, nonce])
        const start = `2026-09-${String(serial).padStart(2, '0')}`
        const r = (await user('select admin_reservar_relatorio_vortx($1,$2,$3,$4,$5,$6,2,$7,$8) as r', [fund, version, 'PosicaoParcela', start, '2026-10-16', '2026-10-16', nonce, sha(lease)])).rows[0].r
        assert(r.criada)
        await user('select admin_transicionar_relatorio_vortx($1,$2,$3)', [r.solicitacao.id, lease, 'enviando'])
        return { id: r.solicitacao.id, lease, start, protocol: randomUUID() }
      }
      function metadata(req, changes = {}) {
        return { idRelatorio: req.protocol, idCarteira: wallet, tipoRelatorio: 'PosicaoParcela', statusRelatorio: 'Disponível', dataReferencia: '2026-10-16', dataInicio: req.start, dataFim: '2026-10-16', dataExpiracao: '2026-10-20T04:00:00.000Z', urlHash: sha('https://example.invalid/synthetic'), ...changes }
      }
      function args(meta, revision = 1, hash = secretHash) {
        const digest = sha(['VORTX_RELATORIO_CALLBACK_V1', endpoint, meta.idRelatorio, meta.idCarteira, meta.tipoRelatorio, meta.statusRelatorio, meta.dataReferencia, meta.dataInicio, meta.dataFim, meta.dataExpiracao ?? '', meta.urlHash ?? ''].join('|'))
        return [endpoint, hash, revision, meta, digest, 'v1:synthetic-only-not-cryptographic-proof', 'qa']
      }
      const acceptSql = 'select admin_transicionar_relatorio_vortx($1,$2,$3,$4,200)'
      const acceptArgs = req => [req.id, req.lease, 'aceita', req.protocol]
      const first = await reserve(); await user(acceptSql, acceptArgs(first))
      const firstMeta = metadata(first)
      const received = (await worker(receive, args(firstMeta))).rows[0].r
      assert.deepEqual(received, { recebido: true, duplicado: false })
      assert.deepEqual((await worker(receive, args(firstMeta))).rows[0].r, { recebido: true, duplicado: true })
      assert.equal((await db.query('select count(*)::int n from vortx_relatorio_eventos')).rows[0].n, 1)
      assert.equal((await db.query("select count(*)::int n from seguranca_eventos where tipo_evento='VORTX_CALLBACK_RECEBIDO'")).rows[0].n, 1)
      check('exact_duplicate_one_event_one_audit')
      assert.equal((await db.query('select solicitacao_id from vortx_relatorio_eventos')).rows[0].solicitacao_id, first.id)
      check('exact_protocol_wallet_fund_integration_type_dates_correlated')
      const requestBefore = (await db.query('select * from vortx_relatorio_solicitacoes order by id')).rows
      for (const changes of [{ statusRelatorio: 'Em geração', urlHash: null, dataExpiracao: null }, { statusRelatorio: 'Expirado' }, { urlHash: sha('renewed-url') }]) await worker(receive, args(metadata(first, changes)))
      assert.deepEqual((await db.query('select * from vortx_relatorio_solicitacoes order by id')).rows, requestBefore)
      check('status_and_renewed_url_events_append_without_rewriting_request')
      for (const [label, change] of [['type', { tipoRelatorio: 'Inclusao' }], ['reference', { dataReferencia: '2026-10-15' }], ['start', { dataInicio: '2026-09-02' }], ['end', { dataFim: '2026-10-15' }]]) {
        const meta = metadata(first, change); await worker(receive, args(meta))
        const r = (await db.query('select correlacao,solicitacao_id from vortx_relatorio_eventos where hash_evento=$1', [args(meta)[4]])).rows[0]
        assert.deepEqual(r, { correlacao: 'CONFLITANTE', solicitacao_id: null }); check(`mismatched_${label}_quarantined_without_binding`)
      }
      await assert.rejects(worker(receive, args(metadata(first, { idCarteira: 'other' }))), { code: '22023' }); check('cross_wallet_denied')
      await assert.rejects(worker(receive, args(metadata(first, { urlRelatorio: 'https://example.invalid/plaintext' }))), { code: '22023' })
      const tampered = args(firstMeta); tampered[4] = sha('tampered'); await assert.rejects(worker(receive, tampered), { code: '23514' })
      check('strict_metadata_no_plaintext_url_and_digest_verified')
      const orphan = metadata({ protocol: randomUUID(), start: first.start }); await worker(receive, args(orphan))
      assert.equal((await db.query('select correlacao from vortx_relatorio_eventos where protocolo_externo=$1', [orphan.idRelatorio])).rows[0].correlacao, 'PENDENTE')
      const early = await reserve(); await worker(receive, args(metadata(early)))
      await user(acceptSql, acceptArgs(early))
      assert.equal((await db.query('select solicitacao_id from vortx_relatorio_eventos where protocolo_externo=$1', [early.protocol])).rows[0].solicitacao_id, early.id)
      check('unknown_protocol_pending_and_early_callback_correlates_after_protocol_commit')
      // Deterministic concurrency: hold the first transaction, prove the second is lock-waiting,
      // then commit. No timeout/empty result is classified as a successful race test.
      for (const order of ['callback_first', 'protocol_first']) {
        const req = await reserve(), c1 = new pg.Client(config), c2 = new pg.Client(config)
        await c1.connect(); await c2.connect()
        try {
          await begin(c1, order === 'callback_first' ? 'service_role' : 'authenticated', admin)
          await c1.query(order === 'callback_first' ? receive : acceptSql, order === 'callback_first' ? args(metadata(req)) : acceptArgs(req))
          const pid = (await c2.query('select pg_backend_pid() pid')).rows[0].pid
          let done = false
          const waiting = as(order === 'callback_first' ? 'authenticated' : 'service_role', order === 'callback_first' ? acceptSql : receive,
            order === 'callback_first' ? acceptArgs(req) : args(metadata(req)), admin, {}, c2).finally(() => { done = true })
          let locked = false
          for (let n = 0; n < 50; n++) {
            locked = (await db.query("select wait_event_type='Lock' locked from pg_stat_activity where pid=$1", [pid])).rows[0]?.locked
            if (locked) break
            await new Promise(r => setTimeout(r, 20))
          }
          assert(locked && !done, 'EXPECTED_PROTOCOL_LOCK_NOT_OBSERVED'); await c1.query('commit'); await waiting
          assert.equal((await db.query('select solicitacao_id from vortx_relatorio_eventos where protocolo_externo=$1', [req.protocol])).rows[0].solicitacao_id, req.id)
          check(`concurrent_${order}_no_orphan_after_both_commits`)
        } finally { await c1.query('rollback').catch(() => {}); await c2.query('rollback').catch(() => {}); await c1.end(); await c2.end() }
      }
      // Synthetic fixture mutations below prepare negative scope cases, never change production.
      for (const [label, sql, params] of [
        ['fund', 'update vortx_relatorio_solicitacoes set fundo_id=$1 where id=$2', [otherFund, first.id]],
        ['integration', 'update vortx_relatorio_solicitacoes set integracao_versao_id=$1 where id=$2', [otherVersion, first.id]],
      ]) {
        await db.query(sql, params)
        const meta = metadata(first, { urlHash: sha(label) }); await worker(receive, args(meta))
        assert.equal((await db.query('select correlacao from vortx_relatorio_eventos where hash_evento=$1', [args(meta)[4]])).rows[0].correlacao, 'CONFLITANTE')
        await db.query('update vortx_relatorio_solicitacoes set fundo_id=$1,integracao_versao_id=$2 where id=$3', [fund, version, first.id]); check(`cross_${label}_protocol_never_bound`)
      }
      const visible = (await user('select id from vortx_relatorio_eventos')).rows.length; assert(visible > 0)
      for (const [label, a, claims] of [['ordinary', ordinary, {}], ['cross_fund', cross, {}], ['unbound', unbound, {}], ['aal1', admin, { aal: 'aal1' }], ['missing_session', admin, { session_id: null }]]) {
        assert.equal((await user('select id from vortx_relatorio_eventos', [], a, claims)).rowCount, 0); check(`summary_rls_${label}_denied`)
      }
      await db.query("update sessoes_elevadas set expira_em=now()-interval '1 second' where user_id=$1", [admin.id])
      assert.equal((await user('select id from vortx_relatorio_eventos')).rowCount, 0)
      await db.query("update sessoes_elevadas set expira_em=now()+interval '1 hour' where user_id=$1", [admin.id]); check('summary_requires_recent_canonical_mfa')
      await db.query("update usuario_fundos set status='inativo' where usuario_id=$1", [admin.id])
      assert.equal((await user('select id from vortx_relatorio_eventos')).rowCount, 0)
      await db.query("update usuario_fundos set status='ativo' where usuario_id=$1", [admin.id]); check('summary_inactive_fund_membership_denied')
      for (const sql of ['select metadados from vortx_relatorio_eventos', 'select payload_criptografado from vortx_relatorio_eventos', 'select chave_versao from vortx_relatorio_eventos', 'select * from private.vortx_callback_endpoints', 'select * from private.vortx_callback_limites', 'delete from vortx_relatorio_eventos', "update vortx_relatorio_eventos set correlacao='CONFLITANTE'"]) await assert.rejects(user(sql), { code: '42501' })
      await assert.rejects(as('anon', 'select id from vortx_relatorio_eventos'), { code: '42501' })
      for (const sql of ['select * from private.vortx_callback_endpoints', 'delete from vortx_relatorio_eventos']) await assert.rejects(worker(sql), { code: '42501' })
      check('no_direct_dml_no_secret_or_ciphertext_read_for_operator')
      await assert.rejects(db.query('delete from vortx_relatorio_eventos'), { code: '23514' })
      await assert.rejects(db.query("update vortx_relatorio_eventos set payload_criptografado='v1:tampered'"), { code: '23514' })
      check('event_immutability_even_for_fixture_owner')
      const identity = (await user('select current_user actor,(select rolbypassrls from pg_roles where rolname=current_user) bypass')).rows[0]
      assert.deepEqual(identity, { actor: 'authenticated', bypass: false }); check('real_non_owner_non_bypass_authenticated_rls_actor')
      await worker(configure, [fund, version, newerHash])
      assert.equal((await worker(authorize, [endpoint, secretHash])).rows[0].r.status, 'UNAUTHORIZED')
      await assert.rejects(worker(receive, args(orphan)), { code: '42501' })
      await assert.rejects(worker(receive, args(orphan, 1, newerHash)), { code: '42501' })
      assert.equal((await worker(authorize, [endpoint, newerHash])).rows[0].r.revisao, 2)
      await worker(receive, args(orphan, 2, newerHash)); check('rotation_fences_old_secret_and_stale_authorization_revision')
      await worker('select vortx_revogar_callback($1)', [endpoint])
      assert.equal((await worker(authorize, [endpoint, newerHash])).rows[0].r.status, 'UNAUTHORIZED')
      await assert.rejects(worker(receive, args(orphan, 2, newerHash)), { code: '42501' }); check('revocation_rechecked_at_persistence')
      await worker(configure, [fund, version, newerHash])
      await db.query('update fundos set ativo=false where id=$1', [fund])
      assert.equal((await worker(authorize, [endpoint, newerHash])).rows[0].r.status, 'UNAUTHORIZED')
      await assert.rejects(worker(receive, args(orphan, 4, newerHash)), { code: '42501' })
      await db.query('update fundos set ativo=true where id=$1', [fund]); check('inactive_fund_denies_authorization_and_receipt')
      await db.query("update integracoes_fundo set status='desativada' where id=$1", [integration])
      assert.equal((await worker(authorize, [endpoint, newerHash])).rows[0].r.status, 'UNAUTHORIZED')
      await assert.rejects(worker(receive, args(orphan, 4, newerHash)), { code: '42501' })
      await db.query("update integracoes_fundo set status='ativa' where id=$1", [integration]); check('inactive_integration_denies_authorization_and_receipt')
      // Rate limit uses fixed keys and atomic increments. No arbitrary endpoint IDs persisted.
      await db.query('delete from private.vortx_callback_limites')
      for (let n = 0; n < 5; n++) await worker(authorize, [randomUUID(), newerHash])
      assert.deepEqual((await db.query('select chave from private.vortx_callback_limites')).rows, [{ chave: 'GLOBAL' }]); check('unknown_endpoint_does_not_grow_rate_key_cardinality')
      await db.query('delete from private.vortx_callback_limites')
      const clients = await Promise.all(Array.from({ length: 4 }, async () => { const c = new pg.Client(config); await c.connect(); return c }))
      try {
        const statuses = (await Promise.all(clients.map(async c => {
          const results = []
          for (let n = 0; n < 32; n++) results.push((await worker(authorize, [endpoint, newerHash], c)).rows[0].r.status)
          return results
        }))).flat()
        assert.equal(statuses.filter(s => s === 'AUTHORIZED').length, 120)
        assert.equal(statuses.filter(s => s === 'RATE_LIMITED').length, 8)
        assert.equal((await db.query('select quantidade from private.vortx_callback_limites where chave=$1', [endpoint])).rows[0].quantidade, 128)
      } finally { await Promise.all(clients.map(c => c.end())) }
      check('concurrent_atomic_rate_limit_120_allowed_8_denied_no_lost_updates')
      await db.query("update private.vortx_callback_limites set quantidade=600 where chave='GLOBAL'")
      assert.equal((await worker(authorize, [endpoint, newerHash])).rows[0].r.status, 'RATE_LIMITED'); check('global_rate_limit')
      await db.query("update private.vortx_callback_limites set inicio=now()-interval '61 seconds'")
      assert.equal((await worker(authorize, [endpoint, newerHash])).rows[0].r.status, 'AUTHORIZED'); check('rate_window_reset')
      const audit = JSON.stringify((await db.query('select dados from seguranca_eventos')).rows)
      for (const secret of [secretHash, newerHash, 'https://example.invalid/', 'v1:synthetic']) assert(!audit.includes(secret))
      check('audit_has_no_secret_url_or_ciphertext')
      await runCallbackAdminChecks({ db, config, fund, otherFund, admin, ordinary, cross, unbound, as, user, worker, check })
      assert.deepEqual(await preserved(), baseline.canonical); assert.deepEqual(await requestInternals(), baseline.requestInternals)
    } finally {
      if (db) await db.end()
      if (container) { assert.equal(docker(['inspect', '--format', '{{index .Config.Labels "bw.qa.scope"}}', scope]), scope); docker(['rm', '-f', scope]); assert.equal(docker(['ps', '-aq', '--filter', `name=^/${scope}$`]), '') }
      if (network) { assert.equal(docker(['network', 'inspect', '--format', '{{index .Labels "bw.qa.scope"}}', scope]), scope); docker(['network', 'rm', scope]) }
      stack.cleanup = true
    }
  }
} catch (error) { report.error = { name: error.name, code: error.code ?? null, message: error.message?.slice(0, 300) }; process.exitCode = 1 }
finally {
  const after = inventory()
  report.DOCKER_TEST_ENV_CLEANUP = JSON.stringify(before) === JSON.stringify(after) && report.stacks.every(s => s.cleanup)
  if (!report.DOCKER_TEST_ENV_CLEANUP) process.exitCode = 1
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, passed: !report.error && report.DOCKER_TEST_ENV_CLEANUP, stacks: report.stacks.map(s => ({ iteration: s.iteration, checks: s.checks.length, cleanup: s.cleanup })), error: report.error, DOCKER_TEST_ENV_CLEANUP: report.DOCKER_TEST_ENV_CLEANUP }))
}
