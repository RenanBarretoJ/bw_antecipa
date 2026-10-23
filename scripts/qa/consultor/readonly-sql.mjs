import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

// Focused PostgreSQL policy proof, NOT native Supabase Auth/PostgREST/Storage E2E.
// Only the memory table has full RLS under test. Synthetic parent tables are
// SELECT-visible so parent-table RLS cannot conceal an overly broad policy.
// Auth claim adapters and the legacy Gestor fund predicate are fixture-only;
// consultant predicates and preexisting memory SELECT policies are verbatim repo SQL.
assert.deepEqual(process.argv.slice(2), ['--local-only'])
const read = path => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
const sha = value => createHash('sha256').update(value).digest('hex')
const migrationPath = 'supabase/migrations/20261023143138_consultor_operacao_memoria_readonly.sql'
const migration = read(migrationPath)
assert(migration.trim(), 'MIGRATION_EMPTY_WAIT_FOR_MAIN')
const canonicalPath = 'supabase/migrations/20260925144547_c1_1_autorizacao_organizacional.sql'
const hardenedPath = 'supabase/migrations/20260925181927_c1_1_corrigir_rls_consultor_dashboard.sql'
const historicalPath = 'supabase/migrations/20260805160000_metodos_calculo_financeiro_operacao.sql'
function functionSql(path, name) {
  const source = read(path)
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`)
  assert(start >= 0, `CANONICAL_FUNCTION_NOT_FOUND:${name}`)
  const end = source.indexOf('$$;', source.indexOf('AS $$', start))
  assert(end > start, 'CANONICAL_FUNCTION_END_NOT_FOUND')
  return source.slice(start, end + 3)
}
const helpers = [
  functionSql(hardenedPath, 'private.consultor_usuario_pode_operar_cedente'),
  functionSql(canonicalPath, 'private.consultor_tem_acesso_cedente'),
]
const historical = read(historicalPath)
const baselinePolicies = ['gestor', 'cedente'].map(role => {
  const name = `operacao_calculo_nfs_${role}_select`
  const start = historical.indexOf(`CREATE POLICY ${name}`)
  assert(start >= 0, `BASELINE_POLICY_MISSING:${name}`)
  return historical.slice(start, historical.indexOf(';', start) + 1)
})
function command(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 2 * 1024 * 1024 })
  assert.equal(result.status, 0, `DOCKER_${args.at(-1)}_FAILED:${String(result.stderr || result.error || '').slice(0, 300)}`)
  return result.stdout.trim()
}
const endpoint = process.env.DOCKER_HOST || command(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
assert(/^(npipe:|unix:)/.test(endpoint), 'REMOTE_DOCKER_REFUSED')
const docker = args => command(['--host', endpoint, ...args])
const inventory = () => Object.fromEntries([
  ['containers', ['ps', '-aq']], ['networks', ['network', 'ls', '-q']], ['volumes', ['volume', 'ls', '-q']],
].map(([key, args]) => [key, docker(args).split(/\s+/).filter(Boolean).sort()]))
const output = mkdtempSync(join(process.env.LOCALAPPDATA || tmpdir(), 'bw-consultor-readonly-sql-'))
const report = { scope: 'LOCAL_CONSULTOR_MEMORY_READONLY_SQL', migration: migrationPath,
  migrationSha256: sha(migration), helpers: [hardenedPath, canonicalPath], helperSha256: helpers.map(sha),
  limits: ['Synthetic FK parents; parent-table RLS intentionally not certified', 'Claim adapters are not native Auth/MFA',
    'Legacy Gestor fund helper uses synthetic membership', 'Does not certify application download guard, PostgREST or Storage'],
  stacks: [], remoteChanges: false, passed: false }
let before
try {
  before = inventory()
  // No pull/network download: fail explicitly if this local image is unavailable.
  docker(['image', 'inspect', 'postgres:17-alpine', '--format', '{{.Id}}'])
  for (let iteration = 1; iteration <= 2; iteration++) {
    const name = `bw-consultor-ro-${Date.now()}-${iteration}-${randomBytes(3).toString('hex')}`
    const stack = { iteration, tests: [], cleanup: false }
    report.stacks.push(stack)
    let db, container = false, network = false
    try {
      docker(['network', 'create', '--label', `bw.qa.scope=${name}`, name]); network = true
      const password = randomBytes(32).toString('hex')
      docker(['run', '--pull=never', '-d', '--name', name, '--label', `bw.qa.scope=${name}`, '--network', name,
        '-p', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data', '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:17-alpine'])
      container = true
      const mapping = docker(['port', name, '5432/tcp'])
      assert.match(mapping, /^127\.0\.0\.1:\d+$/)
      for (let attempt = 0; attempt < 40; attempt++) {
        db = new pg.Client({ host: '127.0.0.1', port: Number(mapping.split(':')[1]), user: 'postgres', password,
          database: 'postgres', connectionTimeoutMillis: 1500, statement_timeout: 10000 })
        try { await db.connect(); break } catch { await db.end().catch(() => {}); db = null; await new Promise(resolve => setTimeout(resolve, 500)) }
      }
      assert(db, 'LOCAL_POSTGRES_UNAVAILABLE')
      await db.query(`CREATE SCHEMA auth; CREATE SCHEMA private;
        CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
        CREATE TYPE public.cedente_status AS ENUM('ativo','inativo');
        CREATE TABLE profiles(id uuid PRIMARY KEY,role text,status text,cedente_id uuid);
        CREATE TABLE cedentes(id uuid PRIMARY KEY,status public.cedente_status);
        CREATE TABLE fundos(id uuid PRIMARY KEY,ativo boolean);
        CREATE TABLE cedente_fundos(id uuid PRIMARY KEY,cedente_id uuid REFERENCES cedentes,fundo_id uuid REFERENCES fundos,status text);
        CREATE TABLE consultores(id uuid PRIMARY KEY,status text);
        CREATE TABLE consultor_usuarios(id uuid PRIMARY KEY,consultor_id uuid REFERENCES consultores,user_id uuid REFERENCES profiles,status text,papel text);
        CREATE TABLE consultor_cedentes(id uuid PRIMARY KEY,consultor_id uuid REFERENCES consultores,cedente_id uuid REFERENCES cedentes,status text);
        CREATE TABLE consultor_fundos(id uuid PRIMARY KEY,consultor_id uuid REFERENCES consultores,fundo_id uuid REFERENCES fundos,status text);
        CREATE TABLE usuario_fundos(id uuid PRIMARY KEY,user_id uuid REFERENCES profiles,fundo_id uuid REFERENCES fundos);
        CREATE TABLE operacoes(id uuid PRIMARY KEY,cedente_id uuid REFERENCES cedentes,cedente_fundo_id uuid REFERENCES cedente_fundos);
        CREATE TABLE operacao_calculo_nfs(id uuid PRIMARY KEY,operacao_id uuid REFERENCES operacoes,cedente_id uuid REFERENCES cedentes,fundo_id uuid REFERENCES fundos,valor_presente numeric NOT NULL);
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid $$;
        CREATE FUNCTION public.get_user_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT role FROM public.profiles WHERE id=auth.uid() $$;
        CREATE FUNCTION public.get_user_cedente_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT cedente_id FROM public.profiles WHERE id=auth.uid() $$;
        CREATE FUNCTION private.usuario_tem_acesso_fundo(fundo uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM public.usuario_fundos WHERE user_id=auth.uid() AND fundo_id=fundo) $$;
        GRANT USAGE ON SCHEMA public,auth,private TO authenticated;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
        ALTER TABLE operacao_calculo_nfs ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON operacao_calculo_nfs FROM PUBLIC,anon,authenticated;
        GRANT SELECT ON operacao_calculo_nfs TO authenticated;`)
      for (const sql of helpers) await db.query(sql)
      await db.query(`REVOKE ALL ON FUNCTION private.consultor_usuario_pode_operar_cedente(uuid,uuid) FROM PUBLIC,anon;
        REVOKE ALL ON FUNCTION private.consultor_tem_acesso_cedente(uuid) FROM PUBLIC,anon;
        GRANT EXECUTE ON FUNCTION private.consultor_usuario_pode_operar_cedente(uuid,uuid),private.consultor_tem_acesso_cedente(uuid) TO authenticated;`)
      for (const sql of baselinePolicies) await db.query(sql)
      const ids = Object.fromEntries(['own','foreign','unlinked','reader','cedente','gestor','split',
        'orgA','orgB','orgC','orgD','orgE','cedA','cedB','fundA','fundB','cfA','cfB','cfOther',
        'opA','opA2','opB','opOther','memA','memA2','memB','memOther','memWrongFund','memWrongCed'].map(key => [key, randomUUID()]))
      async function insert(table, row) {
        assert(/^[a-z_]+$/.test(table))
        const columns = Object.keys(row)
        await db.query(`INSERT INTO public.${table}(${columns.join(',')}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row))
      }
      for (const key of ['cedA', 'cedB']) await insert('cedentes', { id: ids[key], status: 'ativo' })
      for (const key of ['fundA', 'fundB']) await insert('fundos', { id: ids[key], ativo: true })
      for (const key of ['orgA','orgB','orgC','orgD','orgE']) await insert('consultores', { id: ids[key], status: 'ativo' })
      for (const key of ['own','foreign','unlinked','reader','cedente','gestor','split']) await insert('profiles', {
        id: ids[key], role: ['cedente','gestor'].includes(key) ? key : 'consultor', status: 'ativo', cedente_id: key === 'cedente' ? ids.cedA : null,
      })
      const addMembership = async (user, org, papel = 'OPERADOR') => insert('consultor_usuarios', { id: randomUUID(), consultor_id: ids[org], user_id: ids[user], status: 'ativo', papel })
      await addMembership('own','orgA'); await addMembership('reader','orgA','LEITOR')
      await addMembership('foreign','orgB'); await addMembership('unlinked','orgC')
      await addMembership('split','orgD'); await addMembership('split','orgE')
      for (const [org, ced] of [['orgA','cedA'],['orgB','cedA'],['orgD','cedA'],['orgE','cedB']]) await insert('consultor_cedentes', { id: randomUUID(), consultor_id: ids[org], cedente_id: ids[ced], status: 'ativo' })
      for (const [org, fund] of [['orgA','fundA'],['orgB','fundB'],['orgC','fundA'],['orgD','fundA'],['orgE','fundB']]) await insert('consultor_fundos', { id: randomUUID(), consultor_id: ids[org], fundo_id: ids[fund], status: 'ativo' })
      for (const [key,ced,fund] of [['cfA','cedA','fundA'],['cfB','cedA','fundB'],['cfOther','cedB','fundA']]) await insert('cedente_fundos', { id: ids[key], cedente_id: ids[ced], fundo_id: ids[fund], status: 'ativo' })
      for (const [key,ced,cf] of [['opA','cedA','cfA'],['opA2','cedA','cfA'],['opB','cedA','cfB'],['opOther','cedB','cfOther']]) await insert('operacoes', { id: ids[key], cedente_id: ids[ced], cedente_fundo_id: ids[cf] })
      for (const [key,op,ced,fund] of [['memA','opA','cedA','fundA'],['memA2','opA2','cedA','fundA'],['memB','opB','cedA','fundB'],['memOther','opOther','cedB','fundA'],['memWrongFund','opA','cedA','fundB'],['memWrongCed','opA','cedB','fundA']]) await insert('operacao_calculo_nfs', { id: ids[key], operacao_id: ids[op], cedente_id: ids[ced], fundo_id: ids[fund], valor_presente: 95 })
      await insert('usuario_fundos', { id: randomUUID(), user_id: ids.gestor, fundo_id: ids.fundA })
      async function actor(user, sql = 'SELECT id FROM operacao_calculo_nfs ORDER BY id', setup = null, role = 'authenticated') {
        assert(['authenticated','anon'].includes(role))
        await db.query('BEGIN')
        try {
          if (setup) await db.query(setup.sql, setup.values)
          await db.query(`SET LOCAL ROLE ${role}`)
          await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: ids[user], role, aal: 'aal2' })])
          return await db.query(sql)
        } finally { await db.query('ROLLBACK') }
      }
      const visible = async (user, setup) => (await actor(user, undefined, setup)).rows.map(row => row.id).sort()
      const expected = keys => keys.map(key => ids[key]).sort()
      const dataSnapshot = async () => (await db.query('SELECT * FROM operacao_calculo_nfs ORDER BY id')).rows
      const metadata = async () => (await db.query(`SELECT c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
        (SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='operacao_calculo_nfs' AND policyname<>'operacao_calculo_nfs_consultor_select') policies,
        (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid) constraints
        FROM pg_class c WHERE c.oid='public.operacao_calculo_nfs'::regclass`)).rows
      const originalRows = await dataSnapshot(), originalMetadata = await metadata()
      const cedenteBefore = await visible('cedente'), gestorBefore = await visible('gestor')
      assert(cedenteBefore.length > 0 && gestorBefore.length > 0)
      for (const user of ['own','foreign','unlinked','reader','split']) assert.deepEqual(await visible(user), [])
      stack.tests.push('baseline_consultors_have_no_rows_and_legacy_roles_read')
      await db.query('BEGIN')
      try { await db.query(migration) } finally { await db.query('ROLLBACK') }
      assert.deepEqual(await visible('own'), [])
      assert.deepEqual(await metadata(), originalMetadata)
      assert.deepEqual(await dataSnapshot(), originalRows)
      stack.tests.push('exact_migration_rollback_restores_policy_metadata_and_rows')
      await db.query(migration)
      assert.deepEqual(await visible('own'), expected(['memA','memA2']))
      assert.deepEqual(await visible('foreign'), expected(['memB']))
      assert.deepEqual(await visible('split'), expected(['memA','memA2']))
      assert.deepEqual(await visible('unlinked'), [])
      assert.deepEqual(await visible('reader'), [])
      stack.tests.push('exact_allowed_set_same_cedente_own_fund_other_fund_other_cedente_unlinked_leitor_cross_org_pairs_and_memory_mismatch')
      for (const papel of ['OWNER','ADMIN']) {
        assert.deepEqual(await visible('own', { sql: 'UPDATE consultor_usuarios SET papel=$1 WHERE user_id=$2', values: [papel, ids.own] }), expected(['memA','memA2']))
      }
      stack.tests.push('owner_admin_operador_allowed')
      for (const [label, sql, values] of [
        ['inactive_cf', "UPDATE cedente_fundos SET status='suspenso' WHERE id=$1", [ids.cfA]],
        ['inactive_org', "UPDATE consultores SET status='inativo' WHERE id=$1", [ids.orgA]],
        ['inactive_fund', 'UPDATE fundos SET ativo=false WHERE id=$1', [ids.fundA]],
        ['inactive_user_membership', "UPDATE consultor_usuarios SET status='inativo' WHERE user_id=$1", [ids.own]],
        ['inactive_cedente_link', "UPDATE consultor_cedentes SET status='inativo' WHERE consultor_id=$1", [ids.orgA]],
        ['inactive_fund_link', "UPDATE consultor_fundos SET status='inativo' WHERE consultor_id=$1", [ids.orgA]],
        ['inactive_profile', "UPDATE profiles SET status='inativo' WHERE id=$1", [ids.own]],
        ['inactive_cedente', "UPDATE cedentes SET status='inativo' WHERE id=$1", [ids.cedA]],
      ]) {
        assert.deepEqual(await visible('own', { sql, values }), [], label)
        stack.tests.push(label)
      }
      assert.deepEqual(await visible('cedente'), cedenteBefore)
      assert.deepEqual(await visible('gestor'), gestorBefore)
      assert.deepEqual(await metadata(), originalMetadata)
      stack.tests.push('cedente_gestor_existing_policy_acl_rls_constraints_preserved')
      for (const user of ['own','reader','cedente','gestor']) {
        for (const sql of ['INSERT INTO operacao_calculo_nfs DEFAULT VALUES', 'UPDATE operacao_calculo_nfs SET valor_presente=1', 'DELETE FROM operacao_calculo_nfs']) {
          await assert.rejects(() => actor(user, sql), error => error.code === '42501', `${user}: write must be denied`)
        }
      }
      await assert.rejects(() => actor('own', undefined, null, 'anon'), error => error.code === '42501')
      assert.deepEqual(await dataSnapshot(), originalRows)
      assert.equal(sha(read(migrationPath)), report.migrationSha256, 'MIGRATION_CHANGED_DURING_PROOF_RERUN')
      stack.tests.push('insert_update_delete_and_anon_denied_preexisting_rows_preserved')
    } finally {
      await db?.end().catch(() => {})
      if (container) {
        assert.equal(docker(['inspect','--format','{{index .Config.Labels "bw.qa.scope"}}',name]), name)
        docker(['rm','-f',name])
      }
      if (network) {
        assert.equal(docker(['network','inspect','--format','{{index .Labels "bw.qa.scope"}}',name]), name)
        docker(['network','rm',name])
      }
      stack.cleanup = !docker(['ps','-aq','--filter',`label=bw.qa.scope=${name}`]) && !docker(['network','ls','-q','--filter',`label=bw.qa.scope=${name}`])
      assert(stack.cleanup, 'OWNED_RESOURCES_NOT_CLEANED')
    }
  }
  report.passed = report.stacks.length === 2 && report.stacks.every(stack => stack.tests.length > 0 && stack.cleanup)
} catch (error) {
  report.error = { message: String(error.message).slice(0, 700), code: error.code ?? null }
  process.exitCode = 1
} finally {
  try {
    const after = inventory()
    report.preexistingResourcesPreserved = before ? Object.keys(before).every(key => before[key].every(id => after[key].includes(id))) : null
    report.DOCKER_TEST_ENV_CLEANUP = before ? JSON.stringify(before) === JSON.stringify(after) && report.stacks.every(stack => stack.cleanup) : null
    if (report.DOCKER_TEST_ENV_CLEANUP !== true) { report.passed = false; process.exitCode = 1 }
  } catch { report.DOCKER_TEST_ENV_CLEANUP = false; report.passed = false; process.exitCode = 1 }
  writeFileSync(join(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, passed: report.passed, stacks: report.stacks.map(stack => ({ iteration: stack.iteration, checks: stack.tests.length, cleanup: stack.cleanup })), error: report.error ?? null, DOCKER_TEST_ENV_CLEANUP: report.DOCKER_TEST_ENV_CLEANUP }))
}
