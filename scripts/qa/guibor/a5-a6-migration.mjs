// Controlled A5/A6 promotion; production is never an accepted target.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { normalizeSql, sqlLiteral } from './history-envelope.mjs'

assert(process.argv.slice(2).every(arg => ['--apply', '--homolog'].includes(arg)), 'UNSUPPORTED_ARGUMENT')
const homolog = process.argv.includes('--homolog')
const ref = homolog ? 'fhgkmggthxikfpogrvaa' : 'prnudoydwiramsxjnxzn'
if (homolog && process.argv.includes('--apply')) {
  const certified = JSON.parse(readFileSync('rehearsal/reports/GUIBOR_A5_A6_PREVIEW_CERTIFICATION.json', 'utf8'))
  assert.equal(certified.target, 'prnudoydwiramsxjnxzn')
  assert.equal(certified.success, true, 'PREVIEW_CERTIFICATION_REQUIRED')
}
mkdirSync('rehearsal/tmp', { recursive: true })
mkdirSync('rehearsal/reports', { recursive: true })
function query(sql) {
  assert.equal(readFileSync('supabase/.temp/project-ref', 'utf8').trim(), ref, 'WRONG_TARGET_STOP')
  const file = 'rehearsal/tmp/guibor-a5-a6-migration.sql'
  writeFileSync(file, sql)
  const result = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'db', 'query', '--linked', '--file', file, '--output', 'json'], { encoding: 'utf8', windowsHide: true, timeout: 60000 })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout).rows
}
const migrations = ['20260929191004', '20260929193129'].map(version => {
  const file = readdirSync('supabase/migrations').find(name => name.startsWith(`${version}_`))
  assert(file)
  const source = normalizeSql(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  const hash = createHash('sha256').update(source).digest('hex')
  assert.match(source, /\bBEGIN;/)
  assert.match(source, /COMMIT;\s*$/)
  return { version, name: file.slice(15, -4), source, hash }
})
const ids = migrations.map(m => `'${m.version}'`).join(',')
const historySql = `select version,encode(extensions.digest(array_to_string(statements,E'\\n'),'sha256'),'hex') hash
 from supabase_migrations.schema_migrations where version in (${ids}) order by version`
// Ignore only newly added columns when comparing the pre-existing data.
const fingerprint = `select
 (select md5(coalesce(string_agg(to_jsonb(n)::text,'' order by id),'')) from public.notas_fiscais n) nf_hash,
 (select md5(coalesce(string_agg((to_jsonb(o)-'base_antecipacao_snapshot')::text,'' order by id),'')) from public.operacoes o) op_hash,
 (select md5(coalesce(string_agg((to_jsonb(c)-'base_valor_antecipacao')::text,'' order by id),'')) from public.cedente_fundos c) links_hash,
 (select md5(coalesce(string_agg((to_jsonb(c)-'comissao_habilitada')::text,'' order by id),'')) from public.consultor_fundos c) org_links_hash,
 (select md5(coalesce(string_agg(to_jsonb(h)::text,'' order by version),'')) from supabase_migrations.schema_migrations h where version not in (${ids})) history_hash`
const before = query(fingerprint)[0]
const history = query(historySql)
for (const row of history) assert.equal(row.hash, migrations.find(m => m.version === row.version).hash, 'REMOTE_HISTORY_DRIFT_STOP')
const pending = migrations.filter(m => !history.some(row => row.version === m.version))
console.log(JSON.stringify({ target: ref, dryRun: !process.argv.includes('--apply'), pending: pending.map(({ version, hash }) => ({ version, hash })) }))
if (process.argv.includes('--apply') && pending.length) {
  const steps = pending.map(m => `${m.source.replace(/\bBEGIN;/, '').replace(/COMMIT;\s*$/, '')}
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES('${m.version}','${m.name}',ARRAY[${sqlLiteral(m.source)}]);`).join('\n')
  const guard = Object.keys(before).map(key => `actual.${key} IS DISTINCT FROM '${before[key]}'`).join(' OR ')
  query(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
    ${steps}
    DO $guard$ DECLARE actual record; BEGIN
      ${fingerprint} INTO actual;
      IF ${guard} THEN RAISE EXCEPTION 'HISTORICAL_DATA_CHANGED_STOP'; END IF;
    END $guard$;
    NOTIFY pgrst, 'reload schema'; COMMIT;`)
  assert.deepEqual(query(fingerprint)[0], before)
  const applied = query(historySql)
  assert.equal(applied.length, migrations.length)
  for (const row of applied) assert.equal(row.hash, migrations.find(m => m.version === row.version).hash)
  const result = { target: ref, applied, historicalDataUnchanged: true, productionChanged: false }
  writeFileSync(`rehearsal/reports/GUIBOR_A5_A6_${homolog ? 'HOMOLOG' : 'PREVIEW'}_MIGRATION.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}
