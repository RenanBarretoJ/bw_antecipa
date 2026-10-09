import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

export const manifest = JSON.parse(readFileSync(new URL('./migration-manifest.json', import.meta.url), 'utf8'))
export function validateMigrationSource(entry, sql) {
  assert.equal(entry.version, '20261002205122', 'MIGRATION_VERSION_NOT_ALLOWED')
  assert.equal(entry.name, 'health_nfse_municipal_identity', 'MIGRATION_NAME_NOT_ALLOWED')
  assert.equal(entry.file, `${entry.version}_${entry.name}.sql`, 'MIGRATION_FILENAME_MISMATCH')
  assert.equal(entry.sha256, '53a0f6533c745381ccad139ff734960d7ca99fbd67cb1d979385fc6773dc5d65', 'MIGRATION_PIN_CHANGED')
  const source = sql.replaceAll('\r\n', '\n')
  assert.equal(createHash('sha256').update(source).digest('hex'), entry.sha256, 'MIGRATION_HASH_MISMATCH')
  return source
}
export function loadHealthMigration() {
  assert.equal(manifest.mode, 'MANUAL_EXPLICIT_LIST')
  assert.equal(manifest.projectRef, 'mkfslrspxzplghjeixjq')
  assert.equal(manifest.gitBranch, 'hotfix/health-fiscal-import')
  assert.equal(manifest.historicalDivergence, 'KNOWN_AND_PRESERVED')
  assert.deepEqual(manifest.excludedVersions, ['20260929193129'])
  assert.equal(manifest.migrations.length, 1, 'EXPLICIT_LIST_CHANGED')
  const entry = manifest.migrations[0]
  // Validate the filename/version before using it as a path.
  assert.equal(entry.file, '20261002205122_health_nfse_municipal_identity.sql')
  const source = validateMigrationSource(entry, readFileSync(new URL(`../../../supabase/migrations/${entry.file}`, import.meta.url), 'utf8'))
  return { ...entry, source }
}
