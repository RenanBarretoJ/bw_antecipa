// Compile a minimal, source-only CI contract; no database connection or schema dump.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { hash } from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2), ['--local-only'])
const read = async n => JSON.parse(await readFile('rehearsal/reports/' + n + '.json', 'utf8'))
assert.equal((await read('R1_18_FINAL_SQL_WORKFLOW')).result, 'PASS')
const source = await read('R1_5_MANIFESTS'), canonical = source.CLEAN_ROOM_CANONICAL
const keys = ['version', 'name', 'path', 'sha256', 'classification', 'source_kind', 'source_commit', 'source_ref', 'blob_oid', 'authorization']
const plan = { applyOrder: canonical.applyOrder, unresolved: canonical.unresolved, entries: canonical.entries.map(e => Object.fromEntries(keys.filter(k => e[k] !== undefined).map(k => [k, e[k]]))) }
assert.equal(plan.applyOrder.length, 264); assert.deepEqual(plan.unresolved, [])
const metadata = JSON.parse(await readFile(source.PROD_TO_RECONCILED_UPGRADE.baseline.metadataPath, 'utf8'))
const extensions = metadata.extensions.map(({ name, schema }) => ({ name, schema }))
const forwards = await read('R1_16_FORWARD_MANIFEST'), auth = await read('R1_16_AUTH_FORWARD_MANIFEST')
const acl = (await read('R1_15_ACL_CONSUMERS')).rows.map(({ relation, proposedTargetAcl }) => ({ relation, proposedTargetAcl }))
const encodingPatterns = (await read('R1_15_DIRECTED_TESTS')).encodingPatterns
const contract = {
  version: 1, purpose: 'Source-only canonical CI. Does not replace local raw PROD/HOMOLOG upgrade evidence.',
  provenance: { manifestSha256: hash(await readFile('rehearsal/reports/R1_5_MANIFESTS.json')), localFinalSqlSha256: hash(await readFile('rehearsal/reports/R1_18_FULL_SQL.json')) },
  canonical: plan, extensions, forwards, auth, acl, encodingPatterns,
  remoteDatabaseAllowed: false, historicalMigrationsMutable: false,
}
// Reject accidental baseline/project data propagation; the bundle is an explicit projection.
const text = JSON.stringify(contract, null, 2) + '\n'
for (const forbidden of ['schemaPath', 'metadataPath', 'project_ref', 'SERVICE_ROLE_KEY', 'postgresql://', 'wwsndnuvnjuabpbjwlck']) assert(!text.includes(forbidden), 'CI_BUNDLE_LEAK:' + forbidden)
await mkdir('scripts/qa/reconciliation/ci', { recursive: true })
await writeFile('scripts/qa/reconciliation/ci/contracts.json', text, { flag: 'wx' })
await writeFile('rehearsal/reports/R1_18_CI_PACKAGE.json', JSON.stringify({ result: 'PASS', sourceOnly: true, businessData: false, snapshots: false, secrets: false, canonical: plan.applyOrder.length, forwards: forwards.entries.length + 1, sha256: hash(Buffer.from(text)) }, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ result: 'PASS', canonical: plan.applyOrder.length, forwards: 8, bytes: Buffer.byteLength(text) }))
