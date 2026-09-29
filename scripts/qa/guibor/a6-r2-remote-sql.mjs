// Disposable Preview-only pgTAP rehearsal. Every fixture and extension is rolled back.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const ref = 'prnudoydwiramsxjnxzn'
assert.equal(readFileSync('supabase/.temp/project-ref', 'utf8').trim(), ref)
const fixture = readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql', 'utf8')
const results = []
for (const name of ['guibor_a5_base', 'guibor_a6_comissao', 'guibor_a6_r2_analytics_scope', 'c1_1_organizacao_consultora']) {
  let source = readFileSync(`supabase/tests/${name}.test.sql`, 'utf8')
    .replace(/\r\n/g, '\n')
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
  // C5 is already installed on Preview and intentionally requires an operation
  // for event visibility. The original no-operation C1.1 test is run unchanged
  // on production-like without C5. Here only its fixture gains that relationship.
  if(name==='c1_1_organizacao_consultora') {
    source=source.replace('$test$;', `$test$;
      INSERT INTO public.contas_escrow(id,cedente_id,identificador,status)
      VALUES('a6000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','QA-A6-R2-C11','ativa');
      INSERT INTO public.operacoes(id,cedente_id,cedente_fundo_id,conta_escrow_id,valor_bruto_total,valor_liquido_desembolso,taxa_desconto,prazo_dias,data_vencimento,status)
      VALUES('a6000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',100,99,1,30,current_date+30,'em_andamento');`)
      .replaceAll('tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,','operacao_id, tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,')
      .replaceAll(") VALUES (\n      '30000000-0000-4000-8000-000000000001',",
        ") VALUES (\n      'a6000000-0000-4000-8000-000000000002',\n      '30000000-0000-4000-8000-000000000001',")
  }
  source = source.replace(/^SELECT (is|ok|throws_ok|lives_ok)\(/gm, 'INSERT INTO qa_tap SELECT $1(')
    .replace('SELECT * FROM finish();', 'INSERT INTO qa_tap SELECT * FROM finish(); SELECT jsonb_agg(result) AS tap FROM qa_tap;')
  const file = 'rehearsal/tmp/guibor-a6-r2-remote-sql.sql'
  writeFileSync(file, source)
  const r = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'db', 'query', '--linked', '--file', file, '--output', 'json'],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8000000 })
  if (r.status !== 0) {
    writeFileSync('rehearsal/reports/GUIBOR_A6_R2_SQL_ERROR.txt', r.stderr)
    throw new Error('REMOTE_SQL_FAILED_SEE_LOCAL_REPORT')
  }
  const data = JSON.parse(r.stdout)
  const tap = data.rows?.find(row => Array.isArray(row.tap))?.tap
  assert(tap?.length, 'MISSING_TAP_OUTPUT')
  assert(!tap.some(line => /^not ok|^# Looks like/.test(line)), JSON.stringify(tap.filter(line => !line.startsWith('ok'))))
  results.push({ name, assertions: tap.filter(line => line.startsWith('ok')).length, rollback: true })
}
writeFileSync('rehearsal/reports/GUIBOR_A6_R2_PREVIEW_SQL.json', JSON.stringify({ target: ref, results, success: true }, null, 2))
console.log(JSON.stringify({ target: ref, results, success: true }))
