import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { buildProductionManifest, sqlContentMatchesSha256, validateProductionManifest } from './production-manifest.mjs'

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
  assert.equal(result.upgrade_count, 175)
  assert.equal(result.blocked_count, 5)
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
