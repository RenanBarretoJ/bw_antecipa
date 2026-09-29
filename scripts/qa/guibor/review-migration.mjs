// Only explicit Preview/Homolog targets. Never links or pushes a database globally.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { normalizeSql, sqlLiteral } from './history-envelope.mjs'
import { ref, homolog } from './review-target.mjs'
const version = '20260929174520'
const source = normalizeSql(readFileSync(`supabase/migrations/${version}_guibor_nfse_review_intents.sql`, 'utf8'))
const hash = createHash('sha256').update(source).digest('hex')
function query(sql) {
  assert.equal(readFileSync('supabase/.temp/project-ref', 'utf8').trim(), ref)
  const file = 'rehearsal/tmp/guibor-r3-migration.sql'
  writeFileSync(file, sql)
  const result = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js','db','query','--linked','--file',file,'--output','json'], { encoding:'utf8', windowsHide:true, timeout:60000 })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout).rows
}
const snapshot = `select
 (select count(*) from supabase_migrations.schema_migrations where version='${version}') history_count,
 (select encode(extensions.digest(array_to_string(statements,E'\\n'),'sha256'),'hex') from supabase_migrations.schema_migrations where version='${version}') history_hash,
 (select encode(extensions.digest(array_to_string(statements,E'\\n'),'sha256'),'hex') from supabase_migrations.schema_migrations where version='20260929154656') a4_hash,
 to_regclass('public.nfse_review_intents') intents,
 (select md5(coalesce(string_agg(to_jsonb(n)::text,'' order by id),'')) from public.notas_fiscais n) nf_hash,
 (select md5(coalesce(string_agg(to_jsonb(o)::text,'' order by id),'')) from public.operacoes o) op_hash`
const before = query(snapshot)[0]
assert.equal(before.a4_hash, homolog ? '6764965cb3be144ff3604f7aa294aafc62e90270a72d2a4d7104689571e31d76' : 'da66fe43321b8c01d35bf6a012c5cae4668e6b33d1636376e0fc25971985040e', 'A4_HISTORY_DRIFT_STOP')
if (before.history_count === 1) {
  assert.equal(before.history_hash, hash, 'R3_HISTORY_DRIFT_STOP')
  assert.equal(before.intents, 'nfse_review_intents')
  console.log(JSON.stringify({ target:ref, alreadyApplied:true, hash }))
} else {
  assert.equal(before.history_count, 0); assert.equal(before.intents, null)
  console.log(JSON.stringify({ target:ref, precheck:'PASS', apply:process.argv.includes('--apply'), hash }))
  if (process.argv.includes('--apply')) {
    query(`BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
      ${source}
      INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
      VALUES('${version}','guibor_nfse_review_intents',ARRAY[${sqlLiteral(source)}]);COMMIT;${snapshot}`)
    const after = query(snapshot)[0]
    assert.equal(after.history_hash, hash); assert.equal(after.history_count, 1)
    assert.equal(after.a4_hash, before.a4_hash)
    assert.equal(after.nf_hash, before.nf_hash); assert.equal(after.op_hash, before.op_hash)
    const result = { target:ref, migration:version, hash, schema:'PASS', operationalDataUnchanged:true, productionChanged:false }
    writeFileSync(`rehearsal/reports/GUIBOR_R3_${homolog?'HOMOLOG':'PREVIEW'}_MIGRATION.json`, JSON.stringify(result,null,2))
    console.log(JSON.stringify(result))
  }
}
