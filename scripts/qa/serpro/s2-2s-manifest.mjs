import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const requiredPaths = Object.freeze([
  'supabase/migrations/20261028195850_s2_2_serpro_operational_queue_history.sql',
  'supabase/migrations/20261028204436_s2_2r_serpro_outbound_fencing_recovery.sql',
])
export const excludedPaths = Object.freeze([
  'supabase/migrations/20261028140420_s2_1a1_serpro_selective_pilot_claim.sql',
  'supabase/migrations/20261028173558_s2_1a4h_serpro_audit_budget_hardening.sql',
])
export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const canonicalHash = value => sha256(value.replace(/\r\n/g, '\n'))
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

// Append dated reconciliation without rewriting the historical provenance table.
export function verifyLocalReconciliation(manifest, reconciliation, text) {
  assert.equal(manifest.localReconciliation.path, 'scripts/qa/serpro/s2-2s-baseline-reconciliation.json')
  assert.equal(canonicalHash(text), manifest.localReconciliation.sha256, 'RECONCILIATION_HASH_DRIFT')
  assert.deepEqual(reconciliation, JSON.parse(text), 'RECONCILIATION_DOCUMENT_MUST_MATCH_HASHED_TEXT')
  assert.equal(reconciliation.status, 'LOCAL_RECONCILIATION_ONLY_NO_REMOTE_APPLY')
  assert.equal(reconciliation.sqlGo, false)
  assert.equal(reconciliation.remoteApplyAllowed, false)
  assert.equal(reconciliation.liveVerification, false)
  assert.equal(reconciliation.noLedgerRepair, true)
  assert.equal(reconciliation.remoteLedgerRows, manifest.baseline.remoteCount)
  assert.ok(validHash(reconciliation.baselineNormalizedSha256))
  assert.deepEqual(Object.keys(reconciliation.evidenceHashes).sort(), ['R41_RECOVERY_BASELINE_CLOSEOUT.json', 'baseline-fidelity.json', 'seven-source-attestation.json'])
  assert.ok(Object.values(reconciliation.evidenceHashes).every(validHash))
  assert.deepEqual(reconciliation.rows.map(row => row.version), manifest.baseline.missingVersionEvidence.map(row => row.version))
  for (const row of reconciliation.rows) {
    const baseline = manifest.baseline.missingVersionEvidence.find(item => item.version === row.version)
    assert.equal(row.canonicalLfSha256, baseline.statements_canonical_lf_sha256, 'RECONCILED_LEDGER_HASH_DRIFT')
    assert.equal(row.sourceContentRecovered, true)
    assert.equal(row.replayed, false)
    if (row.sourceKind === 'ORIGINAL_SUBMITTED_SQL_IN_ARCHIVED_APPLY_MIGRATION_CALL') {
      assert.equal(row.archivedCall.tool, 'supabase.apply_migration')
      assert.equal(row.archivedCall.status, 'completed')
      assert.equal(row.archivedCall.isError, false)
      assert.ok(validHash(row.archivedCall.recordSha256))
      assert.equal(row.gitSource, null)
    } else {
      assert.equal(row.sourceKind, 'HISTORICAL_GIT_BLOB_MATCHING_LEDGER_CONTENT')
      assert.match(row.gitSource.blob, /^[a-f0-9]{40}$/)
      assert.match(row.gitSource.commit, /^[a-f0-9]{40}$/)
      assert.match(row.gitSource.path, /^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/)
    }
  }
  return { status: 'DATED_SCOPED_BASELINE_RECONCILED_LOCAL_ONLY', rows: reconciliation.rows.length,
    sourceContentRecovered: true, liveVerification: false, sqlApplyAllowed: false }
}

export function verifyProvenanceTable(manifest, table, text) {
  assert.equal(table.status, 'DRAFT_NO_REMOTE_APPLY')
  assert.equal(canonicalHash(text), manifest.provenance.sha256, 'PROVENANCE_TABLE_HASH_DRIFT')
  assert.deepEqual(table.rows.map(row => row.version), manifest.baseline.missingVersionEvidence.map(row => row.version), 'ALL_TEN_DIVERGENCES_REQUIRED')
  assert.equal(table.gateSeparation.remoteSql, 'BLOCKED')
  assert.equal(table.noLedgerRepair, true)
  for (const row of table.rows) {
    const evidence = manifest.baseline.missingVersionEvidence.find(item => item.version === row.version)
    assert.equal(row.capturedSqlSha256, evidence.statements_canonical_lf_sha256, 'LEDGER_EVIDENCE_DRIFT')
    assert.equal(row.versionEquivalenceApproved, false, 'NO_AUTOMATIC_VERSION_EQUIVALENCE')
    assert.ok(['PROVADA', 'EXCEÇÃO HISTÓRICA DOCUMENTADA', 'NÃO COMPROVADA', 'CONFLITANTE'].includes(row.classification))
  }
  return { status: 'DRAFT_TABLE_VERIFIED', rows: table.rows.length, sqlApplyAllowed: false }
}

