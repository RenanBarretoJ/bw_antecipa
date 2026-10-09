import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ciSpec, chooseSpec, assertCiConnection, assertCiApi } from './r1-19-port-contract.mjs'

const nonce = 1791466842381
const first = ciSpec(57842, nonce), second = ciSpec(57942, nonce)
const connection = { host: '127.0.0.1', port: first.dbPort, user: 'postgres', database: 'postgres', application_name: first.applicationName }
test('Both exact existing notification ports are accepted', () => {
  for (const spec of [first, second]) {
    assertCiConnection({ ...connection, port: spec.dbPort }, spec)
    assertCiApi(`http://127.0.0.1:${spec.apiPort}`, spec)
  }
})
for (const port of [58002, 5432, 57841, 57943]) test('Reject unapproved DB port ' + port, () => assert.throws(() => ciSpec(port, nonce)))
for (const [field, value] of Object.entries({ host: 'remote.supabase.co', port: 58002, user: 'service_role', database: 'production', application_name: 'r110_pa_' + nonce })) {
  test('Reject connection drift: ' + field, () => assert.throws(() => assertCiConnection({ ...connection, [field]: value }, first)))
}
for (const url of ['https://remote.supabase.co', 'http://127.0.0.1:58001', `http://localhost:${first.apiPort}`, `http://127.0.0.1:${first.apiPort}/remote`]) {
  test('Reject non-owned API: ' + url, () => assert.throws(() => assertCiApi(url, first)))
}
test('Preserve occupied first stack and select free second port', () => {
  assert.deepEqual(chooseSpec([{ spec: first, probes: [{ free: false, dockerOwners: ['preexisting'] }] }, { spec: second, probes: [{ free: true, dockerOwners: [] }] }]), second)
})
test('Stopped Docker resource ownership still prevents reuse', () => {
  assert.throws(() => chooseSpec([{ spec: first, probes: [{ free: true, dockerOwners: ['preexisting'] }] }]), /NO_SAFE_ALLOWED_PORT_AVAILABLE/)
})
test('No compatible port: fail closed without fallback', () => {
  assert.throws(() => chooseSpec([first, second].map(spec => ({ spec, probes: [{ free: false, dockerOwners: [] }] }))), /NO_SAFE_ALLOWED_PORT_AVAILABLE/)
})
test('Any occupied ancillary port blocks the candidate', () => {
  assert.throws(() => chooseSpec([{ spec: first, probes: [{ free: true, dockerOwners: [] }, { free: false, dockerOwners: [] }] }]))
})
