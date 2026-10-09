import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { hash } from './r1-4-restorer.mjs'
import { freshCiStack } from './r1-19-fresh-stack.mjs'
import { runDedicatedIntegrations } from './r1-19-integration-stacks.mjs'
import { applyR116 } from './r1-16-forwards.mjs'
import { applyAuthFix } from './r1-16-auth-forward.mjs'
import { verifyR116Directed } from './r1-16-directed.mjs'
import { seed, actors, expectedIds } from './r1-15-rls-fixture.mjs'
import { verifyNotificationRegression } from './r1-3-notifications.mjs'
import { readMigrationSource, gitBytes } from './r1-5-migration-source.mjs'
import { redactCommandOutput } from '../../perf9e/clean-room-lib.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const contract = JSON.parse(await readFile('scripts/qa/reconciliation/ci/contracts.json', 'utf8'))
assert.equal(contract.remoteDatabaseAllowed, false); assert.equal(contract.historicalMigrationsMutable, false)
const dir = 'rehearsal/reports/'
await mkdir(dir, { recursive: true })
const write = (name, value) => writeFile(dir + name + '.json', JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
// wx prevents this adapter from overwriting any local reconciliation evidence.
await write('R1_18_CI_EXTENSIONS', { extensions: contract.extensions })
await write('R1_5_MANIFESTS', { CLEAN_ROOM_CANONICAL: contract.canonical, PROD_TO_RECONCILED_UPGRADE: { baseline: { metadataPath: dir + 'R1_18_CI_EXTENSIONS.json', metadataSha256: hash(await readFile(dir + 'R1_18_CI_EXTENSIONS.json')) } } })
await write('R1_16_FORWARD_MANIFEST', contract.forwards)
await write('R1_16_AUTH_FORWARD_MANIFEST', contract.auth)
await write('R1_15_ACL_CONSUMERS', { rows: contract.acl })
await write('R1_15_DIRECTED_TESTS', { encodingPatterns: contract.encodingPatterns })
const result = { at: new Date().toISOString(), result: 'IN_PROGRESS', scope: 'CANONICAL_CI_ONLY', stacks: [], migrationGuards: [], sql: [], rls: [], remoteCalls: 0 }
const save = () => writeFile(dir + 'R1_18_CI_SQL.json', JSON.stringify(result, null, 2) + '\n')
const read = p => readFile(p, 'utf8')
let stack
async function tap(file, prefix = '') {
  let sql = (await read('supabase/tests/' + file)).replace(/^\\set.*$/mg, '')
  for (const m of [...sql.matchAll(/^\\ir (.+)$/mg)]) sql = sql.replace(m[0], await read('supabase/tests/' + m[1].trim()))
  try {
    const r = await stack.db.query(prefix + sql)
    const lines = (Array.isArray(r) ? r : [r]).flatMap(x => x.rows).flatMap(Object.values).filter(x => typeof x === 'string')
    assert.deepEqual(lines.filter(x => /^not ok|^# Looks like/.test(x)), [], 'PGTAP_FAILURE:' + file)
    const count = lines.filter(x => /^ok \d+/.test(x)).length; assert(count > 0)
    result.sql.push({ file, checks: count, result: 'PASS', sha256: hash(await readFile('supabase/tests/' + file)) }); await save()
  } finally { await stack.db.query('ROLLBACK') }
}
try {
  for (const e of contract.canonical.entries.filter(e => contract.canonical.applyOrder.includes(e.version))) {
    const s = await readMigrationSource(e)
    assert.equal(hash(Buffer.from(s.sql)), e.sha256)
    // Checkout must equal the canonical source modulo the declared Git CRLF representation.
    const checkout = await read(e.path)
    assert.equal(checkout.replaceAll('\r\n', '\n'), s.sql.replaceAll('\r\n', '\n'), 'HISTORICAL_CONTENT_DRIFT:' + e.path)
    result.migrationGuards.push({ version: e.version, sha256: e.sha256, result: 'PASS' })
  }
  assert.equal(result.migrationGuards.length, 264)
  const base = '2e8146ebe7582c5bdc10ddee1f8862d806607ee2'
  const modifiedHistorical = gitBytes(['diff', '--name-only', '--diff-filter=MD', base, '--', 'supabase/migrations']).toString().trim()
  assert.equal(modifiedHistorical, '', 'HISTORICAL_MIGRATION_EDIT_OR_DELETE')
  stack = await freshCiStack(result.stacks)
  await applyR116(stack.db, stack.evidence); result.authForward = await applyAuthFix(stack.db)
  for (const f of ['guibor_a5_base.test.sql', 'r1_8_fiscal_net_contract.test.sql', 'c2_1_r2_taxa_consultor.test.sql', 'guibor_a6_comissao.test.sql', 'guibor_a6_r2_analytics_scope.test.sql', 'c1_1_organizacao_consultora.test.sql', 'c2_1_r2_fluxo_taxa.test.sql', 'r1_3_c5_a6_compat.test.sql']) await tap(f)
  const guibor = await read('supabase/tests/fixtures/guibor_a5_a6.sql')
  await tap('notificacoes_shared_cedente.sql', 'BEGIN;' + guibor + '\n')
  await tap('sacado_multi.assert.sql', 'BEGIN;' + guibor + '\n' + await read('supabase/tests/fixtures/sacado_multi.sql') + "\nINSERT INTO public.sacado_acessos(user_id,sacado_id,fundo_id) VALUES('31000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;\n")
  await tap('health_nfse_municipal.assert.sql', 'BEGIN;' + guibor + '\n')
  result.notifications = await verifyNotificationRegression(stack.db)
  const reservations = (await stack.db.query('SELECT status::text status,private.operacao_status_reserva_nf(status) reserved FROM unnest(enum_range(NULL::public.operacao_status)) status')).rows
  assert.deepEqual(reservations.filter(x => !x.reserved).map(x => x.status).sort(), ['cancelada', 'reprovada'])
  result.p16 = 'PASS'
  await runDedicatedIntegrations(result, save)
  result.fixture = await seed(stack.db)
  await stack.db.query('BEGIN')
  try {
    for (const actor of actors) {
      await stack.db.query('SET LOCAL ROLE authenticated')
      await stack.db.query("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)", [JSON.stringify({ sub: actor.id, role: 'authenticated', aal: 'aal2' }), actor.id])
      const proof = (await stack.db.query("SELECT current_user AS role,auth.uid()::text AS uid,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0]
      assert.equal(proof.role, 'authenticated'); assert.equal(proof.uid, actor.id); assert.equal(proof.rolsuper, false); assert.equal(proof.rolbypassrls, false)
      for (const table of ['taxas_cedente', 'devedores_solidarios']) {
        assert.equal((await stack.db.query('SELECT row_security_active($1::regclass) AS active', ['public.' + table])).rows[0].active, true)
        const ids = (await stack.db.query('SELECT id::text FROM public.' + table + ' ORDER BY id')).rows.map(r => r.id).sort()
        assert.deepEqual(ids, expectedIds(actor, table, null))
        result.rls.push({ actor: actor.name, role: actor.role, table, ids, proof, result: 'PASS' })
      }
      await stack.db.query('RESET ROLE')
    }
  } finally { await stack.db.query('ROLLBACK') }
  assert.equal(result.rls.length, 40); result.directed = await verifyR116Directed(stack.db)
  result.result = 'PASS'; stack.evidence.result = 'PASS'; await stack.persist()
} catch (error) { result.result = 'FAIL_STOPPED'; result.failure = { message: redactCommandOutput(error.message), code: error.code }; process.exitCode = 1 }
finally { await stack?.close(); await save() }
console.log(JSON.stringify({ result: result.result, sql: result.sql, rls: result.rls.length, failure: result.failure }))
