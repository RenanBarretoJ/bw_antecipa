import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from 'pg'
import { identityShape, installReserveTrace } from './r1-12-trace.mjs'
import { stackSpec } from './r1-10-stack-guard.mjs'

test('identity trace contains shape/hash, not the raw national key', () => {
  const key = '9'.repeat(50), shape = identityShape('NFSE', key)
  assert.equal(shape.length, 50); assert.equal(shape.allSameDigit, true)
  assert.equal(shape.characterClass, 'DIGITS'); assert.equal(shape.sha256.length, 64)
  assert(!JSON.stringify(shape).includes(key))
  assert.equal(identityShape('NFSE', '1234567890'.repeat(5)).allSameDigit, false)
})
test('municipal fields and missing identity are explicit', () => {
  const shape = identityShape('NFSE', JSON.stringify(['NFSE_MUNICIPAL', '98100000000168', 'PREFEITURA CIDADE QA', '12001']))
  assert.equal(shape.accessKeyPresent, false); assert.equal(shape.fiscalType, 'MUNICIPAL')
  assert.deepEqual(shape.municipalFields, { issuer: true, authority: true, invoiceNumber: true })
  assert.equal(identityShape('NFSE', null).accessKeyPresent, false)
})
test('instrumentation saves before execution and forwards SQL/payload unchanged', async () => {
  const spec = stackSpec('operational', 1791394647757)
  const connection = { host: '127.0.0.1', port: spec.dbPort, database: 'postgres', user: 'postgres', application_name: spec.applicationName }
  const native = Client.prototype.query, order = [], entries = [], args = ['select public.fiscal_intake_reserve($1,$2,$3,$4,$5,$6,$7)',
    [{ type: 'SYSTEM', attachmentToken: 'must-not-log' }, 'synthetic-fund', 'synthetic-link', 'synthetic-establishment', 'NFSE', '9'.repeat(50), 'a'.repeat(64)]]
  try {
    Client.prototype.query = async function (...received) { order.push('query'); assert.equal(received[0], args[0]); assert.equal(received[1], args[1]); throw Object.assign(new Error('FISCAL_IDENTITY_INVALID'), { code: '22023' }) }
    const restore = installReserveTrace(connection, entries, async () => { order.push('save') })
    const client = Object.create(Client.prototype); client.connectionParameters = connection
    await assert.rejects(client.query(...args), e => e.code === '22023')
    assert.deepEqual(order, ['save', 'query', 'save']); assert.equal(entries[0].error.code, '22023')
    assert(!JSON.stringify(entries).includes('must-not-log')); assert(!JSON.stringify(entries).includes('9'.repeat(50)))
    restore()
  } finally { Client.prototype.query = native }
})
test('trace refuses a remote connection', () => assert.throws(() => installReserveTrace({ host: 'remote.supabase.co' }, [], async () => {})))
import { localStorageFixture } from './r1-2-storage.mjs'

test('R1.12 Storage namespace accepts only owned local stack origins',()=>{
  const key='synthetic-test-key-not-a-secret'
  assert(localStorageFixture({API_URL:'http://127.0.0.1:57941',SERVICE_ROLE_KEY:key},'bw_email03_r112clean_123').sha256)
  for(const [url,id] of [
    ['https://example.supabase.co','bw_email03_r112clean_123'],
    ['http://127.0.0.1:57841','bw_email03_r112clean_123'],
    ['http://127.0.0.1:57941','bw_email03_r112rlx_123'],
    ['http://127.0.0.1:57941','production'],
  ])assert.throws(()=>localStorageFixture({API_URL:url,SERVICE_ROLE_KEY:key},id))
})
