// Disposable Preview-only pgTAP rehearsal. Every fixture and extension is rolled back.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const ref = 'prnudoydwiramsxjnxzn'
assert.equal(readFileSync('supabase/.temp/project-ref', 'utf8').trim(), ref)
const fixture = readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql', 'utf8')
const results = []
for (const name of ['guibor_a5_base', 'guibor_a6_comissao']) {
  let source = readFileSync(`supabase/tests/${name}.test.sql`, 'utf8')
    .replace(/\\set[^\n]*\n/, '')
    .replace('\\ir fixtures/guibor_a5_a6.sql', fixture)
    .replace('BEGIN;', `BEGIN;
      SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
      DO $guard$ BEGIN
        IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.operacoes)
        THEN RAISE EXCEPTION 'EMPTY_PREVIEW_REQUIRED'; END IF;
      END $guard$;
      CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
      SET LOCAL search_path=public,extensions;
      CREATE TEMP TABLE qa_tap(result text);
      GRANT INSERT,SELECT ON qa_tap TO authenticated;`)
  source = source.replace(/^SELECT (is|ok|throws_ok|lives_ok)\(/gm, 'INSERT INTO qa_tap SELECT $1(')
    .replace('SELECT * FROM finish();', 'INSERT INTO qa_tap SELECT * FROM finish(); SELECT jsonb_agg(result) AS tap FROM qa_tap;')
  const file = 'rehearsal/tmp/guibor-a5-a6-remote-sql.sql'
  writeFileSync(file, source)
  const r = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'db', 'query', '--linked', '--file', file, '--output', 'json'],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8000000 })
  if (r.status !== 0) {
    writeFileSync('rehearsal/reports/GUIBOR_A5_A6_SQL_ERROR.txt', r.stderr)
    throw new Error('REMOTE_SQL_FAILED_SEE_LOCAL_REPORT')
  }
  const data = JSON.parse(r.stdout)
  const tap = data.rows?.find(row => Array.isArray(row.tap))?.tap
  assert(tap?.length, 'MISSING_TAP_OUTPUT')
  assert(!tap.some(line => /^not ok|^# Looks like/.test(line)), JSON.stringify(tap.filter(line => !line.startsWith('ok'))))
  results.push({ name, assertions: tap.filter(line => line.startsWith('ok')).length, rollback: true })
}
writeFileSync('rehearsal/reports/GUIBOR_A5_A6_PREVIEW_SQL.json', JSON.stringify({ target: ref, results, success: true }, null, 2))
console.log(JSON.stringify({ target: ref, results, success: true }))
