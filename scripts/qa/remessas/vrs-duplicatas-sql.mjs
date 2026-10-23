import assert from 'node:assert/strict'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

// Focused constraint/RLS-policy rehearsal with synthetic FK parents and membership helper.
// Not a native Supabase Auth/Storage end-to-end certification.
assert.deepEqual(process.argv.slice(2), ['--local-only'])
assert(!process.env.DOCKER_HOST || /^(npipe:|unix:)/.test(process.env.DOCKER_HOST), 'REMOTE_DOCKER_REFUSED')
const read = path => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const historicalPath = 'supabase/migrations/20260826211301_p4_remessas_operacionais_adapter.sql'
const path = 'supabase/migrations/20261022211047_vrs_duplicata_parcela_keys.sql'
const historical = read(historicalPath), migration = read(path)
const table = historical.match(/CREATE TABLE public\.remessa_operacional_chaves \([\s\S]*?\n\);/)[0]
const policy = historical.match(/CREATE POLICY remessa_operacional_chaves_select_fundo[\s\S]*?\n\)\);/)[0]
const sha = value => createHash('sha256').update(value).digest('hex')
const output = resolve(process.env.LOCALAPPDATA || process.env.TMPDIR || '/tmp', 'bw-antecipa-evidence', `vrs-duplicatas-${Date.now()}`)
mkdirSync(output, { recursive: true })
function docker(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 })
  assert.equal(r.status, 0, `DOCKER_${args[0]}_FAILED`)
  return r.stdout.trim()
}
const inventory = () => Object.fromEntries([
  ['containers', ['ps', '-aq']], ['networks', ['network', 'ls', '-q']], ['volumes', ['volume', 'ls', '-q']],
].map(([key, args]) => [key, docker(args).split(/\s+/).filter(Boolean).sort()]))
const before = inventory()
const report = { scope: 'LOCAL_VRS_DUPLICATAS_FOCUSED_SQL', migration: path, sha256: sha(migration), historicalPath, historicalSha256: sha(historical), stacks: [], remoteChanges: false }
try {
  for (let iteration = 1; iteration <= 2; iteration++) {
    const name = `bw-vrs-dup-${Date.now()}-${iteration}`, stack = { iteration, tests: [], cleanup: false }
    report.stacks.push(stack)
    let db, container = false, network = false
    try {
      docker(['network', 'create', '--label', `bw.qa.scope=${name}`, name]); network = true
      const password = randomBytes(32).toString('hex')
      docker(['run', '-d', '--name', name, '--label', `bw.qa.scope=${name}`, '--network', name, '-p', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data', '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:17-alpine']); container = true
      const mapping = docker(['port', name, '5432/tcp'])
      assert.match(mapping, /^127\.0\.0\.1:\d+$/)
      for (let i = 0; i < 40; i++) {
        db = new pg.Client({ host: '127.0.0.1', port: Number(mapping.split(':')[1]), user: 'postgres', password, database: 'postgres', connectionTimeoutMillis: 3000 })
        try { await db.connect(); break } catch { await db.end().catch(() => {}); db = null; await new Promise(r => setTimeout(r, 500)) }
      }
      assert(db, 'LOCAL_POSTGRES_UNAVAILABLE')
      await db.query(`CREATE SCHEMA private; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
        GRANT USAGE ON SCHEMA public,private TO authenticated;
        CREATE TABLE public.remessas_operacionais(id uuid PRIMARY KEY, fundo_id uuid NOT NULL);
        CREATE TABLE public.remessa_operacional_arquivos(id uuid PRIMARY KEY, remessa_operacional_id uuid REFERENCES public.remessas_operacionais(id));
        CREATE TABLE public.operacoes(id uuid PRIMARY KEY); CREATE TABLE public.notas_fiscais(id uuid PRIMARY KEY);
        CREATE TABLE public.nota_fiscal_parcelas(id uuid PRIMARY KEY);
        CREATE FUNCTION private.usuario_tem_acesso_fundo(fundo uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
          SELECT fundo::text = current_setting('request.jwt.claims',true)::jsonb->>'synthetic_fundo' $$;
        GRANT SELECT ON public.remessas_operacionais,public.remessa_operacional_arquivos TO authenticated;`)
      await db.query(table)
      await db.query('ALTER TABLE public.remessa_operacional_chaves ENABLE ROW LEVEL SECURITY')
      await db.query(policy)
      for (const sql of historical.match(/(?:REVOKE ALL|GRANT SELECT(?:, INSERT, UPDATE, DELETE)?) ON TABLE public\.remessa_operacional_chaves[^;]*;/g)) await db.query(sql)
      const [fund, otherFund, remessa, otherRemessa, file, otherFile, operation, nf, parcel] = Array.from({ length: 9 }, () => randomUUID())
      await db.query('INSERT INTO remessas_operacionais VALUES($1,$2),($3,$4)', [remessa, fund, otherRemessa, otherFund])
      await db.query('INSERT INTO remessa_operacional_arquivos VALUES($1,$2),($3,$4)', [file, remessa, otherFile, otherRemessa])
      await db.query('INSERT INTO operacoes VALUES($1)', [operation]); await db.query('INSERT INTO notas_fiscais VALUES($1)', [nf])
      await db.query('INSERT INTO nota_fiscal_parcelas VALUES($1)', [parcel])
      async function insert(asset, flow, { fileId = file, parcelId = parcel, nfId = nf } = {}) {
        return db.query(`INSERT INTO remessa_operacional_chaves(remessa_operacional_arquivo_id,operacao_id,nota_fiscal_id,parcela_id,chave_unica_ativo,chave_unica_parcela)
          VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [fileId, operation, nfId, parcelId, asset, flow])
      }
      async function rejects(code, fn) { await assert.rejects(fn, e => e.code === code) }
      const legacy = (await insert(nf, `${nf}_004`)).rows[0].id
      await insert(nf, null, { parcelId: null })
      await rejects('23514', () => insert('3518/4', '3518/4-1', { fileId: otherFile }))
      const metadata = async () => (await db.query(`SELECT c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
        (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname) FROM pg_policies p WHERE p.tablename=c.relname) policies,
        (SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname)
         FROM pg_constraint WHERE conrelid=c.oid AND conname NOT IN('remessa_operacional_chaves_ativo_check','remessa_operacional_chaves_parcela_check')) constraints
        FROM pg_class c WHERE c.oid='public.remessa_operacional_chaves'::regclass`)).rows
      const baseline = await metadata()
      await db.query('BEGIN'); await db.query(migration); await db.query('ROLLBACK')
      await rejects('23514', () => insert('3518/4', '3518/4-1', { fileId: otherFile }))
      stack.tests.push('legacy_rows_preserved_and_transaction_rollback_restores_format')
      await db.query(migration)
      assert.deepEqual(await metadata(), baseline)
      assert.equal((await db.query('SELECT count(*)::int n FROM remessa_operacional_chaves WHERE id=$1', [legacy])).rows[0].n, 1)
      stack.tests.push('rls_policy_acl_fks_identity_coherence_unchanged')
      const duplicated = (await insert('3518/4', '3518/4-1', { fileId: otherFile })).rows[0].id
      await rejects('23505', () => insert('3518/4', '3518/4-1', { fileId: otherFile }))
      await rejects('23503', () => insert('3518/5', '3518/5-1', { nfId: randomUUID() }))
      await rejects('23514', () => insert('3518/4', null))
      for (const bad of ['', '../4', '3518/0', '3518/04', '3518/1000', 'x/4', '3518/4;X', '3518/4\nX', `${'1'.repeat(97)}/4`]) {
        await rejects('23514', () => insert(bad, '3518/4-1'))
      }
      for (const bad of ['3518/4-2', '3518/4-1/X', '3518/04-1', '../4-1', '3518/4-1\nX', `${'1'.repeat(97)}/4-1`]) {
        await rejects('23514', () => insert('3518/4', bad))
      }
      stack.tests.push('new_keys_accepted_and_invalid_formats_uniqueness_fks_coherence_rejected')
      for (const number of [4, 5]) {
        const p = randomUUID(); await db.query('INSERT INTO nota_fiscal_parcelas VALUES($1)', [p])
        await insert(`3518/${number}`, `3518/${number}-1`, { parcelId: p })
      }
      assert.equal((await db.query("SELECT count(*)::int n FROM remessa_operacional_chaves WHERE remessa_operacional_arquivo_id=$1 AND chave_unica_ativo LIKE '3518/%'", [file])).rows[0].n, 2)
      stack.tests.push('same_nf_multiple_selected_parcels_and_external_keys_scoped_by_file')
      async function asActor(role, actorFund, sql) {
        await db.query('BEGIN')
        try {
          assert(['authenticated', 'anon'].includes(role))
          await db.query(`SET LOCAL ROLE ${role}`)
          await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: randomUUID(), role, aal: 'aal2', synthetic_fundo: actorFund })])
          const r = await db.query(sql); await db.query('ROLLBACK'); return r
        } catch (error) { await db.query('ROLLBACK'); throw error }
      }
      const own = await asActor('authenticated', fund, 'SELECT id FROM remessa_operacional_chaves ORDER BY id')
      assert.equal(own.rows.length, 4); assert(!own.rows.some(r => r.id === duplicated))
      const other = await asActor('authenticated', otherFund, 'SELECT id FROM remessa_operacional_chaves ORDER BY id')
      assert.deepEqual(other.rows.map(r => r.id), [duplicated])
      assert.equal((await asActor('authenticated', randomUUID(), 'SELECT id FROM remessa_operacional_chaves')).rows.length, 0)
      await rejects('42501', () => asActor('anon', fund, 'SELECT id FROM remessa_operacional_chaves'))
      for (const sql of ['DELETE FROM remessa_operacional_chaves', "UPDATE remessa_operacional_chaves SET chave_unica_ativo='x'", "INSERT INTO remessa_operacional_chaves DEFAULT VALUES"]) {
        await rejects('42501', () => asActor('authenticated', fund, sql))
      }
      stack.tests.push('authenticated_fund_filtered_reads_unlinked_empty_anon_and_mutations_denied')
    } finally {
      await db?.end().catch(() => {})
      if (container) docker(['rm', '-f', name])
      if (network) docker(['network', 'rm', name])
      stack.cleanup = !docker(['ps', '-aq', '--filter', `label=bw.qa.scope=${name}`]) && !docker(['network', 'ls', '-q', '--filter', `label=bw.qa.scope=${name}`])
      assert(stack.cleanup, 'OWNED_RESOURCES_NOT_CLEANED')
    }
  }
  report.passed = true
} catch (error) {
  report.passed = false; report.error = { message: String(error.message).slice(0, 500), code: error.code ?? null }; process.exitCode = 1
} finally {
  report.DOCKER_TEST_ENV_CLEANUP = JSON.stringify(before) === JSON.stringify(inventory()) && report.stacks.every(s => s.cleanup)
  if (!report.DOCKER_TEST_ENV_CLEANUP) process.exitCode = 1
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, passed: report.passed, stacks: report.stacks.map(s => ({ iteration: s.iteration, checks: s.tests.length, cleanup: s.cleanup })), error: report.error ?? null, DOCKER_TEST_ENV_CLEANUP: report.DOCKER_TEST_ENV_CLEANUP }))
}
