// Read-only source audit. This is NOT an executable migration manifest or a SQL rehearsal.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const sha = value => createHash('sha256').update(value).digest('hex')
const read = path => readFile(path, 'utf8')
const migrationDir = 'supabase/migrations/'
const c5Paths = [
  '20260925212843_c5_r2_organizational_operations_view.sql',
  '20260928130825_c5_r2_reader_dashboard_reports.sql',
  '20260928143646_c5_r2_reader_portfolio_surfaces.sql',
].map(path => migrationDir + path)
const focused = JSON.parse(await read('scripts/qa/reconciliation/r1-1-focused-manifest.json'))
const candidates = [...c5Paths, ...focused.map(item => item.path)]
const a6Path = migrationDir + '20260929215557_guibor_a6_decouple_c5.sql'
const a6 = await read(a6Path)
const baselinePath = '../bw_antecipa_notificacoes/rehearsal/tmp/notificacoes-reference-schema.sql'
const baseline = await read(baselinePath)
assert.equal(sha(baseline), '23ab8782a97872210730a4fe85ab5ceb6682694ca8572d6c9f41f7f04c58c589')
const historyPath = '../bw_antecipa/rehearsal/reports/MAIN_HOMOLOG_RECONCILIATION_DIAGNOSTIC_2026-10-06.prod-history.json'
const history = JSON.parse(await read(historyPath))
assert(history.some(item => item.version === '20260929215557'))
assert(!history.some(item => item.version === '20260928130825'))
assert(!candidates.some(path => /20260929193129|20260922182301/.test(path)))

// Only inspect CREATE FUNCTION blocks. No SQL is executed, split, or rewritten.
function definition(sql, name) {
  const normalized = sql.replaceAll('"', '')
  const start = normalized.search(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${name.replaceAll('.', '\\.')}\\s*\\(`, 'i'))
  if (start < 0) return null
  const body = normalized.slice(start)
  const delimiter = /\bAS\s+(\$[a-zA-Z0-9_]*\$)/i.exec(body)
  assert(delimiter, `FUNCTION_DELIMITER_NOT_FOUND:${name}`)
  const finish = body.indexOf(delimiter[1], delimiter.index + delimiter[0].length)
  assert(finish > 0, `FUNCTION_BODY_NOT_TERMINATED:${name}`)
  return body.slice(0, finish + delimiter[1].length)
}

const files = []
for (const path of candidates) {
  const sql = await read(path)
  const expected = focused.find(item => item.path === path)
  const hash = sha(await readFile(path))
  if (expected) assert.equal(hash, expected.sha256, `HASH_DRIFT:${path}`)
  files.push({ path, sha256: hash, sql })
}
const blockers = []
for (const suffix of ['dashboard_consultor_resumo', 'relatorio_consultor_analitico']) {
  const name = `public.${suffix}`
  const target = `private.${suffix}_a6`
  const baselineFunction = definition(baseline, name)
  assert(baselineFunction?.includes(target), `BASELINE_A6_WRAPPER_MISSING:${name}`)
  assert(definition(a6, name)?.includes(target), `A6_SOURCE_WRAPPER_MISSING:${name}`)
  const replacements = files.filter(file => definition(file.sql, name))
  const last = replacements.at(-1)
  assert(last, `CANDIDATE_REPLACEMENT_NOT_FOUND:${name}`)
  const finalFunction = definition(last.sql, name)
  if (!finalFunction.includes(target)) blockers.push({
    code: 'C5_REPLACES_EXISTING_A6_WRAPPER', function: name,
    baselineTarget: target, finalSource: last.path, finalSourceSha256: last.sha256,
    replacementChain: replacements.map(file => file.path),
    baselineFunctionSha256: sha(baselineFunction), finalFunctionSha256: sha(finalFunction),
    hasCommissionOptInInCandidateFunction: /comissao_habilitada|comissaoHabilitada/.test(finalFunction),
    impact: 'Existing fund-scoped commission opt-in projection would be bypassed by the old C5 body.',
  })
}
for (const suffix of ['dashboard_consultor_resumo', 'relatorio_consultor_analitico']) {
  const name = `public.${suffix}`
  let permission = null
  for (const file of [{ path: a6Path, sql: a6 }, ...files]) {
    const acl = new RegExp(`(GRANT|REVOKE)\\s+(?:ALL|EXECUTE)\\s+ON\\s+FUNCTION\\s+${name.replaceAll('.', '\\.')}\\s*\\([^;]*?\\)\\s+(?:FROM|TO)\\s+([^;]+);`, 'gi')
    for (const statement of file.sql.matchAll(acl)) {
      if (statement[2].split(',').some(role => role.trim().toLowerCase() === 'service_role')) {
        permission = { granted: statement[1].toUpperCase() === 'GRANT', source: file.path }
      }
    }
  }
  assert(permission, `SERVICE_ROLE_ACL_NOT_FOUND:${name}`)
  if (permission.granted) blockers.push({ code: 'C5_RESTORES_SERVICE_ROLE_EXECUTE', function: name,
    source: permission.source,
    impact: 'The candidate order restores service_role EXECUTE; A6 R2 had revoked it.' })
}
const evidence = {
  at: new Date().toISOString(), result: blockers.length ? 'FAIL' : 'PASS',
  kind: 'STATIC_UPGRADE_ORDER_PREFLIGHT_NOT_SQL_REHEARSAL',
  scope: 'R1 production composition: missing C5 followed by RLX/DOC and R1.1; NOT the narrower focused fiscal test.',
  baseline: { schemaPath: baselinePath, sha256: sha(baseline),
    historyPath, historySha256: sha(await readFile(historyPath)),
    evidenceCapturedOn: '2026-10-06', currentRemoteDatabaseNotQueried: true },
  existingA6: { path: a6Path, sha256: sha(await readFile(a6Path)) },
  candidateOrder: files.map(({ path, sha256 }) => ({ path, sha256 })),
  blockers, originalA6Executed: false, p14Replayed: false,
  productionChanged: false, homologChanged: false, sqlExecuted: false,
  nextAction: 'STOP. Preserve focused PASS. Prepare reviewed forward compatibility for C5/A6 before certifying the complete production upgrade; never edit historical migrations or fake history.',
}
await writeFile('rehearsal/reports/R1_2_UPGRADE_PREFLIGHT.json', JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify({ result: evidence.result, kind: evidence.kind, blockers: evidence.blockers }))
if (blockers.length) process.exitCode = 1
