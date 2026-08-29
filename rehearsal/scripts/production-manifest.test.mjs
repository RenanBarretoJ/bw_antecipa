import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProductionManifest, validateProductionManifest } from './production-manifest.mjs'

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
