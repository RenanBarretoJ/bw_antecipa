import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { integrationSuites, assertDedicatedSpec } from './r1-19-integration-stacks.mjs'
import { stackSpec, assertR110Connection } from './r1-10-stack-guard.mjs'

const nonce = 1791466842381
test('Three exact suites preserve ordered credential, inline and CNAB contracts', () => {
  assert.deepEqual(integrationSuites.map(s => s.suite), ['credential', 'inline', 'cnab'])
  assert.equal(new Set(integrationSuites.map(s => s.file)).size, 3)
})
for (const { suite, file } of integrationSuites) {
  test(suite + ': dedicated project matches the unchanged allocator and SQL guard', async () => {
    const spec = stackSpec(suite, nonce)
    assertDedicatedSpec(suite, spec)
    assertR110Connection({ host: '127.0.0.1', user: 'postgres', database: 'postgres', port: spec.dbPort, application_name: spec.applicationName }, suite)
    const sql = await readFile('supabase/tests/' + file, 'utf8')
    const guard = sql.match(/current_setting\('application_name'\) ~ '(\^r110_[^']+)'/)[1]
    assert(new RegExp(guard).test(spec.applicationName))
    assert(!new RegExp(guard).test('r119_ci_' + nonce))
  })
  test(suite + ': cannot relabel another suite as dedicated', () => {
    const other = integrationSuites.find(s => s.suite !== suite)
    assert.throws(() => assertDedicatedSpec(suite, stackSpec(other.suite, nonce)), /DEDICATED_SUITE_CONTRACT_MISMATCH/)
  })
  test(suite + ': cannot reuse notification port', () => {
    assert.throws(() => assertDedicatedSpec(suite, { ...stackSpec(suite, nonce), dbPort: 57942 }))
  })
}
test('Unknown suite fails closed', () => assert.throws(() => assertDedicatedSpec('any', stackSpec('credential', nonce))))
