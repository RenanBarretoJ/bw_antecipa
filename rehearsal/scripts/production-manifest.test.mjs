import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BLOCKED_HOMOLOG_MIGRATIONS,
  P5_2_FORWARD_MIGRATION,
  P5_2_PRODUCTION_APPLIED_VERSION,
  buildProductionManifest,
  sqlContentMatchesSha256,
  validateProductionManifest,
} from './production-manifest.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

test('hash SQL preserva certificacao entre LF e CRLF sem aceitar mudanca semantica', () => {
  const lf = 'select 1;\nselect 2;\n'
  const crlf = lf.replace(/\n/gu, '\r\n')
  const expected = sha256(Buffer.from(lf, 'utf8'))

  assert.equal(sqlContentMatchesSha256(Buffer.from(lf, 'utf8'), expected), true)
  assert.equal(sqlContentMatchesSha256(Buffer.from(crlf, 'utf8'), expected), true)
  assert.equal(sqlContentMatchesSha256(Buffer.from('select 3;\n', 'utf8'), expected), false)
})

test('manifesto atual cobre toda a cadeia e bloqueia resets de homologacao', () => {
  const result = validateProductionManifest(buildProductionManifest())
  assert.equal(result.baseline_count, 14)
  assert.equal(result.bridge_count, 3)
  assert.equal(result.upgrade_count, 176)
  assert.equal(result.blocked_count, 5)
  assert.equal(result.manifest.production_history.expected_history_after_p5_2, 199)
  assert.equal(result.manifest.production_history.forward_production_applied_version, P5_2_PRODUCTION_APPLIED_VERSION)
})

test('falha quando migration bloqueada entra no upgrade', () => {
  const manifest = buildProductionManifest()
  manifest.upgrade_order.push(manifest.blocked_homolog_only[0])
  assert.throws(() => validateProductionManifest(manifest), /Hash do manifesto/)
})

test('falha quando ordem promovivel muda', () => {
  const manifest = buildProductionManifest()
  const first = manifest.upgrade_order[0]
  manifest.upgrade_order[0] = manifest.upgrade_order[1]
  manifest.upgrade_order[1] = first
  assert.throws(() => validateProductionManifest(manifest), /Hash do manifesto/)
})

test('falha quando uma correcao P2 desaparece', () => {
  const manifest = buildProductionManifest()
  manifest.p2_production_corrections = manifest.p2_production_corrections.slice(0, 2)
  assert.throws(() => validateProductionManifest(manifest), /Hash do manifesto/)
})

test('cinco resets de homologacao nunca entram no caminho promovivel', () => {
  const manifest = buildProductionManifest()
  const promoted = new Set([
    ...manifest.pre_upgrade_bridges.map(({ file }) => file),
    ...manifest.upgrade_order.map(({ file }) => file),
    ...manifest.post_upgrade_data_patches.map(({ file }) => file),
  ])

  assert.deepEqual(
    BLOCKED_HOMOLOG_MIGRATIONS.filter(({ file }) => promoted.has(file)),
    [],
  )
  assert.equal(promoted.has(P5_2_FORWARD_MIGRATION), true)
})

test('migration P5.2 e forward-only, sem DML operacional e fail-closed', () => {
  const value = fs.readFileSync(
    path.join(repositoryRoot, 'supabase', 'migrations', P5_2_FORWARD_MIGRATION),
    'utf8',
  )
  const executable = value.replace(/--.*$/gmu, '').replace(/'([^']|'')*'/gu, "''")

  assert.match(value, /reset_operacional_fundo_homolog%/u)
  assert.match(value, /revoke all on function/iu)
  assert.match(value, /drop function %s restrict/iu)
  assert.match(value, /if exists/iu)
  assert.doesNotMatch(executable, /\b(insert|update|delete|merge|truncate)\b/iu)
  assert.doesNotMatch(value, /supabase_migrations\.schema_migrations/iu)
})
