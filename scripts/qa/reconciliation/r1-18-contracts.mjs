import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import ts from 'typescript'
import { hash } from './r1-4-restorer.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
const dir = 'rehearsal/reports/'
const read = async n => JSON.parse(await readFile(dir + n + '.json', 'utf8'))
const catalog = await read('R1_18_TARGET_CATALOG')
assert.equal(catalog.result, 'PASS'); assert.equal(catalog.UNKNOWN, 0); assert.equal(catalog.REAL_FUNCTIONAL_DRIFT, 0)
const paths = await Promise.all(['PROD', 'HOMOLOG', 'CLEANROOM'].map(n => read('R1_18_' + n + '_FINAL')))
const acl = (await read('R1_15_ACL_CONSUMERS')).rows
assert.equal(acl.length, 57)
const source = await readFile('src/types/database.ts', 'utf8')
const ast = ts.createSourceFile('database.ts', source, ts.ScriptTarget.Latest, true)
const interfaces = new Map(ast.statements.filter(ts.isInterfaceDeclaration).map(n => [n.name.text, n]))
const property = (iface, name) => {
  const member = interfaces.get(iface)?.members.find(m => m.name?.getText(ast) === name)
  assert(member?.type, 'MISSING_TYPE_FIELD:' + iface + '.' + name)
  return member.type.getText(ast)
}
const mappings = [
  ...['sacado_agencia_escrow', 'sacado_banco_escrow', 'sacado_conta_escrow', 'sacado_tipo_conta_escrow'].map(n => ['Cedente', 'cedentes', n, 'string | null', false]),
  ['ConsultorCedente', 'consultor_cedente', 'created_at', 'string', true],
  ['TaxaCedente', 'taxas_cedente', 'created_at', 'string', true],
  ['TaxaCedente', 'taxas_cedente', 'updated_at', 'string', true],
]
const evidence = []
for (const path of paths) {
  assert.equal(path.result, 'PASS'); assert.equal(path.r116.idempotence, 'PASS'); assert.equal(path.authorizationFix.result, 'PASS')
  for (const row of acl) {
    const object = path.applicationObjects.find(o => o.kind === 'relation' && o.schema + '.' + o.name === row.relation)
    assert(object); assert.deepEqual(object.acl, [...row.proposedTargetAcl].sort(), 'ACL_DRIFT:' + row.relation)
  }
  for (const [iface, table, name, expected, notNull] of mappings) {
    const field = path.applicationObjects.find(o => o.kind === 'column' && o.schema === 'public' && o.name === table + '.' + name)
    assert(field); assert.equal(field.definition.notNull, notNull)
    assert.equal(property(iface, name), expected, 'TYPE_FIELD_DRIFT:' + iface + '.' + name)
    evidence.push({ path: path.name, table, name, notNull, typescript: expected, result: 'PASS' })
  }
  const origin = path.applicationObjects.find(o => o.kind === 'constraint' && o.name === 'usuario_papeis.usuario_papeis_origem_check')
  const values = [...origin.definition.ddl.matchAll(/'([^']+)'::text/g)].map(m => m[1]).sort()
  const typed = [...property('UsuarioPapel', 'origem').matchAll(/'([^']+)'/g)].map(m => m[1]).sort()
  assert.deepEqual(typed, values, 'ORIGIN_UNION_DRIFT')
  evidence.push({ path: path.name, field: 'UsuarioPapel.origem', values, result: 'PASS' })
  assert(path.applicationObjects.some(o => o.kind === 'index' && o.name === 'idx_taxas_cedente_id'))
  const rates = path.applicationObjects.find(o => o.kind === 'constraint' && o.name === 'taxas_cedente.taxas_prazo_check')
  assert.equal(rates?.definition.ddl, 'CHECK (((prazo_min >= 0) AND (prazo_max >= prazo_min) AND (taxa_percentual >= (0)::numeric)))')
  assert.equal(rates.definition.validated, true)
  // FWD-03 explicitly replaces the old rate-only constraint with this combined one.
  assert(!path.applicationObjects.some(o => o.kind === 'constraint' && o.name === 'taxas_cedente.taxas_cedente_taxa_percentual_check'))
}
const rls = await read('R1_18_FINAL_RLS'), auth = await read('R1_18_DUPLICATA_AUTH')
assert.equal(rls.result, 'PASS_REAL_RLS_CAPTURE'); assert.equal(auth.result, 'PASS')
for (const run of rls.runs) assert.equal(run.directed.result, 'PASS')
const report = { at: new Date().toISOString(), result: 'PASS', finalAcl: 'PASS', finalStructure: 'PASS', databaseTypes: 'PASS_TARGETED_RECONCILIATION', relationsPerPath: acl.length, paths: paths.map(p => p.name), evidence, typeFileSha256: hash(Buffer.from(source)), typeChange: 'UsuarioPapel.origem includes bootstrap_producao, as required by all three final catalogs. No runtime or business behavior changed.', scope: 'Targeted nullability/timestamps/origin reconciliation, preserving the existing manually maintained types; not a wholesale regeneration of legacy types.', directedRlsChecks: rls.runs.map(r => ({ stack: r.projectId, count: r.directed.count, result: r.directed.result })), authorizationActors: auth.cases.length }
await writeFile(dir + 'R1_18_FINAL_CONTRACTS.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ result: report.result, finalAcl: report.finalAcl, finalStructure: report.finalStructure, databaseTypes: report.databaseTypes, relationsPerPath: report.relationsPerPath }))
