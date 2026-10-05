import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import pg from 'pg'
// Explicit local or existing isolated Preview, always rollback. No caller-supplied target.
const preview = process.argv[2] === '--preview-rollback'
assert(process.argv.length === 2 || (process.argv.length === 3 && preview))
const runtime = preview ? await import('./nfse-submit-runtime.mjs') : null
const db = runtime ? await runtime.connect(runtime.details())
  : new pg.Client({host:'127.0.0.1',port:59322,user:'postgres',password:'postgres',database:'postgres'})
const migration=readFileSync('supabase/migrations/20261005204958_nfse_calculated_net_audited_correction.sql','utf8')
const catalog=readFileSync('scripts/qa/health/schema-catalog.sql','utf8')
const fixturePaths=['supabase/tests/fixtures/guibor_a5_a6.sql','supabase/tests/nfse_submit_frozen.assert.sql','supabase/tests/nfse_calculated_net.assert.sql']
const fixtures=fixturePaths.map(p=>readFileSync(p,'utf8'))
// Avoid synthetic CNPJ collisions with the previous smoke; real rows are never updated.
const identifiers=[...new Set(fixtures.join('\n').match(/\b\d{14}\b/g))]
function syntheticCnpj(index) {
  let digits='975031'+String(index+1).padStart(6,'0')
  for(const weights of [[5,4,3,2,9,8,7,6,5,4,3,2],[6,5,4,3,2,9,8,7,6,5,4,3,2]]) {
    const remainder=[...digits].reduce((s,d,i)=>s+Number(d)*weights[i],0)%11
    digits += remainder<2?'0':String(11-remainder)
  }
  return digits
}
const scopedFixtures=fixtures.map(sql=>identifiers.reduce((s,id,i)=>s.replaceAll(id,syntheticCnpj(i)),sql)
  .replaceAll('ESCROW-C21','ESCROW-NFSE-NET-QA').replaceAll('QA_C2_1','QA_NFSE_NET'))
if (!preview) await db.connect()
try {
  const rowState = async () => (await db.query("select count(*)::int count,md5(string_agg(to_jsonb(n)::text,'' order by id)) hash from public.notas_fiscais n")).rows[0]
  const initial = await rowState()
  if (!preview) assert.equal(initial.count,0,'LOCAL_MUST_BE_EMPTY')
  const before=JSON.stringify((await db.query(catalog)).rows)
  await db.query('begin')
  await db.query(migration.replace(/^begin;\s*$/mi,'').replace(/^commit;\s*$/mi,''))
  await db.query(scopedFixtures[0])
  await db.query(scopedFixtures[1])
  await db.query('reset role')
  await db.query(scopedFixtures[2])
  await db.query('rollback')
  assert.equal(JSON.stringify((await db.query(catalog)).rows),before,'ROLLBACK_SCHEMA_DRIFT')
  assert.deepEqual(await rowState(),initial,'DATA_ROLLBACK_DRIFT')
  console.log(JSON.stringify({target:preview?'isolated-preview':'local',sql:'PASS',rollback:'PASS',migrationSha256:createHash('sha256').update(migration).digest('hex')}))
} catch(e) { await db.query('rollback'); console.error({code:e.code,message:e.message});process.exitCode=1 }
finally { await db.end() }
