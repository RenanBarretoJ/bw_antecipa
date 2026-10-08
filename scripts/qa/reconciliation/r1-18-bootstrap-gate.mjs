import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/** No downstream SQL work may silently inherit an earlier revision's bootstrap proof. */
export async function requireR118Bootstrap() {
  const ab = JSON.parse(await readFile('rehearsal/reports/R1_18_CONFIG_AB_COMPARISON.json', 'utf8'))
  const full = JSON.parse(await readFile('rehearsal/reports/R1_18_BOOTSTRAP_STABILITY.json', 'utf8'))
  assert.equal(ab.result, 'PASS'); assert.equal(ab.isolated, 'PASS')
  assert.equal(ab.realtimeFlagCausality, 'NOT_SUPPORTED')
  assert.equal(ab.currentBootstrapReproducibility, 'PASS')
  assert.deepEqual(ab.runs.map(r => [r.label, r.result, r.cleanup]), [['A1', 'PASS', 'PASS'], ['B1', 'PASS', 'PASS'], ['B2', 'PASS', 'PASS'], ['A2', 'PASS', 'PASS']])
  assert.equal(full.result, 'PASS')
  assert.deepEqual(full.runs.map(r => [r.result, r.cleanup]), [['PASS', 'PASS'], ['PASS', 'PASS']])
  assert.equal(new Set([...ab.runs, ...full.runs].map(r => r.projectId)).size, 6)
}
