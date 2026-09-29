// Explicitly authorized baseline alignment. Never accepts a target argument.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { normalizeSql, sqlLiteral } from './history-envelope.mjs'

const ref = 'prnudoydwiramsxjnxzn'
const expected = {
  '20260925212843': '1afaab9b6cc02d108a731fe0668917b929ab6849eb85a77383884c04a477c68c',
  '20260928130825': 'a4fe4578494635a0ffca2fda2ae75526474319f3001ffd6b82ead3a1e7ee8625',
  '20260928143646': '580913686e5ff9e53c14ea098b0456ae2fdeb5a88efd7d881c4bac2aae015add',
  '20260928185439': '6390f43842e82d7d980acfb6ae61e66cd551676e17c21a01a6e8ca237ce3efa1',
}
assert(process.argv.slice(2).every(arg => arg === '--apply'), 'UNSUPPORTED_ARGUMENT')
mkdirSync('rehearsal/tmp', { recursive: true })
mkdirSync('rehearsal/reports', { recursive: true })
function query(sql) {
  assert.equal(readFileSync('supabase/.temp/project-ref', 'utf8').trim(), ref, 'WRONG_TARGET_STOP')
  const file = 'rehearsal/tmp/guibor-a5-preview-alignment.sql'
  writeFileSync(file, sql)
  const result = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'db', 'query', '--linked', '--file', file, '--output', 'json'], { encoding: 'utf8', windowsHide: true, timeout: 60000 })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout).rows
}
const migrations = Object.entries(expected).map(([version, hash]) => {
  const file = readdirSync('supabase/migrations').find(name => name.startsWith(`${version}_`))
  assert(file)
  const source = normalizeSql(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  assert.equal(createHash('sha256').update(source).digest('hex'), hash, 'LOCAL_SOURCE_DRIFT_STOP')
  assert.match(source, /\bBEGIN;/)
  assert.match(source, /COMMIT;\s*$/)
  return { version, name: file.slice(15, -4), source, hash }
})
const ids = migrations.map(m => `'${m.version}'`).join(',')
const historySql = `select version,encode(extensions.digest(array_to_string(statements,E'\\n'),'sha256'),'hex') hash
 from supabase_migrations.schema_migrations where version in (${ids}) order by version`
const fingerprint = `select
 (select md5(coalesce(string_agg(to_jsonb(n)::text,'' order by id),'')) from public.notas_fiscais n) nf_hash,
 (select md5(coalesce(string_agg(to_jsonb(o)::text,'' order by id),'')) from public.operacoes o) op_hash,
 (select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by id),'')) from public.cedente_fundos c) links_hash`
const before = query(fingerprint)[0]
const history = query(historySql)
for (const row of history) assert.equal(row.hash, expected[row.version], 'REMOTE_HISTORY_DRIFT_STOP')
const pending = migrations.filter(m => !history.some(row => row.version === m.version))
console.log(JSON.stringify({ target: ref, dryRun: !process.argv.includes('--apply'), pending: pending.map(({ version, hash }) => ({ version, hash })), dataFingerprint: before }))
if (process.argv.includes('--apply') && pending.length) {
  const steps = pending.map(m => {
    const body = m.source.replace(/\bBEGIN;/, '').replace(/COMMIT;\s*$/, '')
    return `${body}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements)
      VALUES('${m.version}','${m.name}',ARRAY[${sqlLiteral(m.source)}]);`
  }).join('\n')
  query(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
    ${steps}
    DO $guard$ DECLARE actual record; BEGIN
      ${fingerprint.replace(/^select/i, 'select')} INTO actual;
      IF actual.nf_hash <> '${before.nf_hash}' OR actual.op_hash <> '${before.op_hash}' OR actual.links_hash <> '${before.links_hash}' THEN
        RAISE EXCEPTION 'OPERATIONAL_DATA_CHANGED_STOP';
      END IF;
    END $guard$;
    COMMIT;`)
  const after = query(fingerprint)[0]
  assert.deepEqual(after, before)
  const applied = query(historySql)
  assert.equal(applied.length, migrations.length)
  for (const row of applied) assert.equal(row.hash, expected[row.version])
  const result = { target: ref, applied, operationalDataUnchanged: true, productionChanged: false }
  writeFileSync('rehearsal/reports/GUIBOR_A5_PREVIEW_BASELINE_ALIGNMENT.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}