// Pure, offline analyzer. It deliberately has NO apply mode, SQL executor,
// ledger writer, credentials or network client. Names are never provenance.
export function analyzeManifest(manifest, sources) {
  assert.equal(manifest.schemaVersion, 1, 'MANIFEST_SCHEMA')
  assert.equal(manifest.kind, 'SELECTIVE_MANIFEST_PREPARATION_ONLY')
  assert.equal(manifest.hashContract, 'SHA256_UTF8_CANONICAL_LF_NO_OTHER_NORMALIZATION')
  assert.deepEqual(manifest.required.map(item => item.path), requiredPaths, 'EXACT_OPERATIONAL_SELECTION')
  assert.deepEqual(manifest.excluded.map(item => item.path), excludedPaths, 'PILOT_EXCLUSION_REQUIRED')
  const entries = [...sources].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, text]) => {
    assert.match(path, /^supabase\/migrations\/\d+_[a-zA-Z0-9_]+\.sql$/, 'MIGRATION_PATH_REQUIRED')
    return { path, sha256: canonicalHash(text) }
  })
  assert.equal(entries.length, manifest.localMigrationCount, 'MIGRATION_COUNT_DRIFT')
  assert.equal(sha256(JSON.stringify(entries)), manifest.localMigrationInventorySha256, 'MIGRATION_INVENTORY_DRIFT')
  for (const item of [...manifest.required, ...manifest.excluded]) {
    assert.ok(validHash(item.sha256), 'SOURCE_HASH_REQUIRED')
    assert.ok(sources.has(item.path), 'SOURCE_MISSING')
    assert.equal(canonicalHash(sources.get(item.path)), item.sha256, 'SOURCE_HASH_DRIFT')
  }
  assert.ok(validHash(manifest.baseline.versionInventorySha256), 'LEDGER_SNAPSHOT_HASH_REQUIRED')
  assert.ok(Number.isInteger(manifest.baseline.remoteCount) && manifest.baseline.remoteCount > 0)
  const mismatches = manifest.baseline.missingVersionEvidence
  assert.equal(new Set(mismatches.map(item => item.version)).size, mismatches.length, 'DUPLICATE_BASELINE_VERSION')
  for (const item of mismatches) {
    assert.match(item.version, /^\d{14}$/)
    assert.ok(validHash(item.statements_canonical_lf_sha256), 'BASELINE_STATEMENT_HASH_REQUIRED')
  }
  // Even an exact hash at another timestamp is only a candidate mapping, not
  // permission to rename history or claim an unapplied migration was applied.
  const mappings = mismatches.map(item => ({
    version: item.version,
    exactLocalCandidates: entries.filter(source => source.sha256 === item.statements_canonical_lf_sha256).map(source => source.path),
  }))
  return {
    status: 'DRAFT_BLOCKED', selectionVerified: true, applyAllowed: false,
    capturedAt: manifest.capturedAt, liveVerification: false,
    localInventorySha256: manifest.localMigrationInventorySha256,
    selected: manifest.required, excluded: manifest.excluded,
    baseline: { count: manifest.baseline.remoteCount, sourceAttestationComplete: false,
      missingVersions: mismatches.map(item => item.version), mappings },
    blockers: ['BASELINE_SQL_NOT_FULLY_ATTESTED', 'FRESH_LEDGER_AND_EXPLICIT_GO_REQUIRED'],
    databaseConnections: 0, sqlApplied: false, remoteChanges: false,
  }
}

export async function readMigrationSources(root = process.cwd()) {
  const directory = resolve(root, 'supabase/migrations')
  assert.ok(!(await lstat(directory)).isSymbolicLink(), 'SYMLINK_DIRECTORY_REFUSED')
  return new Map(await Promise.all((await readdir(directory)).filter(name => name.endsWith('.sql')).map(async name => {
    assert.match(name, /^\d+_[a-zA-Z0-9_]+\.sql$/, 'MIGRATION_FILENAME_REQUIRED')
    const file = resolve(directory, name)
    assert.ok((await lstat(file)).isFile() && !(await lstat(file)).isSymbolicLink(), 'REGULAR_SOURCE_FILE_REQUIRED')
    return [`supabase/migrations/${name}`, await readFile(file, 'utf8')]
  })))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.deepEqual(process.argv.slice(2), ['--prepare-only'], 'PREPARE_ONLY_NO_APPLY_MODE')
  const manifest = JSON.parse(await readFile(new URL('./s2-2s-selective-manifest.json', import.meta.url), 'utf8'))
  assert.equal(manifest.provenance.path, 'scripts/qa/serpro/s2-2sr-migration-provenance.json')
  const provenance = await readFile(manifest.provenance.path, 'utf8')
  verifyProvenanceTable(manifest, JSON.parse(provenance), provenance)
  const text = await readFile(manifest.localReconciliation.path, 'utf8')
  const reconciliation = verifyLocalReconciliation(manifest, JSON.parse(text), text)
  // A valid blocked draft exits 0: this is preparation, NEVER a release gate PASS.
  const historicalDraft = analyzeManifest(manifest, await readMigrationSources())
  console.log(JSON.stringify({ ...historicalDraft, reconciliation,
    baseline: { ...historicalDraft.baseline, sourceAttestationComplete: true, datedScopedReconciliation: true },
    blockers: ['FRESH_LEDGER_AND_EXPLICIT_GO_REQUIRED', 'LOCAL_DIFF_REQUIRES_SEPARATE_PUBLICATION_AND_CI_AUTHORITY'] }, null, 2))
}
